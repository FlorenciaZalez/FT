from collections import Counter
from io import BytesIO
from urllib.parse import quote

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload
from pypdf import PageObject, PdfReader, PdfWriter, Transformation
import qrcode
from reportlab.lib.units import mm
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.orders.models import (
    Order,
    OrderItem,
    OrderStatusLog,
    OrderStatus,
    OrderOperationType,
    ReturnCondition,
    ReturnReception,
    OrderLabelType,
    OrderSource,
    DispatchBatch,
    BatchPickingSession,
    BatchPickingSessionItem,
    BatchPickingSessionAssignment,
    BatchPickingScanLog,
)
from app.products.models import Product
from app.clients.models import Client
from app.transporters.models import Transporter
from app.stock.models import Stock
from app.locations.models import WarehouseLocation
from app.stock import service as stock_service
from app.auth.models import User, UserRole
from app.common.exceptions import NotFoundError, BadRequestError, ForbiddenError
from app.common.permissions import tenant_filter, check_tenant_access
from app.alerts.service import create_picking_error_alert
from app.shipping import service as shipping_service
from app.integrations.mercadolibre import service as mercadolibre_service
from app.integrations.mercadolibre.models import MLProductMapping, MLMappingReconciliationLog
from app.billing.service import record_prepared_order, record_transport_dispatch

MAPPING_STATUS_RESOLVED = "resolved"
MAPPING_STATUS_UNMAPPED = "unmapped"
BATCH_PICKING_STATUS_ACTIVE = "active"
BATCH_PICKING_STATUS_COMPLETED = "completed"
MAX_ML_SHIPMENT_LABELS_PER_REQUEST = 50
RETURN_REVIEW_LOCATION_CODE = "RET-REVIEW"
MERCADOLIBRE_LABEL_PAGE_SIZE = (100 * mm, 150 * mm)
MANUAL_LABEL_PAGE_SIZE = (4 * inch, 6 * inch)


def _display_operation_type(order: Order) -> str:
    if order.exchange_id:
        return "exchange"
    return order.operation_type.value if isinstance(order.operation_type, OrderOperationType) else order.operation_type


def _parse_operation_type(raw_operation_type: str) -> str:
    if raw_operation_type not in {"sale", "return", "exchange"}:
        raise BadRequestError("operation_type debe ser sale, return o exchange")
    return raw_operation_type


def _order_load_options():
    return (
        selectinload(Order.items).joinedload(OrderItem.product).joinedload(Product.location),
        selectinload(Order.client),
        selectinload(Order.dispatch_batch).selectinload(DispatchBatch.transporter),
        selectinload(Order.assigned_operator),
        selectinload(Order.return_receptions).selectinload(ReturnReception.stock_location),
        selectinload(Order.return_receptions).selectinload(ReturnReception.user),
    )


def _batch_session_load_options():
    return (
        selectinload(BatchPickingSession.user),
        selectinload(BatchPickingSession.items).selectinload(BatchPickingSessionItem.assignments),
    )


def _serialize_batch_picking_session(session: BatchPickingSession) -> dict:
    items = []
    total_units = 0
    picked_units = 0

    for item in session.items:
        total_units += item.quantity_total
        picked_units += item.quantity_picked
        location_codes = sorted({
            assignment.location_code
            for assignment in item.assignments
            if assignment.location_code
        })
        pending_assignments = [
            {
                "id": assignment.id,
                "order_id": assignment.order_id,
                "order_item_id": assignment.order_item_id,
                "order_number": assignment.order_number,
                "location_code": assignment.location_code,
                "quantity_total": assignment.quantity_total,
                "quantity_picked": assignment.quantity_picked,
                "is_complete": assignment.quantity_picked >= assignment.quantity_total,
            }
            for assignment in item.assignments
            if assignment.quantity_picked < assignment.quantity_total
        ]
        items.append(
            {
                "id": item.id,
                "product_id": item.product_id,
                "product_name": item.product_name,
                "sku": item.sku,
                "quantity_total": item.quantity_total,
                "quantity_picked": item.quantity_picked,
                "location_codes": location_codes,
                "is_complete": item.quantity_picked >= item.quantity_total,
                "pending_assignments": pending_assignments,
            }
        )

    return {
        "id": session.id,
        "status": session.status,
        "user_id": session.user_id,
        "user_name": session.user.full_name if session.user else None,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "completed_at": session.completed_at.isoformat() if session.completed_at else None,
        "total_units": total_units,
        "picked_units": picked_units,
        "is_complete": session.status == BATCH_PICKING_STATUS_COMPLETED,
        "items": items,
    }


def _apply_zone_visibility(query, user: User):
    if user.role != UserRole.admin and user.zones:
        query = query.where(
            or_(
                Order.dominant_zone.in_(user.zones),
                Order.assigned_operator_id == user.id,
            )
        )
    return query


