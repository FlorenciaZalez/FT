from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import require_operator, require_any, require_admin
from app.auth.models import User
from app.orders import service
from app.orders.schemas import (
    OrderCreate, OrderResponse, PickItemRequest, PickBySkuRequest,
    AssignOperatorRequest, OrderStatusLogResponse, BatchDispatchRequest,
    OrderUpdate, ResolveMarketplaceOrderRequest, BatchPickingScanRequest,
    ReturnReceiveRequest, MarkAwaitingReturnRequest,
)

router = APIRouter(prefix="/orders", tags=["Orders"])
returns_router = APIRouter(prefix="/returns", tags=["Returns"])


@router.get("")
async def list_orders(
    status: str | None = None,
    dominant_zone: str | None = None,
    mapping_status: str | None = None,
    source: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_orders(db, user, status, dominant_zone, mapping_status, source, skip, limit)


@router.post("", status_code=201)
async def create_order(
    body: OrderCreate,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_order(db, user, body.dict())


@router.put("/{order_id}")
async def update_order(
    order_id: int,
    body: OrderUpdate,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_order(db, order_id, user, body.dict(exclude_unset=True))


@router.post("/{order_id}/resolve-mapping")
async def resolve_marketplace_order_mapping(
    order_id: int,
    body: ResolveMarketplaceOrderRequest,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.resolve_marketplace_order_mapping(db, order_id, user, body.product_id)


@router.post("/{order_id}/mark-awaiting-return")
async def mark_awaiting_return(
    order_id: int,
    body: MarkAwaitingReturnRequest,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.mark_order_awaiting_return(db, order_id, user, body.notes)


@router.post("/batch-dispatch")
async def batch_dispatch(
    body: BatchDispatchRequest,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.batch_dispatch(
        db, user, body.order_ids, body.carrier, body.notes, body.transporter_id, body.register_transport_transfer
    )


@router.post("/print-pending-labels")
async def print_pending_labels(
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    pdf_content, headers = await service.print_pending_labels(db, user)
    return Response(content=pdf_content, media_type="application/pdf", headers=headers)


@router.post("/{order_id}/print-label")
async def print_order_label(
    order_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    pdf_content, headers = await service.print_order_label(db, order_id, user)
    return Response(content=pdf_content, media_type="application/pdf", headers=headers)


@router.post("/{order_id}/generate-manual-label")
async def generate_manual_label(
    order_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    pdf_content, headers = await service.generate_manual_label(db, order_id, user)
    return Response(content=pdf_content, media_type="application/pdf", headers=headers)


@router.post("/help-zone")
async def help_other_zone(
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.help_other_zone(db, user)


@router.post("/batch-picking/start")
async def start_batch_picking(
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.start_batch_picking_session(db, user)


@router.get("/batch-picking/active")
async def get_active_batch_picking(
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_active_batch_picking_session(db, user)


@router.get("/batch-picking/sessions/{session_id}")
async def get_batch_picking_session(
    session_id: int,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_batch_picking_session(db, session_id, user)


@router.post("/batch-picking/sessions/{session_id}/scan")
async def scan_batch_picking_session(
    session_id: int,
    body: BatchPickingScanRequest,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.scan_batch_picking_session(db, session_id, body.sku, user)


@router.get("/workload-status")
async def workload_status(
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.workload_status(db)


@router.get("/workload-hint")
async def workload_hint(
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.workload_hint(db, user)


@router.get("/scan-sku/{sku}")
async def scan_sku_for_dispatch(
    sku: str,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.find_prepared_by_sku(db, user, sku)


@router.get("/by-shipping/{shipping_id}")
async def get_order_by_shipping_id(
    shipping_id: str,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_order_by_shipping_id(db, user, shipping_id)


@router.get("/batches")
async def list_batches(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_batches(db, user, skip, limit)


@router.get("/batches/{batch_id}")
async def get_batch(
    batch_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_batch(db, batch_id, user)


@router.get("/{order_id}")
async def get_order(
    order_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_order(db, order_id, user)


@returns_router.post("/receive")
async def receive_return(
    body: ReturnReceiveRequest,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.receive_return(db, user, body.order_id, body.sku, body.condition, body.notes)


@router.post("/{order_id}/assign")
async def assign_operator(
    order_id: int,
    body: AssignOperatorRequest,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.assign_operator(db, order_id, body.operator_id, user)


@router.post("/{order_id}/pick")
async def pick_item(
    order_id: int,
    body: PickItemRequest,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.pick_item(db, order_id, body.order_item_id, body.scanned_sku, user)


@router.post("/{order_id}/pick-sku")
async def pick_by_sku(
    order_id: int,
    body: PickBySkuRequest,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.pick_by_sku(db, order_id, body.sku, user)


@router.post("/{order_id}/pack")
async def pack_order(
    order_id: int,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.pack_order(db, order_id, user)


@router.post("/{order_id}/dispatch")
async def dispatch_order(
    order_id: int,
    tracking_number: str | None = None,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.dispatch_order(db, order_id, user, tracking_number)


@router.post("/{order_id}/cancel")
async def cancel_order(
    order_id: int,
    reason: str | None = None,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.cancel_order(db, order_id, user, reason)


@router.post("/{order_id}/advance")
async def advance_order(
    order_id: int,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.advance_order(db, order_id, user)


@router.get("/{order_id}/history", response_model=list[OrderStatusLogResponse])
async def order_history(
    order_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_order_history(db, order_id, user)
