from __future__ import annotations

import csv
import re
from datetime import datetime
from io import StringIO

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.orders.models import Order, OrderItem, OrderStatus, DispatchBatch
from app.reports.schemas import OrderReportRow


def _normalize_report_dates(from_date: datetime, to_date: datetime) -> None:
    if from_date > to_date:
        raise BadRequestError("from_date no puede ser mayor que to_date")


def _resolve_cordon(zip_code: str | None) -> str:
    if not zip_code:
        return "Interior"

    digits = "".join(re.findall(r"\d+", zip_code))
    if not digits:
        return "Interior"

    cp = int(digits)
    if 1000 <= cp <= 1499:
        return "CABA"
    if 1600 <= cp <= 1699:
        return "GBA Norte"
    if 1700 <= cp <= 1799:
        return "GBA Oeste"
    if 1800 <= cp <= 1925:
        return "GBA Sur"
    return "Interior"


def _build_shipping_address(order: Order) -> str | None:
    parts = [
        order.address_line or order.buyer_address,
        order.address_reference,
    ]
    normalized = [str(part).strip() for part in parts if part and str(part).strip()]
    return ", ".join(normalized) if normalized else None


def _build_product_name(order: Order) -> str:
    if not order.items:
        return "Sin productos"

    names: list[str] = []
    for item in order.items:
        base_name = item.product.name if item.product and item.product.name else item.sku
        names.append(f"{base_name} x{item.quantity}")
    return " | ".join(names)


def _serialize_report_row(order: Order) -> OrderReportRow:
    carrier = None
    if order.dispatch_batch is not None:
        carrier = (
            order.dispatch_batch.transporter.name
            if order.dispatch_batch.transporter is not None
            else order.dispatch_batch.carrier
        )

    status = order.status.value if isinstance(order.status, OrderStatus) else str(order.status)
    return OrderReportRow(
        order_id=order.id,
        created_at=order.created_at,
        product_name=_build_product_name(order),
        customer_name=order.buyer_name,
        shipping_address=_build_shipping_address(order),
        zip_code=order.postal_code,
        city=order.city,
        province=order.state,
        status=status,
        carrier=carrier,
        cordon=_resolve_cordon(order.postal_code),
    )


async def list_order_report_rows(
    db: AsyncSession,
    *,
    user_client_id: int | None,
    from_date: datetime,
    to_date: datetime,
) -> list[OrderReportRow]:
    if user_client_id is None:
        raise ForbiddenError("No tenes permisos para generar reportes")

    _normalize_report_dates(from_date, to_date)

    result = await db.execute(
        select(Order)
        .options(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.dispatch_batch).selectinload(DispatchBatch.transporter),
        )
        .where(
            Order.client_id == user_client_id,
            Order.created_at >= from_date,
            Order.created_at <= to_date,
        )
        .order_by(Order.created_at.desc(), Order.id.desc())
    )
    orders = list(result.scalars().all())
    if not orders:
        raise NotFoundError("No se encontraron pedidos para el rango seleccionado")

    return [_serialize_report_row(order) for order in orders]


def render_order_report_csv(rows: list[OrderReportRow]) -> str:
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "order_id",
        "created_at",
        "product_name",
        "customer_name",
        "shipping_address",
        "zip_code",
        "city",
        "province",
        "cordon",
        "status",
        "carrier",
    ])
    for row in rows:
        writer.writerow([
            row.order_id,
            row.created_at.isoformat(),
            row.product_name,
            row.customer_name or "",
            row.shipping_address or "",
            row.zip_code or "",
            row.city or "",
            row.province or "",
            row.cordon,
            row.status,
            row.carrier or "",
        ])
    return output.getvalue()