async def _get_active_batch_picking_session_for_user(
    db: AsyncSession,
    user: User,
) -> BatchPickingSession | None:
    result = await db.execute(
        select(BatchPickingSession)
        .options(*_batch_session_load_options())
        .where(
            BatchPickingSession.user_id == user.id,
            BatchPickingSession.status == BATCH_PICKING_STATUS_ACTIVE,
        )
        .order_by(BatchPickingSession.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _get_batch_picking_session(
    db: AsyncSession,
    session_id: int,
    user: User,
    *,
    require_active: bool = False,
) -> BatchPickingSession:
    result = await db.execute(
        select(BatchPickingSession)
        .options(*_batch_session_load_options())
        .where(BatchPickingSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise NotFoundError(f"Batch picking session {session_id} not found")
    if user.role != UserRole.admin and session.user_id != user.id:
        raise ForbiddenError("No tenes acceso a esta sesión de batch picking")
    if require_active and session.status != BATCH_PICKING_STATUS_ACTIVE:
        raise BadRequestError("La sesión de batch picking ya fue completada")
    return session


async def _is_order_in_active_batch_session(db: AsyncSession, order_id: int) -> bool:
    result = await db.execute(
        select(BatchPickingSessionAssignment.id)
        .join(BatchPickingSessionItem, BatchPickingSessionAssignment.session_item_id == BatchPickingSessionItem.id)
        .join(BatchPickingSession, BatchPickingSessionItem.session_id == BatchPickingSession.id)
        .where(
            BatchPickingSessionAssignment.order_id == order_id,
            BatchPickingSession.status == BATCH_PICKING_STATUS_ACTIVE,
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _ensure_order_not_in_active_batch_session(db: AsyncSession, order_id: int) -> None:
    if await _is_order_in_active_batch_session(db, order_id):
        raise BadRequestError(
            "El pedido forma parte de una sesión activa de batch picking y no se puede procesar individualmente"
        )


def _serialize_order(order: Order, client_name: str | None = None) -> dict:
    """Convert Order ORM to a plain dict safe for JSON serialization."""
    return {
        "id": order.id,
        "client_id": order.client_id,
        "client_name": client_name,
        "order_number": order.order_number,
        "source": order.source.value if isinstance(order.source, OrderSource) else order.source,
        "source_order_id": order.source_order_id,
        "external_id": order.external_id,
        "shipping_id": order.shipping_id,
        "ml_item_id": order.ml_item_id,
        "variation_id": order.ml_variation_id,
        "requested_quantity": order.requested_quantity,
        "mapping_status": order.mapping_status,
        "operation_type": order.operation_type.value if isinstance(order.operation_type, OrderOperationType) else order.operation_type,
        "display_operation_type": _display_operation_type(order),
        "exchange_id": order.exchange_id,
        "status": order.status.value if isinstance(order.status, OrderStatus) else order.status,
        "shipping_label_url": order.shipping_label_url,
        "tracking_number": order.tracking_number,
        "label_printed": order.label_printed,
        "label_printed_at": order.label_printed_at.isoformat() if order.label_printed_at else None,
        "label_print_count": order.label_print_count,
        "label_generated": order.label_generated,
        "label_generated_at": order.label_generated_at.isoformat() if order.label_generated_at else None,
        "label_type": order.label_type.value if isinstance(order.label_type, OrderLabelType) else order.label_type,
        "buyer_name": order.buyer_name,
        "buyer_address": order.buyer_address,
        "address_line": order.address_line,
        "city": order.city,
        "state": order.state,
        "postal_code": order.postal_code,
        "cordon": order.cordon,
        "shipping_cost": float(order.shipping_cost) if order.shipping_cost is not None else None,
        "shipping_status": order.shipping_status,
        "address_reference": order.address_reference,
        "notes": order.notes,
        "assigned_operator_id": order.assigned_operator_id,
        "assigned_operator_name": order.assigned_operator.full_name if order.assigned_operator else None,
        "picked_at": order.picked_at.isoformat() if order.picked_at else None,
        "packed_at": order.packed_at.isoformat() if order.packed_at else None,
        "dispatched_at": order.dispatched_at.isoformat() if order.dispatched_at else None,
        "cancelled_at": order.cancelled_at.isoformat() if order.cancelled_at else None,
        "dispatch_batch_id": order.dispatch_batch_id,
        "dispatch_batch_number": order.dispatch_batch.batch_number if order.dispatch_batch else None,
        "dispatch_carrier": order.dispatch_batch.carrier if order.dispatch_batch else None,
        "dispatch_transporter_id": order.dispatch_batch.transporter_id if order.dispatch_batch else None,
        "dispatch_transporter_name": order.dispatch_batch.transporter.name if order.dispatch_batch and order.dispatch_batch.transporter else None,
        "dominant_zone": order.dominant_zone,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "updated_at": order.updated_at.isoformat() if order.updated_at else None,
        "items": [
            {
                "id": item.id,
                "product_id": item.product_id,
                "sku": item.sku,
                "product_name": item.product.name if item.product else None,
                "product_image_url": item.product.image_url if item.product else None,
                "quantity": item.quantity,
                "picked_quantity": item.picked_quantity,
                "location_code": item.location_code,
            }
            for item in order.items
        ],
        "return_receptions": [
            {
                "id": reception.id,
                "order_item_id": reception.order_item_id,
                "sku": reception.sku,
                "quantity": reception.quantity,
                "condition": reception.condition.value if isinstance(reception.condition, ReturnCondition) else reception.condition,
                "notes": reception.notes,
                "stock_location_code": reception.stock_location.code if reception.stock_location else None,
                "received_by": reception.received_by,
                "received_by_name": reception.user.full_name if reception.user else None,
                "received_at": reception.received_at.isoformat() if reception.received_at else None,
            }
            for reception in sorted(order.return_receptions, key=lambda item: item.received_at or datetime.min.replace(tzinfo=timezone.utc))
        ],
    }


# ──────────────────────────────────────────────
#  STATE MACHINE — Valid transitions
# ──────────────────────────────────────────────

VALID_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.pending: {OrderStatus.in_preparation, OrderStatus.cancelled},
    OrderStatus.in_preparation: {OrderStatus.prepared, OrderStatus.cancelled},
    OrderStatus.prepared: {OrderStatus.dispatched, OrderStatus.awaiting_return, OrderStatus.cancelled},
    OrderStatus.dispatched: {OrderStatus.awaiting_return},
    OrderStatus.awaiting_return: {OrderStatus.returned_pending_review, OrderStatus.returned_completed},
    OrderStatus.returned_pending_review: {OrderStatus.returned_completed},
    OrderStatus.returned_completed: set(),
    OrderStatus.cancelled: set(),    # terminal
}


def _validate_transition(current: OrderStatus, target: OrderStatus) -> None:
    if target not in VALID_TRANSITIONS.get(current, set()):
        raise BadRequestError(
            f"Invalid status transition: {current.value} → {target.value}"
        )


async def _log_status_change(
    db: AsyncSession, order: Order, new_status: OrderStatus, user_id: int | None, notes: str | None = None,
) -> None:
    log = OrderStatusLog(
        order_id=order.id,
        old_status=order.status.value,
        new_status=new_status.value,
        changed_by=user_id,
        notes=notes,
    )
    db.add(log)


def _generate_order_number() -> str:
    return f"ORD-{uuid.uuid4().hex[:10].upper()}"


def _normalize_external_id(data: dict) -> str | None:
    return data.get("external_id") or data.get("source_order_id")


def _normalize_postal_code(data: dict) -> str | None:
    return data.get("postal_code") or data.get("zip_code")


def _get_ml_variation_id(data: dict) -> str | None:
    return data.get("variation_id") or data.get("ml_variation_id")


def _chunked(values: list[Order], size: int) -> list[list[Order]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def _merge_pdf_documents(pdf_documents: list[bytes]) -> bytes:
    writer = PdfWriter()
    for document in pdf_documents:
        reader = PdfReader(BytesIO(document))
        for page in reader.pages:
            writer.add_page(page)

    if len(writer.pages) == 0:
        raise BadRequestError("No se pudo construir el PDF de etiquetas")

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _normalize_pdf_page_size(pdf_content: bytes, target_size: tuple[float, float]) -> bytes:
    target_width, target_height = target_size
    reader = PdfReader(BytesIO(pdf_content))
    writer = PdfWriter()

    for page in reader.pages:
        source_width = float(page.mediabox.width)
        source_height = float(page.mediabox.height)

        if source_width <= 0 or source_height <= 0:
            continue

        scale = min(target_width / source_width, target_height / source_height)
        offset_x = (target_width - (source_width * scale)) / 2
        offset_y = (target_height - (source_height * scale)) / 2

        normalized_page = PageObject.create_blank_page(
            writer,
            width=target_width,
            height=target_height,
        )
        normalized_page.merge_transformed_page(
            page,
            Transformation().scale(scale, scale).translate(offset_x, offset_y),
        )
        writer.add_page(normalized_page)

    if len(writer.pages) == 0:
        raise BadRequestError("No se pudo normalizar el PDF de etiquetas")

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _build_label_file_name(prefix: str) -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}.pdf"


def _build_maps_query(order: Order) -> str:
    parts = [
        order.address_line or order.buyer_address,
        order.city,
        order.state,
        order.postal_code,
    ]
    return ", ".join(str(part).strip() for part in parts if part and str(part).strip())


def _build_label_address_lines(order: Order) -> list[str]:
    primary_address = ", ".join(
        str(part).strip()
        for part in [order.address_line or order.buyer_address, order.city]
        if part and str(part).strip()
    )
    secondary_address = ", ".join(
        str(part).strip()
        for part in [order.state, order.postal_code]
        if part and str(part).strip()
    )

    lines: list[str] = []
    if primary_address:
        lines.extend(_wrap_text(primary_address, 30))
    if secondary_address:
        lines.extend(_wrap_text(secondary_address, 30))
    return lines


def _build_google_maps_url(order: Order) -> str:
    maps_query = _build_maps_query(order)
    if not maps_query:
        raise BadRequestError("El pedido no tiene una direccion valida para generar la etiqueta")
    return f"https://www.google.com/maps/search/?api=1&query={quote(maps_query)}"


def _build_qr_png_bytes(content: str) -> bytes:
    qr_code = qrcode.QRCode(box_size=6, border=2)
    qr_code.add_data(content)
    qr_code.make(fit=True)
    image = qr_code.make_image(fill_color="black", back_color="white")
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _wrap_text(value: str, max_chars: int) -> list[str]:
    words = value.split()
    if not words:
        return []

    lines: list[str] = []
    current_line = words[0]
    for word in words[1:]:
        candidate = f"{current_line} {word}"
        if len(candidate) <= max_chars:
            current_line = candidate
        else:
            lines.append(current_line)
            current_line = word
    lines.append(current_line)
    return lines


def _generate_manual_label_pdf(order: Order, client_name: str | None = None) -> bytes:
    maps_url = _build_google_maps_url(order)
    qr_bytes = _build_qr_png_bytes(maps_url)
    address_lines = _build_label_address_lines(order)

    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=MANUAL_LABEL_PAGE_SIZE)
    width, height = MANUAL_LABEL_PAGE_SIZE
    margin = 0.34 * inch
    content_width = width - (margin * 2)
    top_y = height - margin
    qr_size = 1.35 * inch
    qr_caption_width = qr_size + 0.1 * inch
    small_font = 7
    medium_font = 10
    large_font = 17

    pdf.setTitle(f"Etiqueta {order.order_number}")
    pdf.setStrokeColorRGB(0.83, 0.86, 0.9)
    pdf.setLineWidth(0.8)
    pdf.roundRect(margin, margin, content_width, height - (margin * 2), 10, stroke=1, fill=0)

    header_height = 0.56 * inch
    pdf.setFillColorRGB(0.94, 0.96, 0.98)
    pdf.roundRect(margin, top_y - header_height, content_width, header_height, 10, stroke=0, fill=1)
    pdf.setFillColorRGB(0.12, 0.15, 0.19)
    pdf.setFont("Helvetica-Bold", medium_font)
    pdf.drawString(margin + 0.16 * inch, top_y - 0.22 * inch, "ENVIO MANUAL")
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawRightString(width - margin - 0.16 * inch, top_y - 0.24 * inch, order.order_number)

    current_y = top_y - header_height - 0.18 * inch
    left_x = margin + 0.16 * inch
    left_width = content_width - 0.32 * inch

    pdf.setStrokeColorRGB(0.87, 0.89, 0.92)
    pdf.line(left_x, current_y, width - margin - 0.16 * inch, current_y)
    current_y -= 0.2 * inch

    pdf.setFillColorRGB(0.42, 0.46, 0.52)
    pdf.setFont("Helvetica-Bold", small_font)
    pdf.drawString(left_x, current_y, "DESTINATARIO")
    current_y -= 0.16 * inch

    pdf.setFillColorRGB(0.08, 0.1, 0.13)
    pdf.setFont("Helvetica-Bold", 13)
    recipient_name = order.buyer_name or "Sin nombre"
    for line in _wrap_text(recipient_name, 28)[:2]:
        pdf.drawString(left_x, current_y, line)
        current_y -= 0.2 * inch

    current_y -= 0.04 * inch
    pdf.setFillColorRGB(0.42, 0.46, 0.52)
    pdf.setFont("Helvetica-Bold", small_font)
    pdf.drawString(left_x, current_y, "DIRECCION")
    current_y -= 0.18 * inch

    pdf.setFillColorRGB(0.04, 0.05, 0.07)
    pdf.setFont("Helvetica-Bold", large_font)
    for line in address_lines[:3]:
        pdf.drawString(left_x, current_y, line)
        current_y -= 0.24 * inch

    current_y -= 0.02 * inch
    pdf.setStrokeColorRGB(0.9, 0.92, 0.94)
    pdf.line(left_x, current_y, width - margin - 0.16 * inch, current_y)
    current_y -= 0.18 * inch

    pdf.setFillColorRGB(0.42, 0.46, 0.52)
    pdf.setFont("Helvetica-Bold", small_font)
    pdf.drawString(left_x, current_y, "CLIENTE")
    pdf.setFillColorRGB(0.2, 0.24, 0.29)
    pdf.setFont("Helvetica", 9)
    pdf.drawString(left_x + 0.62 * inch, current_y, client_name or f"#{order.client_id}")

    current_y -= 0.22 * inch
    detail_lines: list[tuple[str, list[str]]] = []
    if order.address_reference:
        detail_lines.append(("Referencia", _wrap_text(order.address_reference, 28)[:2]))
    if order.notes:
        detail_lines.append(("Notas", _wrap_text(order.notes, 28)[:2]))
    if order.tracking_number:
        detail_lines.append(("Tracking", [order.tracking_number]))

    for label, lines in detail_lines:
        pdf.setFillColorRGB(0.42, 0.46, 0.52)
        pdf.setFont("Helvetica-Bold", small_font)
        pdf.drawString(left_x, current_y, label.upper())
        current_y -= 0.14 * inch
        pdf.setFillColorRGB(0.22, 0.26, 0.31)
        pdf.setFont("Helvetica", 8)
        for line in lines:
            pdf.drawString(left_x, current_y, line)
            current_y -= 0.14 * inch
        current_y -= 0.04 * inch

    qr_x = width - margin - qr_size - 0.16 * inch
    qr_y = margin + 0.45 * inch
    pdf.drawImage(
        ImageReader(BytesIO(qr_bytes)),
        qr_x,
        qr_y,
        width=qr_size,
        height=qr_size,
        preserveAspectRatio=True,
        mask="auto",
    )

    pdf.setStrokeColorRGB(0.87, 0.89, 0.92)
    pdf.rect(qr_x - 0.08 * inch, qr_y - 0.08 * inch, qr_size + 0.16 * inch, qr_size + 0.16 * inch, stroke=1, fill=0)
    pdf.setFillColorRGB(0.32, 0.36, 0.41)
    pdf.setFont("Helvetica", 7)
    qr_caption_y = qr_y - 0.16 * inch
    for index, line in enumerate(_wrap_text("Escanear para abrir en Google Maps", 18)[:2]):
        pdf.drawCentredString(qr_x + (qr_caption_width / 2), qr_caption_y - (index * 0.12 * inch), line)

    pdf.showPage()
    pdf.save()
    return output.getvalue()


def _parse_return_condition(raw_condition: str) -> ReturnCondition:
    try:
        return ReturnCondition(raw_condition)
    except ValueError as exc:
        raise BadRequestError("La condición debe ser good, damaged o review") from exc


async def _get_or_create_return_review_location(db: AsyncSession) -> WarehouseLocation:
    result = await db.execute(
        select(WarehouseLocation).where(WarehouseLocation.code == RETURN_REVIEW_LOCATION_CODE)
    )
    location = result.scalar_one_or_none()
    if location is None:
        location = WarehouseLocation(
            code=RETURN_REVIEW_LOCATION_CODE,
            zone="RET",
            aisle="REV",
            shelf="1",
            position=1,
            description="Ubicación de devoluciones pendientes de revisión",
        )
        db.add(location)
        await db.flush()
    return location


async def _resolve_return_location(
    db: AsyncSession,
    order_item: OrderItem,
    condition: ReturnCondition,
) -> WarehouseLocation | None:
    if condition == ReturnCondition.damaged:
        return None
    if condition == ReturnCondition.review:
        return await _get_or_create_return_review_location(db)

    product = order_item.product
    if product and product.location:
        return product.location

    default_location = await stock_service._get_default_location(db)
    return default_location


async def _collect_printable_label_orders(db: AsyncSession, user: User) -> list[Order]:
    if user.role == UserRole.client:
        raise ForbiddenError("No tenes permisos para imprimir etiquetas")

    query = (
        select(Order)
        .options(
            selectinload(Order.items),
            selectinload(Order.client),
            selectinload(Order.dispatch_batch).selectinload(DispatchBatch.transporter),
            selectinload(Order.assigned_operator),
        )
        .where(
            Order.operation_type == OrderOperationType.sale,
            Order.status == OrderStatus.prepared,
            Order.shipping_id.isnot(None),
            Order.shipping_id != "",
            Order.label_printed.is_(False),
        )
        .order_by(Order.created_at.asc(), Order.id.asc())
    )
    query = tenant_filter(query, Order, user)
    if user.role != UserRole.admin and user.zones:
        query = _apply_zone_visibility(query, user)

    result = await db.execute(query)
    return list(result.scalars().all())


async def _render_order_label_pdfs(
    db: AsyncSession,
    orders: list[Order],
) -> tuple[list[bytes], list[Order], list[str]]:
    pdf_documents: list[bytes] = []
    successful_orders: list[Order] = []
    failed_messages: list[str] = []

    orders_by_client: dict[int, list[Order]] = {}
    for order in orders:
        orders_by_client.setdefault(order.client_id, []).append(order)

    for client_orders in orders_by_client.values():
        for chunk in _chunked(client_orders, MAX_ML_SHIPMENT_LABELS_PER_REQUEST):
            shipment_ids = [str(order.shipping_id).strip() for order in chunk if order.shipping_id]
            try:
                pdf_documents.append(
                    await mercadolibre_service.download_shipping_labels_pdf(
                        db,
                        chunk[0].client_id,
                        shipment_ids,
                    )
                )
                successful_orders.extend(chunk)
                continue
            except BadRequestError:
                pass

            for order in chunk:
                try:
                    pdf_documents.append(
                        await mercadolibre_service.download_shipping_labels_pdf(
                            db,
                            order.client_id,
                            [str(order.shipping_id)],
                        )
                    )
                    successful_orders.append(order)
                except BadRequestError as exc:
                    err_msg = str(exc)
                    if "NOT_PRINTABLE_STATUS" in err_msg or "delivered" in err_msg.lower():
                        # Shipment already delivered in ML — generate a local fallback label.
                        # Older imported orders may not have receiver address data embedded, so hydrate it from shipment detail first.
                        if order.source == OrderSource.mercadolibre and not _build_maps_query(order):
                            if order.external_id:
                                order_detail = await mercadolibre_service.fetch_order_detail(
                                    db,
                                    order.client_id,
                                    str(order.external_id),
                                )
                                if order_detail is not None:
                                    shipping_data = mercadolibre_service._extract_shipping_address(order_detail)
                                    order.address_line = shipping_data.get("address_line")
                                    order.city = shipping_data.get("city")
                                    order.state = shipping_data.get("state")
                                    order.postal_code = shipping_data.get("postal_code")
                                    if shipping_data.get("address_reference") and not order.address_reference:
                                        order.address_reference = shipping_data.get("address_reference")

                            if order.shipping_id and not _build_maps_query(order):
                                shipping_data = await mercadolibre_service.fetch_shipping_address(
                                    db,
                                    order.client_id,
                                    str(order.shipping_id),
                                )
                                order.address_line = shipping_data.get("address_line")
                                order.city = shipping_data.get("city")
                                order.state = shipping_data.get("state")
                                order.postal_code = shipping_data.get("postal_code")
                                if shipping_data.get("address_reference") and not order.address_reference:
                                    order.address_reference = shipping_data.get("address_reference")

                        if not _build_maps_query(order):
                            failed_messages.append(
                                f"{order.order_number}: El pedido no tiene una direccion valida para generar la etiqueta"
                            )
                            continue

                        client_name = order.client.name if order.client else None
                        pdf_documents.append(_generate_manual_label_pdf(order, client_name))
                        successful_orders.append(order)
                    else:
                        failed_messages.append(f"{order.order_number}: {exc}")

    return pdf_documents, successful_orders, failed_messages


def _mark_orders_as_label_printed(
    orders: list[Order],
    printed_at: datetime,
    label_type: OrderLabelType,
) -> None:
    for order in orders:
        order.label_printed = True
        order.label_printed_at = printed_at
        order.label_print_count = (order.label_print_count or 0) + 1
        order.label_generated = True
        order.label_generated_at = printed_at
        order.label_type = label_type.value


async def _generate_order_labels_pdf(
    db: AsyncSession,
    orders: list[Order],
) -> tuple[bytes, list[Order], list[str]]:
    pdf_documents, successful_orders, failed_messages = await _render_order_label_pdfs(db, orders)
    if not successful_orders or not pdf_documents:
        detail = failed_messages[0] if failed_messages else "Mercado Libre no devolvió ninguna etiqueta imprimible"
        raise BadRequestError(f"No se pudo generar ninguna etiqueta. {detail}")

    combined_pdf = _normalize_pdf_page_size(
        _merge_pdf_documents(pdf_documents),
        MERCADOLIBRE_LABEL_PAGE_SIZE,
    )
    printed_at = datetime.now(timezone.utc)
    _mark_orders_as_label_printed(successful_orders, printed_at, OrderLabelType.external)
    await db.flush()
    return combined_pdf, successful_orders, failed_messages


def _ensure_manual_label_eligible(order: Order) -> None:
    if order.source != OrderSource.manual:
        raise BadRequestError("Solo se pueden generar etiquetas manuales para pedidos manuales")
    if order.operation_type != OrderOperationType.sale:
        raise BadRequestError("La etiqueta manual solo aplica a pedidos de entrega")
    if order.status == OrderStatus.cancelled:
        raise BadRequestError("No se puede generar la etiqueta de un pedido cancelado")
    if not _build_maps_query(order):
        raise BadRequestError("El pedido no tiene direccion suficiente para generar la etiqueta")


async def _resolve_product_and_location(
    db: AsyncSession,
    user: User,
    client_id: int,
    product_id: int,
) -> tuple[Product, str | None]:
    product = await db.get(Product, product_id)
    if product is None:
        raise NotFoundError(f"Product {product_id} not found")
    check_tenant_access(user, product.client_id)

    location_code = None
    if product.location:
        location_code = product.location.code
    else:
        stock_result = await db.execute(
            select(Stock, WarehouseLocation)
            .join(WarehouseLocation, Stock.location_id == WarehouseLocation.id)
            .where(Stock.product_id == product.id, Stock.client_id == client_id)
            .order_by(Stock.quantity_available.desc())
            .limit(1)
        )
        stock_row = stock_result.first()
        location_code = stock_row[1].code if stock_row else None
    return product, location_code


def _validate_items_payload(items_data: list[dict]) -> None:
    if not items_data:
        raise BadRequestError("Order must have at least one item")
    seen_products: set[int] = set()
    for item_data in items_data:
        quantity = item_data.get("quantity", 0)
        product_id = item_data.get("product_id")
        if product_id in seen_products:
            raise BadRequestError("No se puede repetir el mismo producto en el pedido")
        seen_products.add(product_id)
        if quantity is None or quantity <= 0:
            raise BadRequestError("La cantidad de cada producto debe ser mayor a 0")


def _validate_ml_payload(data: dict) -> None:
    ml_item_id = data.get("ml_item_id")
    quantity = data.get("quantity")
    if not ml_item_id:
        raise BadRequestError("ml_item_id es obligatorio para pedidos de MercadoLibre")
    if quantity is None or quantity <= 0:
        raise BadRequestError("quantity debe ser mayor a 0 para pedidos de MercadoLibre")


async def _create_order_item(
    db: AsyncSession,
    user: User,
    order: Order,
    product: Product,
    quantity: int,
    location_code: str | None,
    *,
    reserve_stock: bool = True,
) -> OrderItem:
    order_item = OrderItem(
        order_id=order.id,
        product_id=product.id,
        sku=product.sku,
        quantity=quantity,
        picked_quantity=0,
        location_code=location_code,
    )
    db.add(order_item)
    if reserve_stock:
        await stock_service.reserve_stock(
            db, order.client_id, product.id, quantity, order.id, user.id
        )
    return order_item


def _initial_status_for_operation(operation_type: OrderOperationType) -> OrderStatus:
    if operation_type == OrderOperationType.return_:
        return OrderStatus.prepared
    return OrderStatus.pending


async def _reload_order_with_relations(db: AsyncSession, order_id: int) -> Order:
    result = await db.execute(
        select(Order)
        .options(*_order_load_options())
        .where(Order.id == order_id)
    )
    return result.scalar_one()


async def _create_manual_internal_order(
    db: AsyncSession,
    user: User,
    *,
    client_id: int,
    data: dict,
    items_data: list[dict],
    operation_type: OrderOperationType,
    exchange_id: str | None = None,
) -> Order:
    order = Order(
        client_id=client_id,
        order_number=_generate_order_number(),
        source=OrderSource.manual,
        source_order_id=_normalize_external_id(data),
        external_id=_normalize_external_id(data),
        shipping_id=data.get("shipping_id"),
        requested_quantity=data.get("quantity"),
        mapping_status=MAPPING_STATUS_RESOLVED,
        operation_type=operation_type,
        exchange_id=exchange_id,
        status=_initial_status_for_operation(operation_type),
        buyer_name=data.get("buyer_name"),
        buyer_address=data.get("buyer_address"),
        address_line=data.get("address_line"),
        city=data.get("city"),
        state=data.get("state"),
        postal_code=_normalize_postal_code(data),
        address_reference=data.get("address_reference"),
        shipping_label_url=data.get("shipping_label_url"),
        notes=data.get("notes"),
    )
    db.add(order)
    await db.flush()

    products_by_id: dict[int, Product] = {}
    created_items: list[OrderItem] = []
    reserve_stock = operation_type == OrderOperationType.sale

    for item_data in items_data:
        product, location_code = await _resolve_product_and_location(db, user, client_id, item_data["product_id"])
        products_by_id[product.id] = product
        created_items.append(
            await _create_order_item(
                db,
                user,
                order,
                product,
                item_data["quantity"],
                location_code if reserve_stock else None,
                reserve_stock=reserve_stock,
            )
        )

    log_note = "Order created" if operation_type == OrderOperationType.sale else "Return pickup order created"
    await _log_status_change(db, order, order.status, user.id, log_note)
    await db.flush()

    if reserve_stock:
        order.dominant_zone = _compute_dominant_zone(created_items)
        if created_items:
            await shipping_service.calculate_shipping(db, order, created_items, products_by_id)
    else:
        order.dominant_zone = None

    await db.flush()
    return await _reload_order_with_relations(db, order.id)


def _ensure_ready_for_picking(order: Order) -> None:
    if order.operation_type != OrderOperationType.sale:
        raise BadRequestError("Solo los pedidos de entrega participan del flujo de picking")
    if order.mapping_status == MAPPING_STATUS_UNMAPPED:
        raise BadRequestError("El pedido no tiene mapping resuelto y no puede pasar a picking")
    if not order.items:
        raise BadRequestError("El pedido no tiene productos asignados")


def _compute_dominant_zone(items: list[OrderItem]) -> str | None:
    """Determine the dominant warehouse zone (aisle) for an order.

    Uses location_code (format "ZONE-aisle-shelf-pos") to extract the zone
    prefix.  The zone with the most items (by quantity) wins.  Ties are
    broken alphabetically (lowest zone first).
    """
    zone_counts: Counter[str] = Counter()
    for item in items:
        if item.location_code:
            zone = item.location_code.split("-")[0]
            zone_counts[zone] += item.quantity
    if not zone_counts:
        return None
    max_count = max(zone_counts.values())
    # Among tied zones, pick alphabetically first
    candidates = sorted(z for z, c in zone_counts.items() if c == max_count)
    return candidates[0]


# ──────────────────────────────────────────────
#  CREATE ORDER
# ──────────────────────────────────────────────

async def create_order(
    db: AsyncSession, user: User, data: dict,
) -> dict:
    client_id = data.pop("client_id", None) or user.client_id
    if client_id is None:
        raise BadRequestError("client_id is required")
    check_tenant_access(user, client_id)

    requested_operation_type = _parse_operation_type(data.get("operation_type", "sale"))
    items_data = data.pop("items", [])
    delivery_items_data = data.pop("delivery_items", [])
    return_items_data = data.pop("return_items", [])
    source = OrderSource(data.get("source", "manual"))
    external_id = _normalize_external_id(data)
    postal_code = _normalize_postal_code(data)
    ml_variation_id = _get_ml_variation_id(data)

    if requested_operation_type in {"return", "exchange"} and source != OrderSource.manual:
        raise BadRequestError("Las operaciones return y exchange solo se soportan para pedidos manuales")

    if requested_operation_type == "return":
        return_payload_items = return_items_data or items_data
        _validate_items_payload(return_payload_items)
        return_order = await _create_manual_internal_order(
            db,
            user,
            client_id=client_id,
            data=data,
            items_data=return_payload_items,
            operation_type=OrderOperationType.return_,
        )
        return _serialize_order(return_order, return_order.client.name if return_order.client else None)

    if requested_operation_type == "exchange":
        sale_items = delivery_items_data or items_data
        _validate_items_payload(sale_items)
        _validate_items_payload(return_items_data)
        exchange_id = str(uuid.uuid4())

        delivery_order = await _create_manual_internal_order(
            db,
            user,
            client_id=client_id,
            data=data,
            items_data=sale_items,
            operation_type=OrderOperationType.sale,
            exchange_id=exchange_id,
        )
        await _create_manual_internal_order(
            db,
            user,
            client_id=client_id,
            data=data,
            items_data=return_items_data,
            operation_type=OrderOperationType.return_,
            exchange_id=exchange_id,
        )
        refreshed_delivery = await _reload_order_with_relations(db, delivery_order.id)
        return _serialize_order(refreshed_delivery, refreshed_delivery.client.name if refreshed_delivery.client else None)

    if source == OrderSource.mercadolibre and not items_data:
        _validate_ml_payload(data)
    else:
        _validate_items_payload(items_data)

    order = Order(
        client_id=client_id,
        order_number=_generate_order_number(),
        source=source,
        source_order_id=external_id,
        external_id=external_id,
        shipping_id=data.get("shipping_id"),
        ml_item_id=data.get("ml_item_id"),
        ml_variation_id=ml_variation_id,
        requested_quantity=data.get("quantity"),
        mapping_status=MAPPING_STATUS_RESOLVED if source != OrderSource.mercadolibre or bool(items_data) else None,
        operation_type=OrderOperationType.sale,
        status=OrderStatus.pending,
        buyer_name=data.get("buyer_name"),
        buyer_address=data.get("buyer_address"),
        address_line=data.get("address_line"),
        city=data.get("city"),
        state=data.get("state"),
        postal_code=postal_code,
        address_reference=data.get("address_reference"),
        shipping_label_url=data.get("shipping_label_url"),
        notes=data.get("notes"),
    )
    db.add(order)
    await db.flush()

    products_by_id: dict[int, Product] = {}

    if source == OrderSource.mercadolibre and not items_data:
        mapped_product = await mercadolibre_service.resolve_ml_to_product(
            db,
            client_id,
            data["ml_item_id"],
            ml_variation_id,
        )
        if mapped_product is None:
            order.mapping_status = MAPPING_STATUS_UNMAPPED
            await _log_status_change(db, order, OrderStatus.pending, user.id, "Order created without ML mapping")
            await db.flush()
            result = await db.execute(
                select(Order)
                .options(selectinload(Order.items), selectinload(Order.client), selectinload(Order.dispatch_batch).selectinload(DispatchBatch.transporter), selectinload(Order.assigned_operator))
                .where(Order.id == order.id)
            )
            order = result.scalar_one()
            return _serialize_order(order, order.client.name if order.client else None)

        order.mapping_status = MAPPING_STATUS_RESOLVED
        items_data = [{"product_id": mapped_product.id, "quantity": data["quantity"]}]

    # Create items and reserve stock
    for item_data in items_data:
        product, location_code = await _resolve_product_and_location(
            db, user, client_id, item_data["product_id"]
        )
        products_by_id[product.id] = product
        await _create_order_item(db, user, order, product, item_data["quantity"], location_code, reserve_stock=True)

    await _log_status_change(db, order, OrderStatus.pending, user.id, "Order created")
    await db.flush()

    # Compute dominant zone from item locations
    items_result = await db.execute(
        select(OrderItem).where(OrderItem.order_id == order.id)
    )
    order_items = list(items_result.scalars().all())
    order.dominant_zone = _compute_dominant_zone(order_items)
    if order_items:
        await shipping_service.calculate_shipping(db, order, order_items, products_by_id)
    await db.flush()

    # Re-fetch with eager loading
    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.client), selectinload(Order.dispatch_batch).selectinload(DispatchBatch.transporter), selectinload(Order.assigned_operator))
        .where(Order.id == order.id)
    )
    order = result.scalar_one()
    return _serialize_order(order, order.client.name if order.client else None)


async def update_order(
    db: AsyncSession,
    order_id: int,
    user: User,
    data: dict,
) -> dict:
    order = await _get_order(db, order_id, user)
    if order.status != OrderStatus.pending:
        raise BadRequestError("Solo se pueden editar pedidos pendientes")
    await _ensure_order_not_in_active_batch_session(db, order.id)

    items_data = data.pop("items", None)
    if "external_id" in data:
        data["source_order_id"] = data["external_id"]
    if "variation_id" in data:
        data["ml_variation_id"] = data.pop("variation_id")
    if "zip_code" in data:
        data["postal_code"] = data.pop("zip_code")
    products_by_id: dict[int, Product] = {}

    if items_data is not None:
        _validate_items_payload(items_data)
        current_items_by_product = {item.product_id: item for item in order.items}
        requested_product_ids = {item["product_id"] for item in items_data}

        for product_id, current_item in list(current_items_by_product.items()):
            if product_id in requested_product_ids:
                continue
            await stock_service.release_stock(
                db, order.client_id, current_item.product_id, current_item.quantity, order.id, user.id
            )
            await db.delete(current_item)

        for item_data in items_data:
            product, location_code = await _resolve_product_and_location(
                db, user, order.client_id, item_data["product_id"]
            )
            products_by_id[product.id] = product
            quantity = item_data["quantity"]
            current_item = current_items_by_product.get(product.id)

            if current_item is None:
                new_item = OrderItem(
                    order_id=order.id,
                    product_id=product.id,
                    sku=product.sku,
                    quantity=quantity,
                    picked_quantity=0,
                    location_code=location_code,
                )
                db.add(new_item)
                await stock_service.reserve_stock(
                    db, order.client_id, product.id, quantity, order.id, user.id
                )
                continue

            delta = quantity - current_item.quantity
            if delta > 0:
                await stock_service.reserve_stock(
                    db, order.client_id, product.id, delta, order.id, user.id
                )
            elif delta < 0:
                await stock_service.release_stock(
                    db, order.client_id, product.id, abs(delta), order.id, user.id
                )

            current_item.sku = product.sku
            current_item.quantity = quantity
            current_item.location_code = location_code
            current_item.picked_quantity = min(current_item.picked_quantity, quantity)

    for key, value in data.items():
        setattr(order, key, value)

    await db.flush()

    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.client), selectinload(Order.dispatch_batch).selectinload(DispatchBatch.transporter), selectinload(Order.assigned_operator))
        .where(Order.id == order.id)
    )
    order = result.scalar_one()
    order.dominant_zone = _compute_dominant_zone(list(order.items))
    if order.items:
        await shipping_service.calculate_shipping(db, order, list(order.items), products_by_id if products_by_id else None)
    await db.flush()
    await db.refresh(order)
    return _serialize_order(order, order.client.name if order.client else None)


