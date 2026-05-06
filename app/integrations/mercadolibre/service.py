from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode
import logging
import re

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.integrations.mercadolibre.models import MLProductMapping, MercadoLibreAccount
from app.products.models import Product
from app.auth.models import User
from app.orders.models import Order, OrderSource
from app.common.exceptions import NotFoundError, ConflictError, BadRequestError
from app.common.permissions import tenant_filter, check_tenant_access

logger = logging.getLogger(__name__)

ML_AUTH_URL = "https://auth.mercadolibre.com/authorization"
ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token"
ML_USER_URL = "https://api.mercadolibre.com/users/me"
ML_API_BASE_URL = "https://api.mercadolibre.com"
ML_ITEM_ID_PATTERN = re.compile(r"(ML[A-Z])[-_\s]?(\d+)", re.IGNORECASE)
ML_ORDER_RESOURCE_PATTERN = re.compile(r"/orders/(\d+)")

_ML_PLACEHOLDER_VALUES = {
    "",
    "TU_CLIENT_ID_AQUI",
    "TU_CLIENT_SECRET_AQUI",
}


def normalize_ml_item_id(raw_value: str | None) -> str | None:
    if raw_value is None:
        return None

    value = raw_value.strip().upper()
    if not value:
        return None

    match = ML_ITEM_ID_PATTERN.search(value)
    if match is None:
        raise BadRequestError("El item de MercadoLibre debe tener formato MLA123456789 o una URL válida")

    return f"{match.group(1).upper()}{match.group(2)}"


def normalize_ml_item_ids(raw_value: str | None) -> list[str]:
    if raw_value is None:
        return []

    value = raw_value.strip().upper()
    if not value:
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for match in ML_ITEM_ID_PATTERN.finditer(value):
        item_id = f"{match.group(1).upper()}{match.group(2)}"
        if item_id not in seen:
            seen.add(item_id)
            normalized.append(item_id)

    if not normalized:
        raise BadRequestError("El item de MercadoLibre debe tener formato MLA123456789 o una URL válida")

    return normalized


# ─── OAuth helpers ────────────────────────────────────────────────

def _validate_oauth_settings(require_secret: bool) -> None:
    settings = get_settings()
    is_production = settings.APP_ENV.lower() == "production"

    if settings.ML_CLIENT_ID.strip() in _ML_PLACEHOLDER_VALUES:
        raise BadRequestError("Configuración faltante de Mercado Libre: definí ML_CLIENT_ID en el backend")

    redirect_uri = settings.ML_REDIRECT_URI.strip()
    if not redirect_uri:
        raise BadRequestError("Configuración faltante de Mercado Libre: definí ML_REDIRECT_URI en el backend")

    if is_production and "localhost" in redirect_uri.lower():
        raise BadRequestError(
            "Configuración inválida de Mercado Libre: ML_REDIRECT_URI debe ser una URL pública registrada en tu app"
        )

    if require_secret and settings.ML_CLIENT_SECRET.strip() in _ML_PLACEHOLDER_VALUES:
        raise BadRequestError("Configuración faltante de Mercado Libre: definí ML_CLIENT_SECRET en el backend")

