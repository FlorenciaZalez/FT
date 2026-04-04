from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
import re

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.integrations.mercadolibre.models import MLProductMapping, MercadoLibreAccount
from app.products.models import Product
from app.auth.models import User
from app.common.exceptions import NotFoundError, ConflictError, BadRequestError
from app.common.permissions import tenant_filter, check_tenant_access

ML_AUTH_URL = "https://auth.mercadolibre.com.ar/authorization"
ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token"
ML_USER_URL = "https://api.mercadolibre.com/users/me"
ML_API_BASE_URL = "https://api.mercadolibre.com"
ML_ITEM_ID_PATTERN = re.compile(r"(MLA)[-_\s]?(\d+)", re.IGNORECASE)


def normalize_ml_item_id(raw_value: str | None) -> str | None:
    if raw_value is None:
        return None

    value = raw_value.strip().upper()
    if not value:
        return None

    match = ML_ITEM_ID_PATTERN.search(value)
    if match is None:
        raise BadRequestError("El item de MercadoLibre debe tener formato MLA123456789 o una URL válida")

    return f"MLA{match.group(2)}"


# ─── OAuth helpers ────────────────────────────────────────────────

def get_auth_url(client_id: int) -> str:
    """Build the Mercado Libre OAuth authorization URL."""
    settings = get_settings()
    params = {
        "response_type": "code",
        "client_id": settings.ML_CLIENT_ID,
        "redirect_uri": settings.ML_REDIRECT_URI,
        "state": str(client_id),
    }
    return f"{ML_AUTH_URL}?{urlencode(params)}"


async def exchange_code(code: str, client_id: int, db: AsyncSession) -> MercadoLibreAccount:
    """Exchange an authorization code for tokens and persist the ML account."""
    settings = get_settings()

    async with httpx.AsyncClient(timeout=15) as http:
        # 1. Exchange code → tokens
        token_resp = await http.post(ML_TOKEN_URL, json={
            "grant_type": "authorization_code",
            "client_id": settings.ML_CLIENT_ID,
            "client_secret": settings.ML_CLIENT_SECRET,
            "code": code,
            "redirect_uri": settings.ML_REDIRECT_URI,
        })
        if token_resp.status_code != 200:
            raise BadRequestError(f"Error al obtener token de ML: {token_resp.text}")
        token_data = token_resp.json()

        access_token = token_data["access_token"]
        refresh_token = token_data["refresh_token"]
        expires_in = token_data.get("expires_in", 21600)
        token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        # 2. Fetch ML user info
        user_resp = await http.get(ML_USER_URL, headers={"Authorization": f"Bearer {access_token}"})
        ml_user = user_resp.json() if user_resp.status_code == 200 else {}

    ml_user_id = str(token_data.get("user_id", ml_user.get("id", "")))
    ml_nickname = ml_user.get("nickname")

    # 3. Upsert account
    result = await db.execute(
        select(MercadoLibreAccount).where(MercadoLibreAccount.client_id == client_id)
    )
    account = result.scalar_one_or_none()

    if account:
        account.ml_user_id = ml_user_id
        account.ml_nickname = ml_nickname
        account.access_token = access_token
        account.refresh_token = refresh_token
        account.token_expires_at = token_expires_at
        account.connected_at = datetime.now(timezone.utc)
    else:
        account = MercadoLibreAccount(
            client_id=client_id,
            ml_user_id=ml_user_id,
            ml_nickname=ml_nickname,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=token_expires_at,
        )
        db.add(account)

    await db.flush()
    await db.refresh(account)
    return account


async def get_account(db: AsyncSession, client_id: int) -> MercadoLibreAccount | None:
    result = await db.execute(
        select(MercadoLibreAccount).where(MercadoLibreAccount.client_id == client_id)
    )
    return result.scalar_one_or_none()


async def disconnect_account(db: AsyncSession, client_id: int) -> None:
    account = await get_account(db, client_id)
    if account is None:
        raise NotFoundError("No hay cuenta de Mercado Libre conectada")
    await db.delete(account)
    await db.flush()