async def resolve_marketplace_order_mapping(
    db: AsyncSession,
    order_id: int,
    user: User,
    product_id: int,
) -> dict:
    order = await _get_order(db, order_id, user)
    if order.source != OrderSource.mercadolibre:
        raise BadRequestError("Solo se pueden resolver pedidos de MercadoLibre")
    if not order.ml_item_id:
        raise BadRequestError("El pedido no tiene ml_item_id asociado")
    if order.requested_quantity is None or order.requested_quantity <= 0:
        raise BadRequestError("El pedido no tiene cantidad externa válida")

    product, location_code = await _resolve_product_and_location(db, user, order.client_id, product_id)
    await mercadolibre_service.upsert_mapping(
        db,
        user,
        client_id=order.client_id,
        product_id=product.id,
        ml_item_id=order.ml_item_id,
        ml_variation_id=order.ml_variation_id,
    )

    for item in list(order.items):
        await stock_service.release_stock(
            db, order.client_id, item.product_id, item.quantity, order.id, user.id
        )
        await db.delete(item)

    await db.flush()
    await _create_order_item(db, user, order, product, order.requested_quantity, location_code)
    order.mapping_status = MAPPING_STATUS_RESOLVED

    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.client), selectinload(Order.dispatch_batch).selectinload(DispatchBatch.transporter), selectinload(Order.assigned_operator))
        .where(Order.id == order.id)
    )
    order = result.scalar_one()
    order.dominant_zone = _compute_dominant_zone(list(order.items))
    await shipping_service.calculate_shipping(db, order, list(order.items), {product.id: product})
    await db.flush()
    await db.refresh(order)
    return _serialize_order(order, order.client.name if order.client else None)


