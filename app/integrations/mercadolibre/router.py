from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import require_any, require_admin
from app.auth.models import User
from app.common.permissions import check_tenant_access
from app.integrations.mercadolibre import service
from app.config import get_settings
from app.integrations.mercadolibre.schemas import (
    MLMappingCreate,
    MLMappingCreateResponse,
    MLMappingUpdate,
    MLMappingResponse,
    MLAuthUrlResponse,
    MLCallbackRequest,
    MLAccountResponse,
    MLWebhookNotification,
    MLWebhookProcessResponse,
    MLImportRequest,
    MLImportResult,
)

router = APIRouter(prefix="/integrations/ml", tags=["MercadoLibre"])


# ─── OAuth endpoints ─────────────────────────────────────────────

@router.get("/auth-url", response_model=MLAuthUrlResponse)
async def get_ml_auth_url(
    client_id: int,
    user: User = Depends(require_any),
):
    """Return the ML OAuth authorization URL for a given client."""
    check_tenant_access(user, client_id)
    return {"auth_url": service.get_auth_url(client_id)}


@router.get("/oauth-callback")
async def ml_oauth_callback_bridge(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
):
    """Bridge OAuth callback from ML to frontend hash route."""
    settings = get_settings()
    params = {
        key: value
        for key, value in {
            "code": code,
            "state": state,
            "error": error,
            "error_description": error_description,
        }.items()
        if value is not None and str(value).strip() != ""
    }

    target_url = settings.ML_FRONTEND_CALLBACK_URL
    if params:
        separator = "&" if "?" in target_url else "?"
        target_url = f"{target_url}{separator}{urlencode(params)}"

    return RedirectResponse(url=target_url, status_code=302)


@router.post("/callback", response_model=MLAccountResponse)
async def ml_callback(
    body: MLCallbackRequest,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    """Exchange an authorization code for tokens and connect the ML account."""
    check_tenant_access(user, body.client_id)
    account = await service.exchange_code(body.code, body.client_id, db)
    await db.commit()
    return account


@router.get("/account/{client_id}", response_model=MLAccountResponse)
async def get_ml_account(
    client_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    """Get the connected ML account for a client."""
    check_tenant_access(user, client_id)
    account = await service.get_account(db, client_id)
    if account is None:
        from app.common.exceptions import NotFoundError
        raise NotFoundError("No hay cuenta de Mercado Libre conectada")
    return account


@router.delete("/account/{client_id}", status_code=204)
async def disconnect_ml_account(
    client_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    """Disconnect (remove) the ML account for a client."""
    check_tenant_access(user, client_id)
    await service.disconnect_account(db, client_id)
    await db.commit()


@router.get("/webhook")
async def ml_webhook_healthcheck():
    """Mercado Libre webhook verification endpoint."""
    return {"status": "ok"}


@router.post("/webhook", response_model=MLWebhookProcessResponse)
async def ml_webhook_receiver(
    body: MLWebhookNotification,
    db: AsyncSession = Depends(get_db),
):
    """Public webhook receiver for Mercado Libre notifications."""
    result = await service.process_webhook_notification(db, body.dict())
    await db.commit()
    return result


@router.post("/import", response_model=MLImportResult)
async def import_ml_orders(
    body: MLImportRequest,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    """Manually import ML orders for a given date range."""
    check_tenant_access(user, body.client_id)
    result = await service.import_orders_from_ml(db, body.client_id, body.date_from, body.date_to, user)
    await db.commit()
    return result


# ─── Mappings endpoints ──────────────────────────────────────────

@router.get("/mappings", response_model=list[MLMappingResponse])
async def list_mappings(
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_mappings(db, user)


@router.post("/mappings", response_model=MLMappingCreateResponse, status_code=201)
async def create_mapping(
    body: MLMappingCreate,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_mapping(db, user, body.dict())


@router.put("/mappings/{mapping_id}", response_model=MLMappingResponse)
async def update_mapping(
    mapping_id: int,
    body: MLMappingUpdate,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_mapping(db, mapping_id, user, body.dict(exclude_unset=True))


@router.delete("/mappings/{mapping_id}", status_code=204)
async def delete_mapping(
    mapping_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_mapping(db, mapping_id, user)