async def refresh_account_token(db: AsyncSession, client_id: int) -> MercadoLibreAccount:
    account = await get_account(db, client_id)
    if account is None:
        raise NotFoundError("No hay cuenta de Mercado Libre conectada")

    settings = get_settings()
    async with httpx.AsyncClient(timeout=15) as http:
        resp = await http.post(ML_TOKEN_URL, json={
            "grant_type": "refresh_token",
            "client_id": settings.ML_CLIENT_ID,
            "client_secret": settings.ML_CLIENT_SECRET,
            "refresh_token": account.refresh_token,
        })
        if resp.status_code != 200:
            raise BadRequestError(f"Error al refrescar token: {resp.text}")
        data = resp.json()

    account.access_token = data["access_token"]
    account.refresh_token = data["refresh_token"]
    expires_in = data.get("expires_in", 21600)
    account.token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    await db.flush()
    await db.refresh(account)
    return account


async def _get_valid_account(db: AsyncSession, client_id: int) -> MercadoLibreAccount:
    account = await get_account(db, client_id)
    if account is None:
        raise NotFoundError("No hay cuenta de Mercado Libre conectada")

    if account.token_expires_at is None:
        return await refresh_account_token(db, client_id)

    expires_at = account.token_expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at <= datetime.now(timezone.utc) + timedelta(minutes=5):
        return await refresh_account_token(db, client_id)

    return account


async def download_shipping_labels_pdf(
    db: AsyncSession,
    client_id: int,
    shipment_ids: list[str],
) -> bytes:
    normalized_ids = [str(shipment_id).strip() for shipment_id in shipment_ids if str(shipment_id).strip()]
    if not normalized_ids:
        raise BadRequestError("No hay shipment_ids válidos para imprimir")

    if len(normalized_ids) > 50:
        raise BadRequestError("Mercado Libre permite imprimir como máximo 50 etiquetas por solicitud")

    account = await _get_valid_account(db, client_id)
    async with httpx.AsyncClient(timeout=45) as http:
        response = await http.get(
            f"{ML_API_BASE_URL}/shipment_labels",
            params={
                "shipment_ids": ",".join(normalized_ids),
                "response_type": "pdf",
            },
            headers={"Authorization": f"Bearer {account.access_token}"},
        )

    if response.status_code != 200:
        detail = response.text.strip()
        raise BadRequestError(
            f"Mercado Libre no pudo generar la etiqueta: {detail or response.reason_phrase}"
        )

    return response.content


async def list_mappings(db: AsyncSession, user: User) -> list[MLProductMapping]:
    query = select(MLProductMapping)
    query = tenant_filter(query, MLProductMapping, user)
    result = await db.execute(query.order_by(MLProductMapping.id))
    return result.scalars().all()


async def create_mapping(db: AsyncSession, user: User, data: dict) -> dict:
    client_id = user.client_id
    if client_id is None:
        client_id = data.get("client_id")
    if client_id is None:
        from app.common.exceptions import BadRequestError
        raise BadRequestError("client_id is required")

    check_tenant_access(user, client_id)

    normalized_item_id = normalize_ml_item_id(data.get("ml_item_id"))
    if normalized_item_id is None:
        raise BadRequestError("ml_item_id is required")

    # Verify product exists and belongs to tenant
    product = await db.get(Product, data["product_id"])
    if product is None:
        raise NotFoundError(f"Product {data['product_id']} not found")
    check_tenant_access(user, product.client_id)

    # Check duplicate mapping
    existing = await db.execute(
        select(MLProductMapping).where(
            MLProductMapping.client_id == client_id,
            MLProductMapping.ml_item_id == normalized_item_id,
            MLProductMapping.ml_variation_id == data.get("ml_variation_id"),
        )
    )
    if existing.scalar_one_or_none():
        raise ConflictError("This ML item+variation mapping already exists")

    mapping = MLProductMapping(
        client_id=client_id,
        product_id=data["product_id"],
        ml_item_id=normalized_item_id,
        ml_variation_id=data.get("ml_variation_id"),
        ml_account_id=data.get("ml_account_id"),
    )
    db.add(mapping)
    await db.flush()

    from app.orders import service as orders_service

    reconciled_orders = await orders_service.reconcile_unmapped_orders_for_mapping(db, user, mapping)
    await db.refresh(mapping)
    return {
        "success": True,
        "reconciled_orders": reconciled_orders,
        "mapping": mapping,
    }