async def reconcile_unmapped_orders_for_mapping(
    db: AsyncSession,
    user: User,
    mapping: MLProductMapping,
) -> int:
    product, location_code = await _resolve_product_and_location(
        db, user, mapping.client_id, mapping.product_id
    )

    query = (
        select(Order)
        .options(selectinload(Order.items))
        .where(
            Order.client_id == mapping.client_id,
            Order.source == OrderSource.mercadolibre,
            Order.status == OrderStatus.pending,
            Order.mapping_status == MAPPING_STATUS_UNMAPPED,
            Order.ml_item_id == mapping.ml_item_id,
        )
    )
    if mapping.ml_variation_id is not None:
        query = query.where(Order.ml_variation_id == mapping.ml_variation_id)

    result = await db.execute(query.order_by(Order.created_at.asc()))
    orders = list(result.scalars().all())
    resolved_count = 0

    for order in orders:
        try:
            async with db.begin_nested():
                for item in list(order.items):
                    await stock_service.release_stock(
                        db, order.client_id, item.product_id, item.quantity, order.id, user.id
                    )
                    await db.delete(item)

                await db.flush()

                await _create_order_item(
                    db,
                    user,
                    order,
                    product,
                    order.requested_quantity or 0,
                    location_code,
                )
                order.mapping_status = MAPPING_STATUS_RESOLVED

                items_result = await db.execute(
                    select(OrderItem).where(OrderItem.order_id == order.id)
                )
                order_items = list(items_result.scalars().all())
                order.dominant_zone = _compute_dominant_zone(order_items)
                await shipping_service.calculate_shipping(
                    db,
                    order,
                    order_items,
                    {product.id: product},
                )
                db.add(
                    MLMappingReconciliationLog(
                        order_id=order.id,
                        mapping_id=mapping.id,
                    )
                )
                resolved_count += 1
        except Exception:
            continue

    return resolved_count


