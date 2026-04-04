from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import require_operator, require_any
from app.auth.models import User
from app.stock import service
from app.stock.schemas import (
    StockInboundRequest, StockAdjustRequest, StockResponse,
    StockSummaryItem, StockMovementResponse,
    StockInRequest, StockOutRequest, StockListItem,
)

router = APIRouter(prefix="/stock", tags=["Stock"])


# ── Simplified endpoints (frontend stock page) ──


@router.get("", response_model=list[StockListItem])
async def stock_list(
    search: str | None = Query(None),
    client_id: int | None = Query(None, ge=1),
    status: str | None = Query(None),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    """Stock actual por producto (agregado de todas las ubicaciones)."""
    return await service.get_stock_list(db, user, search=search, client_id=client_id, status=status)


@router.post("/in", status_code=201)
async def stock_in(
    body: StockInRequest,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    """Ingreso de stock."""
    return await service.simple_inbound(db, user, body.product_id, body.quantity, body.reason)


@router.post("/out", status_code=201)
async def stock_out(
    body: StockOutRequest,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    """Egreso de stock. Valida que haya suficiente disponible."""
    return await service.simple_outbound(db, user, body.product_id, body.quantity, body.reason)


# ── Original detailed endpoints ──


@router.post("/inbound", response_model=StockResponse, status_code=201)
async def inbound_stock(
    body: StockInboundRequest,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    """Ingreso de mercadería al depósito."""
    return await service.inbound_stock(
        db, user, body.product_id, body.location_id, body.quantity, body.notes
    )


@router.post("/adjust", response_model=StockResponse)
async def adjust_stock(
    body: StockAdjustRequest,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    """Ajuste manual de stock (inventario)."""
    return await service.adjust_stock(
        db, user, body.product_id, body.location_id, body.new_quantity, body.notes
    )


@router.get("/summary", response_model=list[StockSummaryItem])
async def stock_summary(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    """Resumen de stock por producto y ubicación."""
    return await service.get_stock_summary(db, user, skip, limit)


@router.get("/movements")
async def stock_movements(
    product_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    """Historial de movimientos de stock."""
    return await service.get_movements(db, user, product_id, skip, limit)