async def update_mapping(db: AsyncSession, mapping_id: int, user: User, data: dict) -> MLProductMapping:
    mapping = await db.get(MLProductMapping, mapping_id)
    if mapping is None:
        raise NotFoundError(f"ML mapping {mapping_id} not found")
    check_tenant_access(user, mapping.client_id)

    next_product_id = data.get("product_id", mapping.product_id)
    if next_product_id != mapping.product_id:
        product = await db.get(Product, next_product_id)
        if product is None:
            raise NotFoundError(f"Product {next_product_id} not found")
        check_tenant_access(user, product.client_id)

    if "ml_item_id" in data:
        data["ml_item_id"] = normalize_ml_item_id(data.get("ml_item_id"))

    next_item_id = data.get("ml_item_id", mapping.ml_item_id)
    next_variation_id = data.get("ml_variation_id", mapping.ml_variation_id)
    duplicate = await db.execute(
        select(MLProductMapping).where(
            MLProductMapping.client_id == mapping.client_id,
            MLProductMapping.ml_item_id == next_item_id,
            MLProductMapping.ml_variation_id == next_variation_id,
            MLProductMapping.id != mapping.id,
        )
    )
    if duplicate.scalar_one_or_none():
        raise ConflictError("This ML item+variation mapping already exists")

    for key, value in data.items():
        setattr(mapping, key, value)

    await db.flush()
    await db.refresh(mapping)
    return mapping


async def delete_mapping(db: AsyncSession, mapping_id: int, user: User) -> None:
    mapping = await db.get(MLProductMapping, mapping_id)
    if mapping is None:
        raise NotFoundError(f"ML mapping {mapping_id} not found")
    check_tenant_access(user, mapping.client_id)
    await db.delete(mapping)
    await db.flush()


async def upsert_mapping(
    db: AsyncSession,
    user: User,
    *,
    client_id: int,
    product_id: int,
    ml_item_id: str,
    ml_variation_id: str | None = None,
    ml_account_id: str | None = None,
) -> MLProductMapping:
    check_tenant_access(user, client_id)
    normalized_item_id = normalize_ml_item_id(ml_item_id)
    if normalized_item_id is None:
        raise BadRequestError("ml_item_id is required")

    product = await db.get(Product, product_id)
    if product is None:
        raise NotFoundError(f"Product {product_id} not found")
    check_tenant_access(user, product.client_id)

    result = await db.execute(
        select(MLProductMapping).where(
            MLProductMapping.client_id == client_id,
            MLProductMapping.ml_item_id == normalized_item_id,
            MLProductMapping.ml_variation_id == ml_variation_id,
        )
    )
    mapping = result.scalar_one_or_none()
    if mapping is None:
        mapping = MLProductMapping(
            client_id=client_id,
            product_id=product_id,
            ml_item_id=normalized_item_id,
            ml_variation_id=ml_variation_id,
            ml_account_id=ml_account_id,
            is_active=True,
        )
        db.add(mapping)
    else:
        mapping.product_id = product_id
        mapping.ml_account_id = ml_account_id
        mapping.is_active = True

    await db.flush()
    await db.refresh(mapping)
    return mapping


async def resolve_ml_to_product(
    db: AsyncSession, client_id: int, ml_item_id: str, ml_variation_id: str | None = None,
) -> Product | None:
    """Given a ML item_id + variation_id, find the internal product."""
    normalized_item_id = normalize_ml_item_id(ml_item_id)
    if normalized_item_id is None:
        return None

    query = select(MLProductMapping).where(
        MLProductMapping.client_id == client_id,
        MLProductMapping.ml_item_id == normalized_item_id,
        MLProductMapping.is_active.is_(True),
    )
    if ml_variation_id:
        query = query.where(MLProductMapping.ml_variation_id == ml_variation_id)

    result = await db.execute(query)
    mapping = result.scalar_one_or_none()
    if mapping is None:
        return None
    return await db.get(Product, mapping.product_id)