# ──────────────────────────────────────────────
#  ASSIGN OPERATOR
# ──────────────────────────────────────────────

async def assign_operator(db: AsyncSession, order_id: int, operator_id: int, user: User) -> dict:
    order = await _get_order(db, order_id, user)
    order.assigned_operator_id = operator_id
    await db.flush()
    await db.refresh(order)
    return _serialize_order(order, order.client.name if order.client else None)


# ──────────────────────────────────────────────
#  PICKING
# ──────────────────────────────────────────────

async def pick_item(
    db: AsyncSession, order_id: int, order_item_id: int, scanned_sku: str, user: User,
) -> dict:
    order = await _get_order(db, order_id, user)
    await _ensure_order_not_in_active_batch_session(db, order.id)
    _ensure_ready_for_picking(order)

    if order.status == OrderStatus.pending:
        _validate_transition(order.status, OrderStatus.in_preparation)
        order.status = OrderStatus.in_preparation
        if order.assigned_operator_id is None:
            order.assigned_operator_id = user.id
        await _log_status_change(db, order, OrderStatus.in_preparation, user.id)

    if order.status != OrderStatus.in_preparation:
        raise BadRequestError(f"Cannot pick items in status '{order.status.value}'")

    # Find the order item
    item = None
    for i in order.items:
        if i.id == order_item_id:
            item = i
            break
    if item is None:
        raise NotFoundError(f"Order item {order_item_id} not found")

    # Validate scanned SKU
    if item.sku != scanned_sku:
        return {
            "valid": False,
            "expected_sku": item.sku,
            "scanned_sku": scanned_sku,
            "message": f"SKU mismatch! Expected {item.sku}, scanned {scanned_sku}",
        }

    # Increment picked
    item.picked_quantity = min(item.picked_quantity + 1, item.quantity)

    # Check if all items fully picked
    all_picked = all(i.picked_quantity >= i.quantity for i in order.items)
    if all_picked:
        _validate_transition(order.status, OrderStatus.prepared)
        order.status = OrderStatus.prepared
        order.picked_at = datetime.now(timezone.utc)
        await record_prepared_order(db, order)
        await _log_status_change(db, order, OrderStatus.prepared, user.id, "All items picked")

    await db.flush()
    await db.refresh(order)

    return {
        "valid": True,
        "expected_sku": item.sku,
        "scanned_sku": scanned_sku,
        "picked_quantity": item.picked_quantity,
        "total_quantity": item.quantity,
        "all_picked": all_picked,
        "order_status": order.status.value,
    }


# ──────────────────────────────────────────────
#  PICK BY SKU (simplified picking for warehouse operators)
# ──────────────────────────────────────────────

async def pick_by_sku(
    db: AsyncSession, order_id: int, sku: str, user: User,
) -> dict:
    order = await _get_order(db, order_id, user)
    await _ensure_order_not_in_active_batch_session(db, order.id)
    _ensure_ready_for_picking(order)

    # Auto-transition from pending → in_preparation on first scan
    if order.status == OrderStatus.pending:
        _validate_transition(order.status, OrderStatus.in_preparation)
        order.status = OrderStatus.in_preparation
        if order.assigned_operator_id is None:
            order.assigned_operator_id = user.id
        await _log_status_change(db, order, OrderStatus.in_preparation, user.id, "Picking started")

    if order.status != OrderStatus.in_preparation:
        raise BadRequestError(f"No se puede escanear en estado '{order.status.value}'")

    # Find item by SKU
    item = next((i for i in order.items if i.sku == sku), None)
    if item is None:
        expected_skus = [i.sku for i in order.items]
        await create_picking_error_alert(
            db, order.client_id, order.id, order.order_number, sku, expected_skus,
        )
        raise BadRequestError(f"SKU '{sku}' no pertenece a este pedido")

    if item.picked_quantity >= item.quantity:
        raise BadRequestError(f"SKU '{sku}' ya fue completamente escaneado ({item.quantity}/{item.quantity})")

    item.picked_quantity += 1

    # Check if all items fully picked
    all_picked = all(i.picked_quantity >= i.quantity for i in order.items)
    if all_picked:
        _validate_transition(order.status, OrderStatus.prepared)
        order.status = OrderStatus.prepared
        order.picked_at = datetime.now(timezone.utc)
        await record_prepared_order(db, order)
        await _log_status_change(db, order, OrderStatus.prepared, user.id, "All items picked")

    await db.flush()

    # Re-fetch with eager loading
    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.client), selectinload(Order.dispatch_batch).selectinload(DispatchBatch.transporter), selectinload(Order.assigned_operator))
        .where(Order.id == order.id)
    )
    order = result.scalar_one()
    return {
        "success": True,
        "scanned_sku": sku,
        "item_picked": item.picked_quantity,
        "item_total": item.quantity,
        "all_picked": all_picked,
        "order": _serialize_order(order, order.client.name if order.client else None),
    }


# ──────────────────────────────────────────────
#  PACKING
# ──────────────────────────────────────────────

async def pack_order(db: AsyncSession, order_id: int, user: User) -> dict:
    order = await _get_order(db, order_id, user)
    if order.status != OrderStatus.prepared:
        raise BadRequestError(f"Order must be 'prepared' to pack, current: '{order.status.value}'")

    order.packed_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(order)
    return _serialize_order(order, order.client.name if order.client else None)


# ──────────────────────────────────────────────
#  DISPATCH
# ──────────────────────────────────────────────

async def dispatch_order(db: AsyncSession, order_id: int, user: User, tracking_number: str | None = None) -> dict:
    order = await _get_order(db, order_id, user)
    if order.operation_type == OrderOperationType.sale:
        _ensure_ready_for_picking(order)
        _validate_transition(order.status, OrderStatus.dispatched)
        for item in order.items:
            await stock_service.dispatch_stock(
                db, order.client_id, item.product_id, item.quantity, order.id, user.id
            )
        order.status = OrderStatus.dispatched
    else:
        _validate_transition(order.status, OrderStatus.awaiting_return)
        order.status = OrderStatus.awaiting_return

    order.dispatched_at = datetime.now(timezone.utc)
    if tracking_number:
        order.tracking_number = tracking_number

    await _log_status_change(db, order, order.status, user.id)
    await db.flush()
    await db.refresh(order)
    return _serialize_order(order, order.client.name if order.client else None)


async def mark_order_awaiting_return(
    db: AsyncSession,
    order_id: int,
    user: User,
    notes: str | None = None,
) -> dict:
    order = await _get_order(db, order_id, user)
    if order.status != OrderStatus.dispatched:
        raise BadRequestError("Solo se pueden marcar para devolución pedidos despachados")

    _validate_transition(order.status, OrderStatus.awaiting_return)
    order.status = OrderStatus.awaiting_return
    await _log_status_change(db, order, OrderStatus.awaiting_return, user.id, notes or "Pedido marcado para devolución")
    await db.flush()
    await db.refresh(order)
    return _serialize_order(order, order.client.name if order.client else None)