def get_auth_url(client_id: int) -> str:
    """Build the Mercado Libre OAuth authorization URL."""
    _validate_oauth_settings(require_secret=False)
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
    _validate_oauth_settings(require_secret=True)
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

    _validate_oauth_settings(require_secret=True)
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
        logger.info("[ML] Token expiry imminent for client_id=%s, refreshing...", client_id)
        account = await refresh_account_token(db, client_id)
        logger.info("[ML] Token refreshed successfully for client_id=%s", client_id)
        return account

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
        logger.error(
            "ML shipment_labels failed: status=%s shipment_ids=%s body=%s",
            response.status_code, normalized_ids, detail[:500] if detail else response.reason_phrase
        )
        raise BadRequestError(
            f"Mercado Libre no pudo generar la etiqueta (HTTP {response.status_code}): {detail or response.reason_phrase}"
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


def _extract_order_resource_id(resource: str | None) -> str | None:
    if resource is None:
        return None
    match = ML_ORDER_RESOURCE_PATTERN.search(resource)
    if match is None:
        return None
    return match.group(1)


def _coalesce_buyer_name(order_data: dict) -> str | None:
    buyer = order_data.get("buyer") or {}
    nickname = buyer.get("nickname")
    if isinstance(nickname, str) and nickname.strip():
        return nickname.strip()

    first_name = buyer.get("first_name")
    last_name = buyer.get("last_name")
    full_name = " ".join(
        part.strip()
        for part in [first_name, last_name]
        if isinstance(part, str) and part.strip()
    )
    return full_name or None


def _normalize_order_item_payload(order_item: dict) -> dict | None:
    item_data = order_item.get("item") or {}
    raw_ml_item_id = item_data.get("id")
    normalized_ml_item_id = normalize_ml_item_id(str(raw_ml_item_id) if raw_ml_item_id is not None else None)
    if normalized_ml_item_id is None:
        return None

    variation_id = order_item.get("variation_id")
    return {
        "ml_item_id": normalized_ml_item_id,
        "variation_id": str(variation_id) if variation_id is not None else None,
        "quantity": max(int(order_item.get("quantity") or 1), 1),
    }


def _extract_shipping_address(order_data: dict) -> dict:
    shipping = order_data.get("shipping") or {}
    receiver = shipping.get("receiver_address") or {}
    city = receiver.get("city") or {}
    state = receiver.get("state") or {}

    return {
        "shipping_id": str(shipping.get("id")) if shipping.get("id") is not None else None,
        "address_line": receiver.get("address_line") or receiver.get("comment"),
        "city": city.get("name") if isinstance(city, dict) else None,
        "state": state.get("name") if isinstance(state, dict) else None,
        "postal_code": receiver.get("zip_code"),
        "address_reference": receiver.get("comment"),
    }


async def process_webhook_notification(db: AsyncSession, payload: dict) -> dict:
    topic = str(payload.get("topic") or "").lower()
    user_id = payload.get("user_id")
    resource = payload.get("resource")

    logger.info(
        "[ML][WEBHOOK] Received notification — topic=%r user_id=%r resource=%r attempts=%r",
        payload.get("topic"), user_id, resource, payload.get("attempts"),
    )

    if "orders" not in topic:
        logger.info("[ML][WEBHOOK] Ignored: topic %r is not order-related", payload.get("topic"))
        return {
            "received": True,
            "processed": False,
            "action": "ignored",
            "detail": "Topico no soportado para ingestion automatica",
            "order_id": None,
        }

    if user_id is None:
        logger.warning("[ML][WEBHOOK] Ignored: notification has no user_id. Full payload: %s", payload)
        return {
            "received": True,
            "processed": False,
            "action": "ignored",
            "detail": "Notificacion sin user_id",
            "order_id": None,
        }

    account_result = await db.execute(
        select(MercadoLibreAccount).where(MercadoLibreAccount.ml_user_id == str(user_id))
    )
    account = account_result.scalar_one_or_none()
    if account is None:
        logger.warning(
            "[ML][WEBHOOK] Ignored: ml_user_id=%r is not linked to any client in the DB",
            str(user_id),
        )
        return {
            "received": True,
            "processed": False,
            "action": "ignored",
            "detail": "La cuenta de Mercado Libre no esta vinculada a ningun cliente",
            "order_id": None,
        }

    logger.info("[ML][WEBHOOK] Matched account: client_id=%s ml_nickname=%r", account.client_id, account.ml_nickname)

    order_external_id = _extract_order_resource_id(resource)
    if order_external_id is None:
        logger.warning("[ML][WEBHOOK] Ignored: could not extract order ID from resource=%r", resource)
        return {
            "received": True,
            "processed": False,
            "action": "ignored",
            "detail": "Resource de orden invalido",
            "order_id": None,
        }

    logger.info("[ML][WEBHOOK] Extracted order external_id=%s", order_external_id)

    existing_result = await db.execute(
        select(Order).where(
            Order.client_id == account.client_id,
            Order.source == OrderSource.mercadolibre,
            Order.external_id == order_external_id,
        )
    )
    existing_order = existing_result.scalar_one_or_none()
    if existing_order is not None:
        logger.info("[ML][WEBHOOK] Duplicate: order external_id=%s already exists as order_id=%s", order_external_id, existing_order.id)
        return {
            "received": True,
            "processed": False,
            "action": "duplicate",
            "detail": "La orden ya existe en el sistema",
            "order_id": existing_order.id,
        }

    webhook_actor_result = await db.execute(
        select(User)
        .where(User.client_id == account.client_id, User.is_active.is_(True))
        .order_by(User.id.asc())
    )
    webhook_actor = webhook_actor_result.scalars().first()
    if webhook_actor is None:
        logger.error("[ML][WEBHOOK] No active user found for client_id=%s, cannot create order", account.client_id)
        return {
            "received": True,
            "processed": False,
            "action": "ignored",
            "detail": "No hay usuario activo para registrar la orden en este cliente",
            "order_id": None,
        }

    valid_account = await _get_valid_account(db, account.client_id)
    resource_path = str(resource)
    if resource_path.startswith("http://") or resource_path.startswith("https://"):
        resource_url = resource_path
    else:
        resource_url = f"{ML_API_BASE_URL}{resource_path if resource_path.startswith('/') else f'/{resource_path}'}"

    logger.info("[ML][WEBHOOK] Fetching order detail from ML: %s", resource_url)

    async with httpx.AsyncClient(timeout=20) as http:
        order_response = await http.get(
            resource_url,
            headers={"Authorization": f"Bearer {valid_account.access_token}"},
        )

    logger.info("[ML][WEBHOOK] ML API responded with status=%s for order=%s", order_response.status_code, order_external_id)

    if order_response.status_code != 200:
        logger.error(
            "[ML][WEBHOOK] Failed to fetch order %s from ML: status=%s body=%s",
            order_external_id, order_response.status_code, order_response.text[:500],
        )
        return {
            "received": True,
            "processed": False,
            "action": "ignored",
            "detail": "No se pudo obtener el detalle de la orden desde Mercado Libre",
            "order_id": None,
        }

    order_data = order_response.json()
    order_items = order_data.get("order_items") or []
    if not order_items:
        logger.warning("[ML][WEBHOOK] Order %s has no items in ML response", order_external_id)
        return {
            "received": True,
            "processed": False,
            "action": "ignored",
            "detail": "Orden sin items",
            "order_id": None,
        }

    normalized_items = [
        normalized_item
        for order_item in order_items
        if (normalized_item := _normalize_order_item_payload(order_item)) is not None
    ]
    if not normalized_items:
        logger.warning(
            "[ML][WEBHOOK] Order %s: could not extract valid ml_item_id from items: %s",
            order_external_id,
            [oi.get("item", {}).get("id") for oi in order_items],
        )
        return {
            "received": True,
            "processed": False,
            "action": "ignored",
            "detail": "No se encontro un ml_item_id valido en la orden",
            "order_id": None,
        }
    shipping_data = _extract_shipping_address(order_data)

    from app.orders import service as orders_service

    aggregated_items_by_product: dict[int, dict] = {}
    first_unmapped_item: dict | None = None
    unmapped_items_count = 0

    for normalized_item in normalized_items:
        mapped_product = await resolve_ml_to_product(
            db,
            account.client_id,
            normalized_item["ml_item_id"],
            normalized_item["variation_id"],
        )
        if mapped_product is None:
            logger.warning(
                "[ML][WEBHOOK] Order %s: no mapping found for ml_item_id=%r variation_id=%r client_id=%s",
                order_external_id, normalized_item["ml_item_id"], normalized_item["variation_id"], account.client_id,
            )
            unmapped_items_count += 1
            if first_unmapped_item is None:
              first_unmapped_item = normalized_item
            continue

        logger.info(
            "[ML][WEBHOOK] Order %s: ml_item_id=%r mapped to product_id=%s (%s)",
            order_external_id, normalized_item["ml_item_id"], mapped_product.id, mapped_product.sku,
        )
        current_item = aggregated_items_by_product.get(mapped_product.id)
        if current_item is None:
            aggregated_items_by_product[mapped_product.id] = {
                "product_id": mapped_product.id,
                "quantity": normalized_item["quantity"],
            }
        else:
            current_item["quantity"] += normalized_item["quantity"]

    mapped_items_data = list(aggregated_items_by_product.values())
    all_items_mapped = len(mapped_items_data) > 0 and first_unmapped_item is None

    notes = "Creado automaticamente desde webhook de Mercado Libre"
    if len(normalized_items) > 1:
        notes = f"{notes}. Items detectados: {len(normalized_items)}"
    if not all_items_mapped and first_unmapped_item is not None:
        notes = (
            f"{notes}. Quedo pendiente de mapeo automatico: "
            f"{unmapped_items_count} item(s) sin mapping resuelto."
        )

    create_payload = {
        "client_id": account.client_id,
        "source": OrderSource.mercadolibre.value,
        "external_id": str(order_data.get("id") or order_external_id),
        "shipping_id": shipping_data["shipping_id"],
        "buyer_name": _coalesce_buyer_name(order_data),
        "address_line": shipping_data["address_line"],
        "city": shipping_data["city"],
        "state": shipping_data["state"],
        "postal_code": shipping_data["postal_code"],
        "address_reference": shipping_data["address_reference"],
        "notes": notes,
    }

    if all_items_mapped:
        if len(normalized_items) == 1:
            create_payload.update(
                {
                    "ml_item_id": normalized_items[0]["ml_item_id"],
                    "variation_id": normalized_items[0]["variation_id"],
                    "quantity": normalized_items[0]["quantity"],
                }
            )
        create_payload["items"] = mapped_items_data
    else:
        create_payload.update(
            {
                "ml_item_id": first_unmapped_item["ml_item_id"],
                "variation_id": first_unmapped_item["variation_id"],
                "quantity": first_unmapped_item["quantity"],
            }
        )

    created_order = await orders_service.create_order(
        db,
        webhook_actor,
        create_payload,
    )

    logger.info(
        "[ML][WEBHOOK] Order %s created successfully as order_id=%s (all_mapped=%s)",
        order_external_id, created_order["id"], all_items_mapped,
    )

    return {
        "received": True,
        "processed": True,
        "action": "created",
        "detail": "Orden importada desde Mercado Libre",
        "order_id": created_order["id"],
    }


async def _ingest_ml_order_data(
    db: AsyncSession,
    account: MercadoLibreAccount,
    order_data: dict,
    webhook_actor: User,
) -> dict:
    """Process a single ML order dict and persist it as an Order if not a duplicate."""
    from app.orders import service as orders_service

    order_external_id = str(order_data.get("id") or "")
    if not order_external_id:
        logger.warning("[ML][IMPORT] Skipping order with no ID")
        return {"processed": False, "action": "ignored", "detail": "Orden sin ID", "order_id": None}

    existing_result = await db.execute(
        select(Order).where(
            Order.client_id == account.client_id,
            Order.source == OrderSource.mercadolibre,
            Order.external_id == order_external_id,
        )
    )
    existing_order = existing_result.scalar_one_or_none()
    if existing_order is not None:
        logger.debug("[ML][IMPORT] Duplicate: order %s already exists as order_id=%s", order_external_id, existing_order.id)
        return {"processed": False, "action": "duplicate", "detail": "La orden ya existe en el sistema", "order_id": existing_order.id}

    order_items = order_data.get("order_items") or []
    if not order_items:
        logger.warning("[ML][IMPORT] Order %s has no items", order_external_id)
        return {"processed": False, "action": "ignored", "detail": "Orden sin items", "order_id": None}

    normalized_items = [
        normalized_item
        for order_item in order_items
        if (normalized_item := _normalize_order_item_payload(order_item)) is not None
    ]
    if not normalized_items:
        logger.warning(
            "[ML][IMPORT] Order %s: could not extract valid ml_item_id from items: %s",
            order_external_id, [oi.get("item", {}).get("id") for oi in order_items],
        )
        return {"processed": False, "action": "ignored", "detail": "No se encontro un ml_item_id valido en la orden", "order_id": None}

    shipping_data = _extract_shipping_address(order_data)

    aggregated_items_by_product: dict[int, dict] = {}
    first_unmapped_item: dict | None = None
    unmapped_items_count = 0

    for normalized_item in normalized_items:
        mapped_product = await resolve_ml_to_product(
            db,
            account.client_id,
            normalized_item["ml_item_id"],
            normalized_item["variation_id"],
        )
        if mapped_product is None:
            logger.warning(
                "[ML][IMPORT] Order %s: no mapping for ml_item_id=%r variation_id=%r client_id=%s",
                order_external_id, normalized_item["ml_item_id"], normalized_item["variation_id"], account.client_id,
            )
            unmapped_items_count += 1
            if first_unmapped_item is None:
                first_unmapped_item = normalized_item
            continue

        logger.info(
            "[ML][IMPORT] Order %s: ml_item_id=%r -> product_id=%s (%s)",
            order_external_id, normalized_item["ml_item_id"], mapped_product.id, mapped_product.sku,
        )
        current_item = aggregated_items_by_product.get(mapped_product.id)
        if current_item is None:
            aggregated_items_by_product[mapped_product.id] = {
                "product_id": mapped_product.id,
                "quantity": normalized_item["quantity"],
            }
        else:
            current_item["quantity"] += normalized_item["quantity"]

    mapped_items_data = list(aggregated_items_by_product.values())
    all_items_mapped = len(mapped_items_data) > 0 and first_unmapped_item is None

    notes = "Creado automaticamente desde Mercado Libre"
    if len(normalized_items) > 1:
        notes = f"{notes}. Items detectados: {len(normalized_items)}"
    if not all_items_mapped and first_unmapped_item is not None:
        notes = (
            f"{notes}. Quedo pendiente de mapeo automatico: "
            f"{unmapped_items_count} item(s) sin mapping resuelto."
        )

    create_payload = {
        "client_id": account.client_id,
        "source": OrderSource.mercadolibre.value,
        "external_id": order_external_id,
        "shipping_id": shipping_data["shipping_id"],
        "buyer_name": _coalesce_buyer_name(order_data),
        "address_line": shipping_data["address_line"],
        "city": shipping_data["city"],
        "state": shipping_data["state"],
        "postal_code": shipping_data["postal_code"],
        "address_reference": shipping_data["address_reference"],
        "notes": notes,
    }

    if all_items_mapped:
        if len(normalized_items) == 1:
            create_payload.update({
                "ml_item_id": normalized_items[0]["ml_item_id"],
                "variation_id": normalized_items[0]["variation_id"],
                "quantity": normalized_items[0]["quantity"],
            })
        create_payload["items"] = mapped_items_data
    else:
        create_payload.update({
            "ml_item_id": first_unmapped_item["ml_item_id"],
            "variation_id": first_unmapped_item["variation_id"],
            "quantity": first_unmapped_item["quantity"],
        })

    created_order = await orders_service.create_order(db, webhook_actor, create_payload)

    return {"processed": True, "action": "created", "detail": "Orden importada desde Mercado Libre", "order_id": created_order["id"]}


async def import_orders_from_ml(
    db: AsyncSession,
    client_id: int,
    date_from: date,
    date_to: date,
    user: User,
) -> dict:
    """Manually import ML orders for a date range. Returns a summary of imported/skipped orders."""
    account = await _get_valid_account(db, client_id)

    webhook_actor_result = await db.execute(
        select(User)
        .where(User.client_id == client_id, User.is_active.is_(True))
        .order_by(User.id.asc())
    )
    webhook_actor = webhook_actor_result.scalars().first()
    if webhook_actor is None:
        raise BadRequestError("No hay usuario activo para registrar las ordenes en este cliente")

    from_str = f"{date_from.isoformat()}T00:00:00.000-0000"
    to_str = f"{date_to.isoformat()}T23:59:59.000-0000"

    logger.info(
        "[ML][IMPORT] Starting manual import for client_id=%s ml_user_id=%s from=%s to=%s",
        client_id, account.ml_user_id, from_str, to_str,
    )

    total_found = 0
    imported = 0
    skipped_duplicate = 0
    skipped_other = 0
    failed = 0
    errors: list[str] = []

    limit = 50
    offset = 0

    async with httpx.AsyncClient(timeout=30) as http:
        while True:
            resp = await http.get(
                f"{ML_API_BASE_URL}/orders/search",
                params={
                    "seller": account.ml_user_id,
                    "order.date_created.from": from_str,
                    "order.date_created.to": to_str,
                    "limit": limit,
                    "offset": offset,
                },
                headers={"Authorization": f"Bearer {account.access_token}"},
            )
            logger.info("[ML][IMPORT] ML API search status=%s offset=%s", resp.status_code, offset)
            if resp.status_code != 200:
                logger.error("[ML][IMPORT] ML API error: status=%s body=%s", resp.status_code, resp.text[:500])
                raise BadRequestError(f"Error al consultar ordenes en Mercado Libre: {resp.text[:300]}")

            data = resp.json()
            results = data.get("results") or []
            paging = data.get("paging") or {}
            total = paging.get("total", 0)

            if offset == 0:
                total_found = total
                logger.info("[ML][IMPORT] Total orders found in ML for period: %s", total)

            for order_data in results:
                try:
                    result = await _ingest_ml_order_data(db, account, order_data, webhook_actor)
                    if result["action"] == "created":
                        imported += 1
                    elif result["action"] == "duplicate":
                        skipped_duplicate += 1
                    else:
                        skipped_other += 1
                except Exception as exc:
                    failed += 1
                    errors.append(f"Orden {order_data.get('id', '?')}: {str(exc)}")
                    logger.exception("[ML][IMPORT] Exception processing order %s", order_data.get("id"))

            offset += len(results)
            if offset >= total or not results:
                break

    logger.info(
        "[ML][IMPORT] Done client_id=%s: total=%s imported=%s duplicate=%s other=%s failed=%s",
        client_id, total_found, imported, skipped_duplicate, skipped_other, failed,
    )

    return {
        "total_found": total_found,
        "imported": imported,
        "skipped_duplicate": skipped_duplicate,
        "skipped_other": skipped_other,
        "failed": failed,
        "errors": errors,
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

    result = await db.execute(query)
    mappings = list(result.scalars().all())
    mapping = None
    if ml_variation_id is not None:
        mapping = next((item for item in mappings if item.ml_variation_id == ml_variation_id), None)
    if mapping is None:
        mapping = next((item for item in mappings if item.ml_variation_id is None), None)
    if mapping is None:
        return None
    return await db.get(Product, mapping.product_id)