async def receive_return(
    db: AsyncSession,
    user: User,
    order_id: int,
    sku: str,
    condition: str,
    notes: str | None = None,
) -> dict:
    order = await _get_order(db, order_id, user)
    if order.status not in {OrderStatus.awaiting_return, OrderStatus.returned_pending_review}:
        raise BadRequestError("El pedido no está pendiente de recepción de devolución")

    parsed_condition = _parse_return_condition(condition)
    normalized_sku = sku.strip()
    if not normalized_sku:
        raise BadRequestError("Debes indicar un SKU válido")

    order_item = next((item for item in order.items if item.sku.casefold() == normalized_sku.casefold()), None)
    if order_item is None:
        raise NotFoundError(f"El SKU {sku} no pertenece al pedido")

    existing_reception = await db.execute(
        select(ReturnReception).where(ReturnReception.order_item_id == order_item.id)
    )
    if existing_reception.scalar_one_or_none() is not None:
        raise BadRequestError("Ese SKU ya fue recibido previamente")

    location = await _resolve_return_location(db, order_item, parsed_condition)
    if parsed_condition != ReturnCondition.damaged:
        if order_item.product_id is None or location is None:
            raise BadRequestError("No se pudo resolver una ubicación válida para la devolución")
        await stock_service.inbound_stock(
            db,
            user,
            order_item.product_id,
            location.id,
            order_item.quantity,
            notes or f"Ingreso por devolución del pedido {order.order_number}",
        )

    reception = ReturnReception(
        order_id=order.id,
        order_item_id=order_item.id,
        client_id=order.client_id,
        product_id=order_item.product_id,
        sku=order_item.sku,
        quantity=order_item.quantity,
        condition=parsed_condition,
        notes=notes,
        stock_location_id=location.id if location else None,
        received_by=user.id,
    )
    db.add(reception)
    await db.flush()
    await db.refresh(reception)

    all_receptions = [*order.return_receptions, reception]
    received_items = {received.order_item_id for received in all_receptions}
    received_items.add(order_item.id)
    all_items_received = all(item.id in received_items for item in order.items)

    next_status = None
    if parsed_condition == ReturnCondition.review and order.status == OrderStatus.awaiting_return:
        next_status = OrderStatus.returned_pending_review
    elif all_items_received:
        has_review_items = any(received.condition == ReturnCondition.review for received in all_receptions)
        next_status = OrderStatus.returned_pending_review if has_review_items else OrderStatus.returned_completed

    if next_status is not None and next_status != order.status:
        _validate_transition(order.status, next_status)
        order.status = next_status
        await _log_status_change(db, order, next_status, user.id, notes or f"Recepción de devolución: {parsed_condition.value}")

    await db.flush()

    refreshed_order = await _get_order(db, order.id, user)
    return {
        "order": _serialize_order(refreshed_order, refreshed_order.client.name if refreshed_order.client else None),
        "reception": {
            "id": reception.id,
            "order_item_id": reception.order_item_id,
            "sku": reception.sku,
            "quantity": reception.quantity,
            "condition": reception.condition.value,
            "notes": reception.notes,
            "stock_location_code": location.code if location else None,
            "received_by": user.id,
            "received_by_name": user.full_name,
            "received_at": reception.received_at.isoformat() if reception.received_at else None,
        },
    }


async def print_pending_labels(db: AsyncSession, user: User) -> tuple[bytes, dict[str, str]]:
    orders = await _collect_printable_label_orders(db, user)
    if not orders:
        raise BadRequestError("No hay etiquetas pendientes para imprimir")

    combined_pdf, printed_orders, failed_messages = await _generate_order_labels_pdf(db, orders)
    file_name = _build_label_file_name("etiquetas-pendientes")
    headers = {
        "Content-Disposition": f'attachment; filename="{file_name}"',
        "X-Labels-Generated-Count": str(len(printed_orders)),
        "X-Labels-Failed-Count": str(len(failed_messages)),
        "X-Labels-File-Name": file_name,
        "X-Labels-Mode": "pending",
        "Access-Control-Expose-Headers": "Content-Disposition, X-Labels-Generated-Count, X-Labels-Failed-Count, X-Labels-File-Name, X-Labels-Mode",
    }
    return combined_pdf, headers


async def print_order_label(db: AsyncSession, order_id: int, user: User) -> tuple[bytes, dict[str, str]]:
    order = await _get_order(db, order_id, user)
    if user.role == UserRole.client:
        raise ForbiddenError("No tenes permisos para imprimir etiquetas")
    if order.status == OrderStatus.cancelled:
        raise BadRequestError("No se puede imprimir la etiqueta de un pedido cancelado")
    if not order.shipping_id or not str(order.shipping_id).strip():
        raise BadRequestError("El pedido no tiene shipping_id válido")

    combined_pdf, printed_orders, failed_messages = await _generate_order_labels_pdf(db, [order])
    file_name = _build_label_file_name(f"etiqueta-{order.order_number.lower()}")
    headers = {
        "Content-Disposition": f'attachment; filename="{file_name}"',
        "X-Labels-Generated-Count": str(len(printed_orders)),
        "X-Labels-Failed-Count": str(len(failed_messages)),
        "X-Labels-File-Name": file_name,
        "X-Labels-Mode": "single",
        "Access-Control-Expose-Headers": "Content-Disposition, X-Labels-Generated-Count, X-Labels-Failed-Count, X-Labels-File-Name, X-Labels-Mode",
    }
    return combined_pdf, headers


async def generate_manual_label(db: AsyncSession, order_id: int, user: User) -> tuple[bytes, dict[str, str]]:
    order = await _get_order(db, order_id, user)
    if user.role == UserRole.client:
        raise ForbiddenError("No tenes permisos para imprimir etiquetas")

    _ensure_manual_label_eligible(order)
    pdf_content = _generate_manual_label_pdf(order, order.client.name if order.client else None)
    printed_at = datetime.now(timezone.utc)
    _mark_orders_as_label_printed([order], printed_at, OrderLabelType.manual)
    await db.flush()

    file_name = _build_label_file_name(f"etiqueta-manual-{order.order_number.lower()}")
    headers = {
        "Content-Disposition": f'attachment; filename="{file_name}"',
        "X-Labels-Generated-Count": "1",
        "X-Labels-Failed-Count": "0",
        "X-Labels-File-Name": file_name,
        "X-Labels-Mode": "manual-single",
        "Access-Control-Expose-Headers": "Content-Disposition, X-Labels-Generated-Count, X-Labels-Failed-Count, X-Labels-File-Name, X-Labels-Mode",
    }
    return pdf_content, headers


# ──────────────────────────────────────────────
#  CANCEL
# ──────────────────────────────────────────────

async def cancel_order(db: AsyncSession, order_id: int, user: User, reason: str | None = None) -> dict:
    order = await _get_order(db, order_id, user)
    await _ensure_order_not_in_active_batch_session(db, order.id)
    _validate_transition(order.status, OrderStatus.cancelled)

    if order.operation_type == OrderOperationType.sale:
        for item in order.items:
            await stock_service.release_stock(
                db, order.client_id, item.product_id, item.quantity, order.id, user.id
            )

    order.status = OrderStatus.cancelled
    order.cancelled_at = datetime.now(timezone.utc)

    await _log_status_change(db, order, OrderStatus.cancelled, user.id, reason)
    await db.flush()
    await db.refresh(order)
    return _serialize_order(order, order.client.name if order.client else None)


# ──────────────────────────────────────────────
#  QUERIES
# ──────────────────────────────────────────────

async def _get_order(db: AsyncSession, order_id: int, user: User) -> Order:
    result = await db.execute(
        select(Order)
        .options(*_order_load_options())
        .where(Order.id == order_id)
    )
    order = result.scalar_one_or_none()
    if order is None:
        raise NotFoundError(f"Order {order_id} not found")
    check_tenant_access(user, order.client_id)
    return order


async def get_order(db: AsyncSession, order_id: int, user: User) -> dict:
    order = await _get_order(db, order_id, user)
    return _serialize_order(order, order.client.name if order.client else None)


async def get_active_batch_picking_session(db: AsyncSession, user: User) -> dict:
    session = await _get_active_batch_picking_session_for_user(db, user)
    if session is None:
        raise NotFoundError("No hay una sesión activa de batch picking")
    return _serialize_batch_picking_session(session)


async def start_batch_picking_session(db: AsyncSession, user: User) -> dict:
    existing_session = await _get_active_batch_picking_session_for_user(db, user)
    if existing_session is not None:
        return _serialize_batch_picking_session(existing_session)

    query = (
        select(OrderItem, Order, Product)
        .join(Order, OrderItem.order_id == Order.id)
        .join(Product, OrderItem.product_id == Product.id)
        .where(
            Order.status == OrderStatus.pending,
            OrderItem.quantity > OrderItem.picked_quantity,
            or_(
                Order.mapping_status.is_(None),
                Order.mapping_status == MAPPING_STATUS_RESOLVED,
            ),
        )
        .order_by(Order.created_at.asc(), Order.id.asc(), OrderItem.id.asc())
    )
    query = tenant_filter(query, Order, user)
    query = _apply_zone_visibility(query, user)

    rows = (await db.execute(query)).all()
    if not rows:
        raise BadRequestError(
            "No hay pedidos pendientes con SKU interno resuelto para iniciar picking masivo"
        )

    session = BatchPickingSession(
        status=BATCH_PICKING_STATUS_ACTIVE,
        user_id=user.id,
    )
    db.add(session)
    await db.flush()

    grouped_rows: dict[str, list[tuple[OrderItem, Order, Product]]] = {}
    for order_item, order, product in rows:
        grouped_rows.setdefault(order_item.sku, []).append((order_item, order, product))

    for item_sort_order, sku in enumerate(sorted(grouped_rows.keys()), start=1):
        grouped = grouped_rows[sku]
        first_order_item, _, first_product = grouped[0]
        session_item = BatchPickingSessionItem(
            session_id=session.id,
            product_id=first_product.id if first_product else first_order_item.product_id,
            product_name=first_product.name if first_product else sku,
            sku=sku,
            quantity_total=sum(order_item.quantity - order_item.picked_quantity for order_item, _, _ in grouped),
            quantity_picked=0,
            sort_order=item_sort_order,
        )
        db.add(session_item)
        await db.flush()

        for assignment_sort_order, (order_item, order, _) in enumerate(grouped, start=1):
            remaining_quantity = order_item.quantity - order_item.picked_quantity
            if remaining_quantity <= 0:
                continue
            db.add(
                BatchPickingSessionAssignment(
                    session_item_id=session_item.id,
                    order_id=order.id,
                    order_item_id=order_item.id,
                    order_number=order.order_number,
                    location_code=order_item.location_code,
                    quantity_total=remaining_quantity,
                    quantity_picked=0,
                    sort_order=assignment_sort_order,
                )
            )

    await db.flush()
    session = await _get_batch_picking_session(db, session.id, user)
    return _serialize_batch_picking_session(session)


async def get_batch_picking_session(db: AsyncSession, session_id: int, user: User) -> dict:
    session = await _get_batch_picking_session(db, session_id, user)
    return _serialize_batch_picking_session(session)


async def scan_batch_picking_session(
    db: AsyncSession,
    session_id: int,
    sku: str,
    user: User,
) -> dict:
    session = await _get_batch_picking_session(db, session_id, user, require_active=True)
    scanned_sku = sku.strip()
    if not scanned_sku:
        raise BadRequestError("Debes escanear un SKU válido")

    session_item = next(
        (item for item in session.items if item.sku.casefold() == scanned_sku.casefold()),
        None,
    )
    if session_item is None:
        raise BadRequestError(f"SKU '{scanned_sku}' no pertenece a la sesión activa")

    if session_item.quantity_picked >= session_item.quantity_total:
        raise BadRequestError(
            f"SKU '{session_item.sku}' ya fue completado ({session_item.quantity_total}/{session_item.quantity_total})"
        )

    assignment = next(
        (item for item in session_item.assignments if item.quantity_picked < item.quantity_total),
        None,
    )
    if assignment is None:
        raise BadRequestError(f"SKU '{session_item.sku}' no tiene pedidos pendientes para asignar")

    order_result = await db.execute(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.client))
        .where(Order.id == assignment.order_id)
    )
    order = order_result.scalar_one_or_none()
    if order is None:
        raise NotFoundError(f"Order {assignment.order_id} not found")

    if order.status == OrderStatus.pending:
        _validate_transition(order.status, OrderStatus.in_preparation)
        order.status = OrderStatus.in_preparation
        if order.assigned_operator_id is None:
            order.assigned_operator_id = user.id
        await _log_status_change(db, order, OrderStatus.in_preparation, user.id, "Batch picking started")

    if order.status != OrderStatus.in_preparation:
        raise BadRequestError(
            f"El pedido {order.order_number} ya no está disponible para batch picking"
        )

    order_item = next((item for item in order.items if item.id == assignment.order_item_id), None)
    if order_item is None:
        raise NotFoundError(f"Order item {assignment.order_item_id} not found")

    if order_item.picked_quantity >= order_item.quantity:
        raise BadRequestError(
            f"El item del pedido {order.order_number} ya no tiene unidades pendientes"
        )

    order_item.picked_quantity += 1
    assignment.quantity_picked += 1
    session_item.quantity_picked += 1

    db.add(
        BatchPickingScanLog(
            session_id=session.id,
            session_item_id=session_item.id,
            order_id=order.id,
            order_item_id=order_item.id,
            user_id=user.id,
            scanned_sku=session_item.sku,
        )
    )

    order_completed = all(item.picked_quantity >= item.quantity for item in order.items)
    if order_completed:
        _validate_transition(order.status, OrderStatus.prepared)
        order.status = OrderStatus.prepared
        order.picked_at = datetime.now(timezone.utc)
        await record_prepared_order(db, order)
        await _log_status_change(db, order, OrderStatus.prepared, user.id, "Completed by batch picking")

    sku_completed = session_item.quantity_picked >= session_item.quantity_total
    session_completed = all(item.quantity_picked >= item.quantity_total for item in session.items)
    if session_completed:
        session.status = BATCH_PICKING_STATUS_COMPLETED
        session.completed_at = datetime.now(timezone.utc)

    await db.flush()

    refreshed_session = await _get_batch_picking_session(db, session.id, user)
    return {
        "success": True,
        "scanned_sku": session_item.sku,
        "assigned_order_id": order.id,
        "assigned_order_number": order.order_number,
        "item_picked": session_item.quantity_picked,
        "item_total": session_item.quantity_total,
        "sku_completed": sku_completed,
        "session_completed": session_completed,
        "session": _serialize_batch_picking_session(refreshed_session),
    }


async def list_orders(
    db: AsyncSession,
    user: User,
    status: str | None = None,
    dominant_zone: str | None = None,
    mapping_status: str | None = None,
    source: str | None = None,
    skip: int = 0,
    limit: int = 50,
) -> list[dict]:
    base = select(Order).options(*_order_load_options())
    base = tenant_filter(base, Order, user)
    if status:
        base = base.where(Order.status == OrderStatus(status))
    if source:
        base = base.where(Order.source == OrderSource(source))
    if dominant_zone:
        base = base.where(Order.dominant_zone == dominant_zone)
    if mapping_status:
        base = base.where(Order.mapping_status == mapping_status)
    # Auto-filter by user zones (operators only, admins see all)
    elif user.role != UserRole.admin and user.zones:
        base = base.where(
            or_(
                Order.dominant_zone.in_(user.zones),
                Order.assigned_operator_id == user.id,
            )
        )

    result = await db.execute(base.order_by(Order.created_at.desc()).offset(skip).limit(limit))
    orders = result.scalars().all()

    # Fetch client names
    client_ids = {o.client_id for o in orders}
    client_map: dict[int, str] = {}
    if client_ids:
        clients_result = await db.execute(
            select(Client.id, Client.name).where(Client.id.in_(client_ids))
        )
        client_map = {row.id: row.name for row in clients_result.all()}

    return [_serialize_order(o, client_map.get(o.client_id)) for o in orders]


# ──────────────────────────────────────────────
#  HELP OTHER ZONE
# ──────────────────────────────────────────────

async def help_other_zone(db: AsyncSession, user: User) -> dict:
    """Redistribute pending orders from the busiest zone to the requesting operator."""
    user_zones = user.zones or []

    # Count pending orders per zone (excluding user's own zones)
    zone_counts_q = (
        select(Order.dominant_zone, func.count(Order.id))
        .where(
            Order.status == OrderStatus.pending,
            Order.dominant_zone.isnot(None),
        )
        .group_by(Order.dominant_zone)
    )
    if user_zones:
        zone_counts_q = zone_counts_q.where(Order.dominant_zone.notin_(user_zones))

    zone_rows = (await db.execute(zone_counts_q)).all()
    if not zone_rows:
        return {"assigned": 0, "zone": None, "message": "No hay pedidos disponibles para ayudar"}

    # Pick zone with most pending orders
    busiest_zone, busiest_count = max(zone_rows, key=lambda r: r[1])
    take_count = busiest_count // 2
    if take_count < 1:
        take_count = 1

    # Fetch the actual orders to reassign (oldest first)
    orders_q = (
        select(Order)
        .where(
            Order.status == OrderStatus.pending,
            Order.dominant_zone == busiest_zone,
        )
        .order_by(Order.created_at.asc())
        .limit(take_count)
    )
    result = await db.execute(orders_q)
    orders_to_reassign = list(result.scalars().all())

    for order in orders_to_reassign:
        order.assigned_operator_id = user.id

    await db.flush()

    count = len(orders_to_reassign)
    return {
        "assigned": count,
        "zone": busiest_zone,
        "message": f"Se te asignaron {count} pedido{'s' if count != 1 else ''} de la zona {busiest_zone}",
    }


async def workload_hint(db: AsyncSession, user: User) -> dict:
    """Light check: does this operator have availability to help another zone?"""
    # Count orders currently assigned to this operator (pending + in_preparation)
    my_load = (await db.execute(
        select(func.count(Order.id)).where(
            Order.assigned_operator_id == user.id,
            Order.status.in_([OrderStatus.pending, OrderStatus.in_preparation]),
        )
    )).scalar_one()

    if my_load > 0:
        return {"available": False, "pending_other_zones": 0, "message": None}

    user_zones = user.zones or []
    zone_counts_q = (
        select(func.count(Order.id))
        .where(
            Order.status == OrderStatus.pending,
            Order.dominant_zone.isnot(None),
        )
    )
    if user_zones:
        zone_counts_q = zone_counts_q.where(Order.dominant_zone.notin_(user_zones))

    total_other = (await db.execute(zone_counts_q)).scalar_one()

    if total_other == 0:
        return {"available": True, "pending_other_zones": 0, "message": None}

    return {
        "available": True,
        "pending_other_zones": total_other,
        "message": f"Tenés disponibilidad. Hay {total_other} pedido{'s' if total_other != 1 else ''} pendiente{'s' if total_other != 1 else ''} en otra zona.",
    }


async def workload_status(db: AsyncSession) -> dict:
    """Return real-time zone workload snapshot for admin dashboard."""
    # 1. Pending orders per zone
    zone_q = (
        select(Order.dominant_zone, func.count(Order.id))
        .where(
            Order.status == OrderStatus.pending,
            Order.dominant_zone.isnot(None),
        )
        .group_by(Order.dominant_zone)
    )
    zone_rows = (await db.execute(zone_q)).all()
    zones = [
        {"zone": zone, "pending": count}
        for zone, count in sorted(zone_rows, key=lambda r: r[1], reverse=True)
    ]
    zone_pending_map = {zone: count for zone, count in zone_rows}
    saturated = [z for z in zones if z["pending"] > 5]

    # 2. Active operators and their picking status
    ops_q = select(User).where(User.role == UserRole.operator, User.is_active.is_(True))
    operators = list((await db.execute(ops_q)).scalars().all())

    active_picking_q = (
        select(Order.assigned_operator_id, func.count(Order.id))
        .where(
            Order.status == OrderStatus.in_preparation,
            Order.assigned_operator_id.isnot(None),
        )
        .group_by(Order.assigned_operator_id)
    )
    active_picking_rows = {row[0]: row[1] for row in (await db.execute(active_picking_q)).all()}

    batch_q = (
        select(BatchPickingSession.user_id, func.count(BatchPickingSession.id))
        .where(
            BatchPickingSession.status == BATCH_PICKING_STATUS_ACTIVE,
            BatchPickingSession.user_id.isnot(None),
        )
        .group_by(BatchPickingSession.user_id)
    )
    active_batch_rows = {row[0]: row[1] for row in (await db.execute(batch_q)).all()}

    idle_operators = []
    busy_operators = []
    for op in operators:
        op_zones = op.zones or []
        pending_zone_orders = sum(zone_pending_map.get(zone, 0) for zone in op_zones)
        active_picking_orders = active_picking_rows.get(op.id, 0)
        has_active_batch = active_batch_rows.get(op.id, 0) > 0
        is_busy = has_active_batch or active_picking_orders > 0
        info = {
            "id": op.id,
            "name": op.full_name,
            "zones": op_zones,
            "orders": active_picking_orders,
            "pending_zone_orders": pending_zone_orders,
            "has_active_batch": has_active_batch,
        }
        if is_busy:
            busy_operators.append(info)
        else:
            idle_operators.append(info)

    # 3. Build admin message for the worst zone
    message = None
    if saturated:
        worst = saturated[0]
        idle_count = len(idle_operators)
        message = (
            f"Zona {worst['zone']} tiene {worst['pending']} pedidos pendientes. "
            f"{idle_count} operario{'s' if idle_count != 1 else ''} disponible{'s' if idle_count != 1 else ''} para ayudar."
        )

    return {
        "zones": zones,
        "saturated_zones": saturated,
        "idle_operators": idle_operators,
        "busy_operators": busy_operators,
        "message": message,
    }


async def find_prepared_by_sku(
    db: AsyncSession, user: User, sku: str,
) -> list[dict]:
    """Find prepared orders that contain a given SKU."""
    result = await db.execute(
        select(Order)
        .join(OrderItem, Order.id == OrderItem.order_id)
        .options(*_order_load_options())
        .where(
            OrderItem.sku == sku,
            Order.status == OrderStatus.prepared,
            Order.operation_type == OrderOperationType.sale,
        )
    )
    orders = result.unique().scalars().all()

    # Tenant filter
    filtered = [o for o in orders if _has_tenant_access(user, o.client_id)]

    client_ids = {o.client_id for o in filtered}
    client_map: dict[int, str] = {}
    if client_ids:
        clients_result = await db.execute(
            select(Client.id, Client.name).where(Client.id.in_(client_ids))
        )
        client_map = {row.id: row.name for row in clients_result.all()}

    return [_serialize_order(o, client_map.get(o.client_id)) for o in filtered]


async def get_order_by_shipping_id(db: AsyncSession, user: User, shipping_id: str) -> dict:
    normalized_shipping_id = shipping_id.strip()
    if not normalized_shipping_id:
        raise BadRequestError("Debes indicar un shipping_id válido")

    result = await db.execute(
        select(Order)
        .options(*_order_load_options())
        .where(
            Order.shipping_id == normalized_shipping_id,
            Order.operation_type == OrderOperationType.sale,
        )
        .order_by(Order.updated_at.desc(), Order.id.desc())
    )
    orders = result.unique().scalars().all()

    filtered = [order for order in orders if _has_tenant_access(user, order.client_id)]
    if not filtered:
        raise NotFoundError(f"No se encontró ningún pedido para el shipping_id {normalized_shipping_id}")
    if len(filtered) > 1:
        raise BadRequestError(
            f"Hay múltiples pedidos asociados al shipping_id {normalized_shipping_id}. Revisá la sincronización antes de despachar"
        )

    order = filtered[0]
    client_name = None
    if order.client_id:
        client_result = await db.execute(
            select(Client.name).where(Client.id == order.client_id)
        )
        client_name = client_result.scalar_one_or_none()

    return _serialize_order(order, client_name)


def _has_tenant_access(user: User, client_id: int) -> bool:
    """Check tenant access without raising."""
    try:
        check_tenant_access(user, client_id)
        return True
    except Exception:
        return False


async def get_order_history(db: AsyncSession, order_id: int, user: User) -> list[OrderStatusLog]:
    order = await _get_order(db, order_id, user)
    result = await db.execute(
        select(OrderStatusLog)
        .where(OrderStatusLog.order_id == order_id)
        .order_by(OrderStatusLog.created_at)
    )
    return result.scalars().all()


# ──────────────────────────────────────────────
#  ADVANCE ORDER (simple state progression)
# ──────────────────────────────────────────────

_ADVANCE_MAP: dict[OrderStatus, OrderStatus] = {
    OrderStatus.pending: OrderStatus.in_preparation,
    OrderStatus.prepared: OrderStatus.dispatched,
    OrderStatus.returned_pending_review: OrderStatus.returned_completed,
}


async def advance_order(db: AsyncSession, order_id: int, user: User) -> Order:
    """Advance an order to the next logical state."""
    order = await _get_order(db, order_id, user)
    if order.operation_type == OrderOperationType.sale:
        _ensure_ready_for_picking(order)
    next_status = _ADVANCE_MAP.get(order.status)
    if next_status is None:
        raise BadRequestError(
            f"El pedido en estado '{order.status.value}' no puede avanzar"
        )

    if order.operation_type == OrderOperationType.return_ and next_status == OrderStatus.dispatched:
        next_status = OrderStatus.awaiting_return

    _validate_transition(order.status, next_status)

    # On dispatch, deduct stock
    if next_status == OrderStatus.dispatched:
        for item in order.items:
            await stock_service.dispatch_stock(
                db, order.client_id, item.product_id, item.quantity, order.id, user.id
            )
        order.dispatched_at = datetime.now(timezone.utc)
    elif next_status == OrderStatus.awaiting_return:
        order.dispatched_at = datetime.now(timezone.utc)
    elif next_status == OrderStatus.in_preparation:
        # Validate reserved stock before starting picking
        for item in order.items:
            stock_row = await db.execute(
                select(func.coalesce(func.sum(Stock.quantity_reserved), 0))
                .where(Stock.client_id == order.client_id, Stock.product_id == item.product_id)
            )
            reserved = stock_row.scalar() or 0
            if reserved < item.quantity:
                product = await db.get(Product, item.product_id)
                pname = product.name if product else f"#{item.product_id}"
                raise BadRequestError(
                    f"Stock reservado insuficiente para \"{pname}\": "
                    f"reservado {reserved}, necesario {item.quantity}"
                )
    elif next_status == OrderStatus.prepared:
        order.packed_at = datetime.now(timezone.utc)
        await record_prepared_order(db, order)

    order.status = next_status
    await _log_status_change(db, order, next_status, user.id)
    await db.flush()
    # Re-fetch with eager loading
    result = await db.execute(
        select(Order)
        .options(*_order_load_options())
        .where(Order.id == order.id)
    )
    order = result.scalar_one()
    return _serialize_order(order, order.client.name if order.client else None)


# ──────────────────────────────────────────────
#  BATCH DISPATCH
# ──────────────────────────────────────────────

async def _next_batch_number(db: AsyncSession) -> str:
    result = await db.execute(
        select(func.count(DispatchBatch.id))
    )
    count = result.scalar() or 0
    return f"DESP-{count + 1:05d}"


async def _expand_exchange_order_ids(db: AsyncSession, order_ids: list[int]) -> list[int]:
    if not order_ids:
        return []

    result = await db.execute(
        select(Order.id, Order.exchange_id)
        .where(Order.id.in_(order_ids))
    )
    exchange_ids = {row.exchange_id for row in result.all() if row.exchange_id}
    if not exchange_ids:
        return order_ids

    related_result = await db.execute(
        select(Order.id)
        .where(
            Order.exchange_id.in_(exchange_ids),
            Order.status == OrderStatus.prepared,
        )
    )
    related_ids = {row.id for row in related_result.all()}
    return list({*order_ids, *related_ids})


async def _dispatch_order_in_batch(db: AsyncSession, order: Order, user: User, batch_number: str, batch_id: int, now: datetime) -> None:
    if order.operation_type == OrderOperationType.sale:
        _validate_transition(order.status, OrderStatus.dispatched)
        for item in order.items:
            await stock_service.dispatch_stock(
                db, order.client_id, item.product_id, item.quantity, order.id, user.id
            )
        order.status = OrderStatus.dispatched
    else:
        _validate_transition(order.status, OrderStatus.awaiting_return)
        order.status = OrderStatus.awaiting_return

    order.dispatched_at = now
    order.dispatch_batch_id = batch_id
    await _log_status_change(
        db,
        order,
        order.status,
        user.id,
        f"Despachado en lote {batch_number}",
    )


async def batch_dispatch(
    db: AsyncSession,
    user: User,
    order_ids: list[int],
    carrier: str | None = None,
    notes: str | None = None,
    transporter_id: int | None = None,
    register_transport_transfer: bool = False,
) -> dict:
    """Dispatch multiple prepared orders in a single batch."""
    if not order_ids:
        raise BadRequestError("Debe seleccionar al menos un pedido")

    # De-duplicate
    order_ids = list(set(order_ids))
    order_ids = await _expand_exchange_order_ids(db, order_ids)

    # Fetch all orders
    result = await db.execute(
        select(Order)
        .options(*_order_load_options())
        .where(Order.id.in_(order_ids))
    )
    orders = result.scalars().all()

    if len(orders) != len(order_ids):
        raise NotFoundError("Uno o más pedidos no fueron encontrados")

    # Validate all are prepared
    for order in orders:
        check_tenant_access(user, order.client_id)
        if order.status != OrderStatus.prepared:
            raise BadRequestError(
                f"El pedido {order.order_number} no está en estado 'Listo para despacho' "
                f"(estado actual: {order.status.value})"
            )

    # Create batch
    batch_number = await _next_batch_number(db)

    # Resolve transporter name as carrier fallback
    resolved_carrier = "Depósito" if register_transport_transfer else carrier
    if transporter_id and not resolved_carrier:
        transporter = await db.get(Transporter, transporter_id)
        if transporter:
            resolved_carrier = transporter.name

    if register_transport_transfer:
        transporter_id = None

    batch = DispatchBatch(
        batch_number=batch_number,
        carrier=resolved_carrier,
        transporter_id=transporter_id,
        notes=notes,
        dispatched_by=user.id,
        order_count=len(orders),
    )
    db.add(batch)
    await db.flush()

    now = datetime.now(timezone.utc)

    # Dispatch each order
    for order in orders:
        await _dispatch_order_in_batch(db, order, user, batch_number, batch.id, now)

    if register_transport_transfer:
        for current_client_id in {order.client_id for order in orders}:
            await record_transport_dispatch(
                db,
                client_id=current_client_id,
                transportista=resolved_carrier,
                cantidad_pedidos=1,
                fecha=now,
                origen="sesion_despacho",
            )

    await db.flush()

    # Re-fetch orders with eager loading to avoid lazy-load in async context
    result = await db.execute(
        select(Order)
        .options(
            selectinload(Order.items),
            selectinload(Order.client),
            selectinload(Order.dispatch_batch).selectinload(DispatchBatch.transporter),
            selectinload(Order.assigned_operator),
        )
        .where(Order.id.in_(order_ids))
    )
    orders = result.scalars().all()

    return {
        "batch_id": batch.id,
        "batch_number": batch_number,
        "order_count": len(orders),
        "carrier": resolved_carrier,
        "transporter_id": transporter_id,
        "dispatched_at": now.isoformat(),
        "orders": [_serialize_order(o, o.client.name if o.client else None) for o in orders],
    }


# ──────────────────────────────────────────────
#  BATCH QUERIES
# ──────────────────────────────────────────────

def _serialize_batch(batch: DispatchBatch, orders: list[Order] | None = None, client_map: dict[int, str] | None = None) -> dict:
    data = {
        "id": batch.id,
        "batch_number": batch.batch_number,
        "carrier": batch.carrier,
        "transporter_id": batch.transporter_id,
        "transporter_name": batch.transporter.name if batch.transporter else None,
        "notes": batch.notes,
        "dispatched_by": batch.dispatched_by,
        "order_count": batch.order_count,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
    }
    if orders is not None:
        cmap = client_map or {}
        data["orders"] = [_serialize_order(o, cmap.get(o.client_id)) for o in orders]
    return data


async def list_batches(
    db: AsyncSession, user: User, skip: int = 0, limit: int = 50,
) -> list[dict]:
    result = await db.execute(
        select(DispatchBatch)
        .options(selectinload(DispatchBatch.transporter))
        .order_by(DispatchBatch.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    batches = result.scalars().all()
    return [_serialize_batch(b) for b in batches]


async def get_batch(db: AsyncSession, batch_id: int, user: User) -> dict:
    result = await db.execute(
        select(DispatchBatch)
        .options(selectinload(DispatchBatch.transporter))
        .where(DispatchBatch.id == batch_id)
    )
    batch = result.scalar_one_or_none()
    if batch is None:
        raise NotFoundError(f"Lote {batch_id} no encontrado")

    # Fetch orders belonging to this batch
    orders_result = await db.execute(
        select(Order)
        .options(*_order_load_options())
        .where(Order.dispatch_batch_id == batch_id)
    )
    orders = orders_result.scalars().all()

    # Client names
    client_ids = {o.client_id for o in orders}
    client_map: dict[int, str] = {}
    if client_ids:
        clients_result = await db.execute(
            select(Client.id, Client.name).where(Client.id.in_(client_ids))
        )
        client_map = {row.id: row.name for row in clients_result.all()}

    return _serialize_batch(batch, orders, client_map)
