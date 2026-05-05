from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import Numeric, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User, UserRole
from app.billing.models import (
    BillingDocument,
    BillingDocumentStatus,
    BillingRates,
    BillingSchedule,
    Charge,
    ChargeStatus,
    ClientRates,
    ClientStorageRecord,
    ManualCharge,
    MerchandiseReceptionRecord,
    ProductCreationRecord,
    LabelPrintRecord,
    PreparationRecord,
    TransportDispatchRecord,
)
from app.clients.models import Client
from app.common.exceptions import BadRequestError, NotFoundError
from app.common.permissions import check_tenant_access
from app.orders.models import Order, OrderItem, OrderStatus
from app.products.models import Product
from app.stock.models import Stock
from app.stock.movement_models import MovementType, StockMovement

TWOPLACES = Decimal("0.01")
THREEPLACES = Decimal("0.001")
FOURPLACES = Decimal("0.0001")
DEFAULT_BILLING_DAY = 5
ALERT_DUE_SOON_DAYS = 2
VARIABLE_STORAGE_MOVEMENT_TYPES = (
    MovementType.inbound,
    MovementType.outbound,
    MovementType.adjustment,
)


@dataclass
class _ComputedCharge:
    client: Client
    period: str
    total_m3: Decimal
    total_orders: int
    storage_base_rate: Decimal
    storage_discount_pct: Decimal
    storage_rate: Decimal
    preparation_base_rate: Decimal
    preparation_discount_pct: Decimal
    preparation_rate: Decimal
    shipping_base: Decimal
    shipping_multiplier: Decimal
    shipping_base_amount: Decimal
    shipping_discount_pct: Decimal
    storage_amount: Decimal
    preparation_amount: Decimal
    product_creation_amount: Decimal
    product_creation_products: list[str]
    label_print_amount: Decimal
    label_print_count: int
    transport_dispatch_amount: Decimal
    transport_dispatch_count: int
    transport_dispatch_transporters: list[str]
    truck_unloading_amount: Decimal
    truck_unloading_count: int
    manual_charge_amount: Decimal
    manual_charge_items: list[dict]
    shipping_amount: Decimal
    total: Decimal
    missing_storage: bool


def _to_decimal(value: Decimal | float | int | None, places: Decimal = TWOPLACES) -> Decimal:
    try:
        decimal_value = Decimal(str(value or 0))
    except Exception:
        decimal_value = Decimal("0")

    if decimal_value.is_nan() or decimal_value.is_infinite():
        decimal_value = Decimal("0")

    return decimal_value.quantize(places, rounding=ROUND_HALF_UP)


def _serialize_charge(charge: Charge, client_name: str | None = None) -> dict:
    return {
        "id": charge.id,
        "client_id": charge.client_id,
        "client_name": client_name,
        "period": charge.period,
        "total_m3": float(charge.total_m3),
        "total_orders": charge.total_orders,
        "base_storage_rate": float(charge.base_storage_rate),
        "storage_discount_pct": float(charge.storage_discount_pct),
        "applied_storage_rate": float(charge.applied_storage_rate),
        "base_preparation_rate": float(charge.base_preparation_rate),
        "preparation_discount_pct": float(charge.preparation_discount_pct),
        "applied_preparation_rate": float(charge.applied_preparation_rate),
        "applied_shipping_base": float(charge.applied_shipping_base),
        "applied_shipping_multiplier": float(charge.applied_shipping_multiplier),
        "shipping_base_amount": float(charge.shipping_base_amount),
        "shipping_discount_pct": float(charge.shipping_discount_pct),
        "storage_amount": float(charge.storage_amount),
        "preparation_amount": float(charge.preparation_amount),
        "product_creation_amount": float(charge.product_creation_amount),
        "label_print_amount": float(charge.label_print_amount),
        "transport_dispatch_amount": float(charge.transport_dispatch_amount),
        "truck_unloading_amount": float(charge.truck_unloading_amount),
        "manual_charge_amount": float(charge.manual_charge_amount),
        "shipping_amount": float(charge.shipping_amount),
        "total": float(charge.total),
        "status": charge.status,
        "due_date": charge.due_date,
        "created_at": charge.created_at,
        "updated_at": charge.updated_at,
    }


def _serialize_billing_schedule(schedule: BillingSchedule, client_name: str) -> dict:
    return {
        "id": schedule.id,
        "client_id": schedule.client_id,
        "client_name": client_name,
        "day_of_month": schedule.day_of_month,
        "active": schedule.active,
        "created_at": schedule.created_at,
        "updated_at": schedule.updated_at,
    }


def _serialize_billing_document(document: BillingDocument, client_name: str) -> dict:
    return {
        "id": document.id,
        "client_id": document.client_id,
        "client_name": client_name,
        "period": document.period,
        "storage_total": float(document.storage_total),
        "preparation_total": float(document.preparation_total),
        "product_creation_total": float(document.product_creation_total),
        "label_print_total": float(document.label_print_total),
        "transport_dispatch_total": float(document.transport_dispatch_total),
        "truck_unloading_total": float(document.truck_unloading_total),
        "manual_charge_total": float(document.manual_charge_total),
        "shipping_total": float(document.shipping_total),
        "total": float(document.total),
        "status": document.status,
        "due_date": document.due_date,
        "created_at": document.created_at,
        "updated_at": document.updated_at,
    }


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise BadRequestError("La fecha debe tener formato YYYY-MM-DD") from exc


def _parse_period(period: str) -> tuple[datetime, datetime]:
    try:
        year_str, month_str = period.split("-")
        year = int(year_str)
        month = int(month_str)
    except ValueError as exc:
        raise BadRequestError("El período debe tener formato YYYY-MM") from exc

    if month < 1 or month > 12:
        raise BadRequestError("El mes del período es inválido")

    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start, end


def _validate_period_string(period: str) -> str:
    _parse_period(period)
    return period


def _default_due_date(period: str) -> date:
    year = int(period[:4])
    month = int(period[5:7])
    last_day = monthrange(year, month)[1]
    return date(year, month, last_day)


def _calculate_due_date(period: str, day_of_month: int | None) -> date:
    year = int(period[:4])
    month = int(period[5:7])
    if month == 12:
        due_year = year + 1
        due_month = 1
    else:
        due_year = year
        due_month = month + 1

    resolved_day = day_of_month or DEFAULT_BILLING_DAY
    last_day = monthrange(due_year, due_month)[1]
    return date(due_year, due_month, min(resolved_day, last_day))


def _discount_multiplier(discount_pct: Decimal | float | int | None) -> Decimal:
    normalized_discount = _to_decimal(discount_pct)
    multiplier = Decimal("1") - (normalized_discount / Decimal("100"))
    if multiplier < Decimal("0"):
        multiplier = Decimal("0")
    return multiplier.quantize(FOURPLACES, rounding=ROUND_HALF_UP)


def _apply_discount(amount: Decimal | float | int | None, discount_pct: Decimal | float | int | None, places: Decimal = TWOPLACES) -> Decimal:
    base_amount = _to_decimal(amount, places)
    return _to_decimal(base_amount * _discount_multiplier(discount_pct), places)


def _total_volume_for_quantities(
    quantities_by_product: dict[int, int],
    product_volumes: dict[int, Decimal],
) -> Decimal:
    total = Decimal("0.000")
    for product_id, quantity in quantities_by_product.items():
        normalized_quantity = max(int(quantity or 0), 0)
        if normalized_quantity <= 0:
            continue
        total += Decimal(normalized_quantity) * _to_decimal(product_volumes.get(product_id), FOURPLACES)
    return total.quantize(THREEPLACES, rounding=ROUND_HALF_UP)


def _calculate_storage_amount_from_daily_volumes(
    daily_volumes: list[Decimal | float | int | None],
    storage_rate: Decimal | float | int | None,
    days_in_month: int,
) -> Decimal:
    if days_in_month <= 0 or not daily_volumes:
        return Decimal("0.00")

    daily_rate = Decimal(str(storage_rate or 0)) / Decimal(str(days_in_month))
    total = Decimal("0.00")
    for volume in daily_volumes:
        total += _to_decimal(volume, THREEPLACES) * daily_rate
    return total.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def _resolve_storage_volume(
    volume_m3: Decimal | float | int | None,
    width_cm: Decimal | float | int | None,
    height_cm: Decimal | float | int | None,
    depth_cm: Decimal | float | int | None,
) -> Decimal:
    resolved_volume = _to_decimal(volume_m3, FOURPLACES) if volume_m3 is not None else Decimal("0.0000")
    if resolved_volume > Decimal("0.0000"):
        return resolved_volume

    dimensions = (width_cm, height_cm, depth_cm)
    if any(value is None for value in dimensions):
        return Decimal("0.0000")

    width = _to_decimal(width_cm, TWOPLACES)
    height = _to_decimal(height_cm, TWOPLACES)
    depth = _to_decimal(depth_cm, TWOPLACES)
    if width <= Decimal("0.00") or height <= Decimal("0.00") or depth <= Decimal("0.00"):
        return Decimal("0.0000")

    return _to_decimal((width * height * depth) / Decimal("1000000"), FOURPLACES)


def _build_daily_storage_volumes(
    current_quantities: dict[int, int],
    movement_rows: list[dict],
    product_volumes: dict[int, Decimal],
    start_day: date,
    end_day: date,
) -> list[Decimal]:
    if end_day < start_day:
        return []

    state = {product_id: max(int(quantity or 0), 0) for product_id, quantity in current_quantities.items()}
    ordered_movements = sorted(movement_rows, key=lambda item: item["created_at"], reverse=True)
    index = 0

    while index < len(ordered_movements):
        created_at = ordered_movements[index]["created_at"]
        movement_day = created_at.astimezone(timezone.utc).date() if created_at.tzinfo else created_at.date()
        if movement_day <= end_day:
            break
        product_id = ordered_movements[index]["product_id"]
        state[product_id] = max(state.get(product_id, 0) - int(ordered_movements[index]["quantity"] or 0), 0)
        index += 1

    daily_volumes: list[Decimal] = []
    current_day = end_day
    while current_day >= start_day:
        daily_volumes.append(_total_volume_for_quantities(state, product_volumes))
        while index < len(ordered_movements):
            created_at = ordered_movements[index]["created_at"]
            movement_day = created_at.astimezone(timezone.utc).date() if created_at.tzinfo else created_at.date()
            if movement_day != current_day:
                break
            product_id = ordered_movements[index]["product_id"]
            state[product_id] = max(state.get(product_id, 0) - int(ordered_movements[index]["quantity"] or 0), 0)
            index += 1
        current_day -= timedelta(days=1)

    daily_volumes.reverse()
    return daily_volumes


async def _calculate_variable_storage_metrics(
    db: AsyncSession,
    client_id: int,
    period: str,
    storage_rate: Decimal,
) -> tuple[Decimal, Decimal, bool]:
    start, end = _parse_period(period)
    now = datetime.now(timezone.utc)
    effective_end = min(end, now)
    if effective_end <= start:
        return Decimal("0.000"), Decimal("0.00"), False

    quantity_rows = await db.execute(
        select(
            Stock.product_id,
            func.coalesce(func.sum(Stock.quantity_total), 0),
            Product.volume_m3,
            Product.width_cm,
            Product.height_cm,
            Product.depth_cm,
        )
        .join(Product, Product.id == Stock.product_id)
        .where(Stock.client_id == client_id)
        .group_by(
            Stock.product_id,
            Product.volume_m3,
            Product.width_cm,
            Product.height_cm,
            Product.depth_cm,
        )
    )

    current_quantities: dict[int, int] = {}
    product_volumes: dict[int, Decimal] = {}
    missing_dimensions = False

    for product_id, quantity_total, volume_m3, width_cm, height_cm, depth_cm in quantity_rows.all():
        resolved_quantity = int(quantity_total or 0)
        resolved_volume = _resolve_storage_volume(volume_m3, width_cm, height_cm, depth_cm)
        current_quantities[product_id] = resolved_quantity
        product_volumes[product_id] = resolved_volume
        if resolved_quantity > 0 and resolved_volume <= Decimal("0.0000"):
            missing_dimensions = True

    movement_result = await db.execute(
        select(
            StockMovement.product_id,
            StockMovement.quantity,
            StockMovement.created_at,
            Product.volume_m3,
            Product.width_cm,
            Product.height_cm,
            Product.depth_cm,
        )
        .join(Product, Product.id == StockMovement.product_id)
        .where(
            StockMovement.client_id == client_id,
            StockMovement.movement_type.in_(VARIABLE_STORAGE_MOVEMENT_TYPES),
            StockMovement.created_at >= start,
            StockMovement.created_at < now,
        )
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
    )

    movement_rows: list[dict] = []
    for product_id, quantity, created_at, volume_m3, width_cm, height_cm, depth_cm in movement_result.all():
        resolved_volume = _resolve_storage_volume(volume_m3, width_cm, height_cm, depth_cm)
        current_quantities.setdefault(product_id, 0)
        product_volumes[product_id] = resolved_volume
        if int(quantity or 0) != 0 and resolved_volume <= Decimal("0.0000"):
            missing_dimensions = True
        movement_rows.append(
            {
                "product_id": product_id,
                "quantity": int(quantity or 0),
                "created_at": created_at,
            }
        )

    current_total_m3 = _total_volume_for_quantities(current_quantities, product_volumes)
    if missing_dimensions:
        return current_total_m3, Decimal("0.00"), True

    last_day_of_month = (end - timedelta(days=1)).date()
    billable_end_day = min(effective_end.date(), last_day_of_month)
    daily_volumes = _build_daily_storage_volumes(
        current_quantities,
        movement_rows,
        product_volumes,
        start.date(),
        billable_end_day,
    )
    days_in_month = monthrange(start.year, start.month)[1]
    storage_amount = _calculate_storage_amount_from_daily_volumes(daily_volumes, storage_rate, days_in_month)
    return current_total_m3, storage_amount, False


def _serialize_product_creation_record(record: ProductCreationRecord, client_name: str | None = None) -> dict:
    return {
        "id": record.id,
        "client_id": record.client_id,
        "client_name": client_name,
        "product_id": record.product_id,
        "product_name": record.product_name,
        "sku": record.sku,
        "price_applied": float(record.price_applied),
        "created_at": record.created_at,
    }


def _serialize_transport_dispatch_record(record: TransportDispatchRecord, client_name: str | None = None) -> dict:
    return {
        "id": record.id,
        "client_id": record.client_id,
        "client_name": client_name,
        "transportista": record.transportista,
        "cantidad_pedidos": record.cantidad_pedidos,
        "origen": record.origen,
        "costo_aplicado": float(record.costo_aplicado),
        "fecha": record.fecha,
    }


def _serialize_merchandise_reception_record(record: MerchandiseReceptionRecord, client_name: str | None = None) -> dict:
    return {
        "id": record.id,
        "client_id": record.client_id,
        "client_name": client_name,
        "fecha": record.fecha,
        "cantidad_camiones": record.cantidad_camiones,
        "observaciones": record.observaciones,
        "costo_unitario": float(record.costo_unitario),
        "costo_total": float(record.costo_total),
        "created_at": record.created_at,
    }


def _serialize_manual_charge(record: ManualCharge, client_name: str | None = None, is_locked: bool = False) -> dict:
    return {
        "id": record.id,
        "client_id": record.client_id,
        "client_name": client_name,
        "monto": float(record.monto),
        "descripcion": record.descripcion,
        "tipo": record.tipo,
        "fecha": record.fecha,
        "periodo": record.periodo,
        "created_at": record.created_at,
        "is_locked": is_locked,
    }


async def _is_period_closed_for_client(db: AsyncSession, client_id: int, period: str) -> bool:
    existing = (
        await db.execute(
            select(BillingDocument.id).where(
                BillingDocument.client_id == client_id,
                BillingDocument.period == period,
            ).limit(1)
        )
    ).scalar_one_or_none()
    return existing is not None


async def _get_or_create_global_rates(db: AsyncSession) -> BillingRates:
    result = await db.execute(select(BillingRates).limit(1))
    rates = result.scalar_one_or_none()
    if rates is None:
        rates = BillingRates(
            storage_per_m3=0,
            preparation_base_fee=0,
            preparation_additional_fee=0,
            preparation_price_simple=0,
            preparation_price_special=0,
            product_creation_fee=0,
            label_print_fee=0,
            transport_dispatch_fee=0,
            truck_unloading_fee=0,
            shipping_base=0,
        )
        db.add(rates)
        await db.flush()
        await db.refresh(rates)
    return rates


async def get_global_rates(db: AsyncSession) -> BillingRates:
    return await _get_or_create_global_rates(db)


async def update_global_rates(db: AsyncSession, data: dict) -> BillingRates:
    rates = await _get_or_create_global_rates(db)
    for key, value in data.items():
        setattr(rates, key, value)
    await db.flush()
    await db.refresh(rates)
    return rates


async def list_client_rates(db: AsyncSession) -> list[dict]:
    global_rates = await _get_or_create_global_rates(db)
    clients = (
        await db.execute(select(Client).where(Client.is_active.is_(True)).order_by(Client.name))
    ).scalars().all()
    if not clients:
        return []

    overrides = (
        await db.execute(select(ClientRates).where(ClientRates.client_id.in_([client.id for client in clients])))
    ).scalars().all()
    override_map = {item.client_id: item for item in overrides}

    return [
        {
            "id": override_map.get(client.id).id if override_map.get(client.id) else None,
            "client_id": client.id,
            "client_name": client.name,
            "storage_discount_pct": float(override_map[client.id].storage_discount_pct) if client.id in override_map and override_map[client.id].storage_discount_pct is not None else None,
            "shipping_discount_pct": float(override_map[client.id].shipping_discount_pct) if client.id in override_map and override_map[client.id].shipping_discount_pct is not None else None,
            "effective_storage_per_m3": float(_apply_discount(global_rates.storage_per_m3, override_map[client.id].storage_discount_pct if client.id in override_map else None)),
            "effective_shipping_base": float(_apply_discount(global_rates.shipping_base, override_map[client.id].shipping_discount_pct if client.id in override_map else None)),
            "effective_storage_discount_pct": float(_to_decimal(override_map[client.id].storage_discount_pct if client.id in override_map and override_map[client.id].storage_discount_pct is not None else 0)),
            "effective_shipping_discount_pct": float(_to_decimal(override_map[client.id].shipping_discount_pct if client.id in override_map and override_map[client.id].shipping_discount_pct is not None else 0)),
        }
        for client in clients
    ]


async def upsert_client_rates(db: AsyncSession, client_id: int, data: dict) -> dict:
    client = await db.get(Client, client_id)
    if client is None:
        raise NotFoundError(f"Client {client_id} not found")

    result = await db.execute(select(ClientRates).where(ClientRates.client_id == client_id))
    client_rates = result.scalar_one_or_none()
    if client_rates is None:
        client_rates = ClientRates(client_id=client_id)
        db.add(client_rates)

    for key, value in data.items():
        setattr(client_rates, key, value)

    await db.flush()

    global_rates = await _get_or_create_global_rates(db)
    await db.refresh(client_rates)
    return {
        "id": client_rates.id,
        "client_id": client.id,
        "client_name": client.name,
        "storage_discount_pct": float(client_rates.storage_discount_pct) if client_rates.storage_discount_pct is not None else None,
        "shipping_discount_pct": float(client_rates.shipping_discount_pct) if client_rates.shipping_discount_pct is not None else None,
        "effective_storage_per_m3": float(_apply_discount(global_rates.storage_per_m3, client_rates.storage_discount_pct)),
        "effective_shipping_base": float(_apply_discount(global_rates.shipping_base, client_rates.shipping_discount_pct)),
        "effective_storage_discount_pct": float(_to_decimal(client_rates.storage_discount_pct if client_rates.storage_discount_pct is not None else 0)),
        "effective_shipping_discount_pct": float(_to_decimal(client_rates.shipping_discount_pct if client_rates.shipping_discount_pct is not None else 0)),
    }


def _serialize_storage_record(record: ClientStorageRecord, client_name: str) -> dict:
    return {
        "id": record.id,
        "client_id": record.client_id,
        "client_name": client_name,
        "period": record.period,
        "storage_m3": float(record.storage_m3),
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


async def list_storage_records(
    db: AsyncSession,
    client_id: int | None = None,
    period: str | None = None,
) -> list[dict]:
    query = select(ClientStorageRecord, Client.name).join(Client, Client.id == ClientStorageRecord.client_id)
    if client_id is not None:
        client = await db.get(Client, client_id)
        if client is None:
            raise NotFoundError(f"Client {client_id} not found")
        query = query.where(ClientStorageRecord.client_id == client_id)
    if period:
        query = query.where(ClientStorageRecord.period == _validate_period_string(period))
    query = query.order_by(ClientStorageRecord.period.desc(), Client.name.asc())
    rows = (await db.execute(query)).all()
    return [_serialize_storage_record(record, client_name) for record, client_name in rows]


async def create_storage_record(db: AsyncSession, data: dict) -> dict:
    client = await db.get(Client, data["client_id"])
    if client is None:
        raise NotFoundError(f"Client {data['client_id']} not found")

    period = _validate_period_string(data["period"])
    existing = (
        await db.execute(
            select(ClientStorageRecord).where(
                ClientStorageRecord.client_id == client.id,
                ClientStorageRecord.period == period,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise BadRequestError("Ya existe una ocupación cargada para ese cliente y período")

    record = ClientStorageRecord(
        client_id=client.id,
        period=period,
        storage_m3=_to_decimal(data["storage_m3"], THREEPLACES),
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return _serialize_storage_record(record, client.name)


async def update_storage_record(db: AsyncSession, record_id: int, data: dict) -> dict:
    record = await db.get(ClientStorageRecord, record_id)
    if record is None:
        raise NotFoundError(f"Storage record {record_id} not found")

    record.storage_m3 = _to_decimal(data["storage_m3"], THREEPLACES)
    await db.flush()
    await db.refresh(record)

    client = await db.get(Client, record.client_id)
    return _serialize_storage_record(record, client.name if client else f"Cliente #{record.client_id}")


async def delete_storage_record(db: AsyncSession, record_id: int) -> None:
    record = await db.get(ClientStorageRecord, record_id)
    if record is None:
        raise NotFoundError(f"Storage record {record_id} not found")
    await db.delete(record)
    await db.flush()


async def _build_preview_rows(
    db: AsyncSession,
    period: str,
    user: User | None = None,
) -> list[_ComputedCharge]:
    start, end = _parse_period(period)
    global_rates = await _get_or_create_global_rates(db)
    current_product_creation_fee = _to_decimal(global_rates.product_creation_fee)
    current_label_print_fee = _to_decimal(global_rates.label_print_fee)

    clients_query = select(Client).where(Client.is_active.is_(True)).order_by(Client.name)
    if user is not None and user.role == UserRole.client:
        if user.client_id is None:
            return []
        clients_query = clients_query.where(Client.id == user.client_id)
    clients = (await db.execute(clients_query)).scalars().all()
    if not clients:
        return []

    client_ids = [client.id for client in clients]

    overrides = (
        await db.execute(select(ClientRates).where(ClientRates.client_id.in_(client_ids)))
    ).scalars().all()
    override_map = {item.client_id: item for item in overrides}

    storage_records = (
        await db.execute(
            select(ClientStorageRecord).where(
                ClientStorageRecord.client_id.in_(client_ids),
                ClientStorageRecord.period == period,
            )
        )
    ).scalars().all()
    storage_map = {record.client_id: record for record in storage_records}

    order_rows = await db.execute(
        select(
            Order.client_id,
            func.count(Order.id),
            func.coalesce(func.sum(func.coalesce(cast(Order.shipping_cost, Numeric(14, 2)), 0)), 0),
        )
        .where(
            Order.client_id.in_(client_ids),
            Order.dispatched_at.is_not(None),
            Order.dispatched_at >= start,
            Order.dispatched_at < end,
            Order.status == OrderStatus.dispatched,
        )
        .group_by(Order.client_id)
    )
    order_metrics_by_client = {
        client_id: {
            "total_orders": int(total_orders),
            "shipping_source_amount": _to_decimal(shipping_source_amount),
        }
        for client_id, total_orders, shipping_source_amount in order_rows.all()
    }

    preparation_rows = await db.execute(
        select(
            PreparationRecord.client_id,
            func.coalesce(func.sum(cast(PreparationRecord.total, Numeric(14, 2))), 0),
        )
        .join(Order, Order.id == PreparationRecord.order_id)
        .where(
            PreparationRecord.client_id.in_(client_ids),
            Order.dispatched_at.is_not(None),
            Order.dispatched_at >= start,
            Order.dispatched_at < end,
            Order.status == OrderStatus.dispatched,
        )
        .group_by(PreparationRecord.client_id)
    )
    preparation_amount_by_client = {
        client_id: _to_decimal(total_amount)
        for client_id, total_amount in preparation_rows.all()
    }

    product_creation_rows = await db.execute(
        select(
            ProductCreationRecord.client_id,
            func.coalesce(func.sum(cast(ProductCreationRecord.price_applied, Numeric(14, 2))), 0),
        )
        .where(
            ProductCreationRecord.client_id.in_(client_ids),
            ProductCreationRecord.created_at >= start,
            ProductCreationRecord.created_at < end,
        )
        .group_by(ProductCreationRecord.client_id)
    )
    product_creation_amount_by_client = {
        client_id: _to_decimal(total)
        for client_id, total in product_creation_rows.all()
    }

    product_creation_names_rows = await db.execute(
        select(ProductCreationRecord.client_id, ProductCreationRecord.product_name)
        .where(
            ProductCreationRecord.client_id.in_(client_ids),
            ProductCreationRecord.created_at >= start,
            ProductCreationRecord.created_at < end,
        )
        .order_by(ProductCreationRecord.created_at.asc(), ProductCreationRecord.id.asc())
    )
    product_creation_products_by_client: dict[int, list[str]] = {}
    for created_client_id, product_name in product_creation_names_rows.all():
        product_creation_products_by_client.setdefault(created_client_id, []).append(product_name)

    missing_product_creation_rows = await db.execute(
        select(Product.client_id, Product.name)
        .outerjoin(ProductCreationRecord, ProductCreationRecord.product_id == Product.id)
        .where(
            Product.client_id.in_(client_ids),
            ProductCreationRecord.id.is_(None),
            Product.created_at >= start,
            Product.created_at < end,
        )
        .order_by(Product.created_at.asc(), Product.id.asc())
    )
    missing_product_creation_products_by_client: dict[int, list[str]] = {}
    for created_client_id, product_name in missing_product_creation_rows.all():
        missing_product_creation_products_by_client.setdefault(created_client_id, []).append(product_name)

    label_print_rows = await db.execute(
        select(
            LabelPrintRecord.client_id,
            func.coalesce(func.sum(cast(LabelPrintRecord.price_applied, Numeric(14, 2))), 0),
            func.count(LabelPrintRecord.id),
        )
        .where(
            LabelPrintRecord.client_id.in_(client_ids),
            LabelPrintRecord.label_type == "product",
            LabelPrintRecord.printed_at >= start,
            LabelPrintRecord.printed_at < end,
        )
        .group_by(LabelPrintRecord.client_id)
    )
    label_print_metrics_by_client = {
        client_id: {
            "amount": _to_decimal(total_amount),
            "count": int(total_count or 0),
        }
        for client_id, total_amount, total_count in label_print_rows.all()
    }
    missing_label_print_rows = await db.execute(
        select(Product.client_id, Product.id)
        .where(
            Product.client_id.in_(client_ids),
            Product.created_at >= start,
            Product.created_at < end,
        )
    )
    period_product_rows = missing_label_print_rows.all()
    product_label_refs = [_product_label_reference(product_id) for _, product_id in period_product_rows]
    existing_product_label_refs = set()
    if product_label_refs:
        existing_product_label_refs = set(
            (
                await db.execute(
                    select(LabelPrintRecord.order_number).where(
                        LabelPrintRecord.label_type == "product",
                        LabelPrintRecord.order_number.in_(product_label_refs),
                    )
                )
            ).scalars().all()
        )
    missing_label_print_count_by_client: dict[int, int] = {}
    for label_client_id, product_id in period_product_rows:
        if f"product:{product_id}" in existing_product_label_refs:
            continue
        missing_label_print_count_by_client[label_client_id] = missing_label_print_count_by_client.get(label_client_id, 0) + 1

    transport_dispatch_rows = await db.execute(
        select(
            TransportDispatchRecord.client_id,
            func.coalesce(func.sum(cast(TransportDispatchRecord.costo_aplicado, Numeric(14, 2))), 0),
            func.count(TransportDispatchRecord.id),
        )
        .where(
            TransportDispatchRecord.client_id.in_(client_ids),
            TransportDispatchRecord.fecha >= start,
            TransportDispatchRecord.fecha < end,
        )
        .group_by(TransportDispatchRecord.client_id)
    )
    transport_dispatch_metrics_by_client = {
        client_id: {
            "amount": _to_decimal(total_amount),
            "count": int(total_count or 0),
        }
        for client_id, total_amount, total_count in transport_dispatch_rows.all()
    }

    transport_dispatch_names_rows = await db.execute(
        select(TransportDispatchRecord.client_id, TransportDispatchRecord.transportista)
        .where(
            TransportDispatchRecord.client_id.in_(client_ids),
            TransportDispatchRecord.fecha >= start,
            TransportDispatchRecord.fecha < end,
        )
        .order_by(TransportDispatchRecord.fecha.asc(), TransportDispatchRecord.id.asc())
    )
    transport_dispatch_transporters_by_client: dict[int, list[str]] = {}
    for dispatch_client_id, transporter_name in transport_dispatch_names_rows.all():
        transport_dispatch_transporters_by_client.setdefault(dispatch_client_id, []).append(transporter_name)

    manual_charge_rows = await db.execute(
        select(
            ManualCharge.client_id,
            func.coalesce(func.sum(cast(ManualCharge.monto, Numeric(14, 2))), 0),
        )
        .where(
            ManualCharge.client_id.in_(client_ids),
            ManualCharge.periodo == period,
        )
        .group_by(ManualCharge.client_id)
    )
    manual_charge_amount_by_client = {
        client_id: _to_decimal(total_amount)
        for client_id, total_amount in manual_charge_rows.all()
    }

    manual_charge_items_rows = await db.execute(
        select(
            ManualCharge.client_id,
            ManualCharge.id,
            ManualCharge.descripcion,
            ManualCharge.tipo,
            ManualCharge.fecha,
            ManualCharge.monto,
        )
        .where(
            ManualCharge.client_id.in_(client_ids),
            ManualCharge.periodo == period,
        )
        .order_by(ManualCharge.fecha.asc(), ManualCharge.id.asc())
    )
    manual_charge_items_by_client: dict[int, list[dict]] = {}
    for charge_client_id, charge_id, descripcion, tipo, fecha, monto in manual_charge_items_rows.all():
        manual_charge_items_by_client.setdefault(charge_client_id, []).append(
            {
                "id": charge_id,
                "descripcion": descripcion,
                "tipo": tipo,
                "fecha": fecha,
                "monto": float(_to_decimal(monto)),
            }
        )

    merchandise_reception_rows = await db.execute(
        select(
            MerchandiseReceptionRecord.client_id,
            func.coalesce(func.sum(cast(MerchandiseReceptionRecord.costo_total, Numeric(14, 2))), 0),
            func.coalesce(func.sum(MerchandiseReceptionRecord.cantidad_camiones), 0),
        )
        .where(
            MerchandiseReceptionRecord.client_id.in_(client_ids),
            MerchandiseReceptionRecord.fecha >= start,
            MerchandiseReceptionRecord.fecha < end,
        )
        .group_by(MerchandiseReceptionRecord.client_id)
    )
    merchandise_reception_metrics_by_client = {
        client_id: {
            "amount": _to_decimal(total_amount),
            "count": int(total_count or 0),
        }
        for client_id, total_amount, total_count in merchandise_reception_rows.all()
    }

    previews: list[_ComputedCharge] = []
    for client in clients:
        override = override_map.get(client.id)
        storage_base_rate = _to_decimal(global_rates.storage_per_m3)
        storage_discount_pct = _to_decimal(override.storage_discount_pct if override and override.storage_discount_pct is not None else 0)
        storage_rate = _apply_discount(storage_base_rate, storage_discount_pct)
        shipping_base = _to_decimal(global_rates.shipping_base)
        shipping_discount_pct = _to_decimal(override.shipping_discount_pct if override and override.shipping_discount_pct is not None else 0)
        shipping_multiplier = _discount_multiplier(shipping_discount_pct)

        if client.variable_storage_enabled or client.id not in storage_map:
            total_m3, storage_amount, missing_storage = await _calculate_variable_storage_metrics(
                db,
                client.id,
                period,
                storage_rate,
            )
        else:
            storage_record = storage_map.get(client.id)
            total_m3 = _to_decimal(storage_record.storage_m3 if storage_record else 0, THREEPLACES)
            storage_amount = _to_decimal(total_m3 * storage_rate)
            missing_storage = False

        order_metrics = order_metrics_by_client.get(client.id, {"total_orders": 0, "shipping_source_amount": Decimal("0.00")})
        total_orders = int(order_metrics["total_orders"])
        shipping_source_amount = _to_decimal(order_metrics["shipping_source_amount"])
        if shipping_source_amount <= Decimal("0.00") and total_orders > 0:
            shipping_source_amount = _to_decimal(Decimal(total_orders) * shipping_base)

        preparation_base_rate = _to_decimal(global_rates.preparation_base_fee)
        preparation_discount_pct = Decimal("0.00")
        preparation_rate = _to_decimal(global_rates.preparation_additional_fee)
        preparation_amount = preparation_amount_by_client.get(client.id, Decimal("0.00"))

        existing_product_creation_amount = product_creation_amount_by_client.get(client.id, Decimal("0.00"))
        existing_product_creation_products = product_creation_products_by_client.get(client.id, [])
        missing_product_creation_products = missing_product_creation_products_by_client.get(client.id, [])
        product_creation_amount = _to_decimal(
            existing_product_creation_amount + (current_product_creation_fee * Decimal(len(missing_product_creation_products)))
        )
        product_creation_products = [*existing_product_creation_products, *missing_product_creation_products]
        label_print_metrics = label_print_metrics_by_client.get(client.id, {"amount": Decimal("0.00"), "count": 0})
        missing_label_print_count = missing_label_print_count_by_client.get(client.id, 0)
        label_print_amount = _to_decimal(
            label_print_metrics["amount"] + (current_label_print_fee * Decimal(missing_label_print_count))
        )
        label_print_count = int(label_print_metrics["count"]) + missing_label_print_count
        transport_dispatch_metrics = transport_dispatch_metrics_by_client.get(client.id, {"amount": Decimal("0.00"), "count": 0})
        transport_dispatch_amount = transport_dispatch_metrics["amount"]
        transport_dispatch_count = int(transport_dispatch_metrics["count"])
        transport_dispatch_transporters = transport_dispatch_transporters_by_client.get(client.id, [])
        merchandise_reception_metrics = merchandise_reception_metrics_by_client.get(client.id, {"amount": Decimal("0.00"), "count": 0})
        truck_unloading_amount = merchandise_reception_metrics["amount"]
        truck_unloading_count = int(merchandise_reception_metrics["count"])
        manual_charge_amount = manual_charge_amount_by_client.get(client.id, Decimal("0.00"))
        manual_charge_items = manual_charge_items_by_client.get(client.id, [])
        shipping_amount = _apply_discount(shipping_source_amount, shipping_discount_pct)
        total = _to_decimal(storage_amount + preparation_amount + product_creation_amount + label_print_amount + transport_dispatch_amount + truck_unloading_amount + manual_charge_amount + shipping_amount)
        previews.append(
            _ComputedCharge(
                client=client,
                period=period,
                total_m3=total_m3,
                total_orders=total_orders,
                storage_base_rate=storage_base_rate,
                storage_discount_pct=storage_discount_pct,
                storage_rate=storage_rate,
                preparation_base_rate=preparation_base_rate,
                preparation_discount_pct=preparation_discount_pct,
                preparation_rate=preparation_rate,
                shipping_base=shipping_base,
                shipping_multiplier=shipping_multiplier,
                shipping_base_amount=shipping_source_amount,
                shipping_discount_pct=shipping_discount_pct,
                storage_amount=storage_amount,
                preparation_amount=preparation_amount,
                product_creation_amount=product_creation_amount,
                product_creation_products=product_creation_products,
                label_print_amount=label_print_amount,
                label_print_count=label_print_count,
                transport_dispatch_amount=transport_dispatch_amount,
                transport_dispatch_count=transport_dispatch_count,
                transport_dispatch_transporters=transport_dispatch_transporters,
                truck_unloading_amount=truck_unloading_amount,
                truck_unloading_count=truck_unloading_count,
                manual_charge_amount=manual_charge_amount,
                manual_charge_items=manual_charge_items,
                shipping_amount=shipping_amount,
                total=total,
                missing_storage=missing_storage,
            )
        )

    return previews


async def _refresh_document_statuses(db: AsyncSession) -> None:
    today = date.today()
    documents = (
        await db.execute(select(BillingDocument).where(BillingDocument.status != BillingDocumentStatus.paid))
    ).scalars().all()

    changed = False
    for document in documents:
        next_status = (
            BillingDocumentStatus.overdue
            if document.due_date < today
            else BillingDocumentStatus.pending
        )
        if document.status != next_status:
            document.status = next_status
            changed = True

    if changed:
        await db.flush()


async def preview_charges(db: AsyncSession, user: User, period: str) -> list[dict]:
    previews = await _build_preview_rows(db, period, user)
    return [
        {
            "client_id": preview.client.id,
            "client_name": preview.client.name,
            "period": preview.period,
            "total_m3": float(preview.total_m3),
            "total_orders": preview.total_orders,
            "storage_base_rate": float(preview.storage_base_rate),
            "storage_discount_pct": float(preview.storage_discount_pct),
            "storage_rate": float(preview.storage_rate),
            "preparation_base_rate": float(preview.preparation_base_rate),
            "preparation_discount_pct": float(preview.preparation_discount_pct),
            "preparation_rate": float(preview.preparation_rate),
            "shipping_base_amount": float(preview.shipping_base_amount),
            "shipping_discount_pct": float(preview.shipping_discount_pct),
            "storage_amount": float(preview.storage_amount),
            "preparation_amount": float(preview.preparation_amount),
            "product_creation_amount": float(preview.product_creation_amount),
            "product_creation_products": preview.product_creation_products,
            "label_print_amount": float(preview.label_print_amount),
            "label_print_count": preview.label_print_count,
            "transport_dispatch_amount": float(preview.transport_dispatch_amount),
            "transport_dispatch_count": preview.transport_dispatch_count,
            "transport_dispatch_transporters": preview.transport_dispatch_transporters,
            "truck_unloading_amount": float(preview.truck_unloading_amount),
            "truck_unloading_count": preview.truck_unloading_count,
            "manual_charge_amount": float(preview.manual_charge_amount),
            "manual_charge_items": preview.manual_charge_items,
            "shipping_amount": float(preview.shipping_amount),
            "total": float(preview.total),
            "missing_storage": preview.missing_storage,
        }
        for preview in previews
    ]


async def generate_charges(db: AsyncSession, period: str, due_date: date | None, overwrite: bool) -> list[Charge]:
    await _ensure_historical_billing_records(db)
    previews = await _build_preview_rows(db, period)
    if not previews:
        return []

    missing_storage_clients = [preview.client.name for preview in previews if preview.missing_storage]
    if missing_storage_clients:
        raise BadRequestError(
            "Faltan datos de almacenamiento para: " + ", ".join(missing_storage_clients)
        )

    resolved_due_date = due_date or _default_due_date(period)
    client_ids = [preview.client.id for preview in previews]
    existing = (
        await db.execute(select(Charge).where(Charge.period == period, Charge.client_id.in_(client_ids)))
    ).scalars().all()
    existing_map = {charge.client_id: charge for charge in existing}

    charges: list[Charge] = []
    for preview in previews:
        charge = existing_map.get(preview.client.id)
        if charge is None:
            charge = Charge(client_id=preview.client.id, period=period, due_date=resolved_due_date)
            db.add(charge)
        elif not overwrite:
            charges.append(charge)
            continue

        charge.total_m3 = preview.total_m3
        charge.total_orders = preview.total_orders
        charge.base_storage_rate = preview.storage_base_rate
        charge.storage_discount_pct = preview.storage_discount_pct
        charge.applied_storage_rate = preview.storage_rate
        charge.base_preparation_rate = preview.preparation_base_rate
        charge.preparation_discount_pct = preview.preparation_discount_pct
        charge.applied_preparation_rate = preview.preparation_rate
        charge.applied_shipping_base = preview.shipping_base
        charge.applied_shipping_multiplier = preview.shipping_multiplier
        charge.shipping_base_amount = preview.shipping_base_amount
        charge.shipping_discount_pct = preview.shipping_discount_pct
        charge.storage_amount = preview.storage_amount
        charge.preparation_amount = preview.preparation_amount
        charge.product_creation_amount = preview.product_creation_amount
        charge.label_print_amount = preview.label_print_amount
        charge.transport_dispatch_amount = preview.transport_dispatch_amount
        charge.truck_unloading_amount = preview.truck_unloading_amount
        charge.manual_charge_amount = preview.manual_charge_amount
        charge.shipping_amount = preview.shipping_amount
        charge.total = preview.total
        charge.status = ChargeStatus.pending
        charge.due_date = resolved_due_date
        charges.append(charge)

    await db.flush()
    for charge in charges:
        await db.refresh(charge)
    return charges


async def list_charges(
    db: AsyncSession,
    user: User,
    period: str | None = None,
    client_id: int | None = None,
    due_date_from: str | None = None,
    due_date_to: str | None = None,
    status: str | None = None,
) -> list[dict]:
    query = select(Charge, Client.name).join(Client, Client.id == Charge.client_id)
    if period:
        query = query.where(Charge.period == period)

    if client_id is not None:
        query = query.where(Charge.client_id == client_id)

    start_date = _parse_date(due_date_from)
    end_date = _parse_date(due_date_to)
    if start_date is not None:
        query = query.where(Charge.due_date >= start_date)
    if end_date is not None:
        query = query.where(Charge.due_date <= end_date)

    if status:
        try:
            query = query.where(Charge.status == ChargeStatus(status))
        except ValueError as exc:
            raise BadRequestError("Estado de cobro inválido") from exc

    if user.role == UserRole.client:
        if user.client_id is None:
            return []
        query = query.where(Charge.client_id == user.client_id)
    elif client_id is not None:
        client = await db.get(Client, client_id)
        if client is None:
            raise NotFoundError(f"Client {client_id} not found")
    query = query.order_by(Charge.period.desc(), Client.name.asc())
    rows = (await db.execute(query)).all()
    return [_serialize_charge(charge, client_name) for charge, client_name in rows]


async def get_charge(db: AsyncSession, charge_id: int, user: User) -> dict:
    row = (
        await db.execute(
            select(Charge, Client.name).join(Client, Client.id == Charge.client_id).where(Charge.id == charge_id)
        )
    ).first()
    if row is None:
        raise NotFoundError(f"Charge {charge_id} not found")
    charge, client_name = row
    check_tenant_access(user, charge.client_id)
    return _serialize_charge(charge, client_name)


async def generate_billing_documents(
    db: AsyncSession,
    period: str,
    overwrite: bool = True,
    client_id: int | None = None,
) -> list[BillingDocument]:
    await _ensure_historical_billing_records(db)
    previews = await _build_preview_rows(db, period)
    if not previews:
        return []

    if client_id is not None:
        previews = [preview for preview in previews if preview.client.id == client_id]
        if not previews:
            client = await db.get(Client, client_id)
            if client is None:
                raise NotFoundError(f"Client {client_id} not found")
            raise BadRequestError("No hay datos de facturación para ese cliente en el período seleccionado")

    client_ids = [preview.client.id for preview in previews]
    existing_documents = (
        await db.execute(
            select(BillingDocument).where(
                BillingDocument.period == period,
                BillingDocument.client_id.in_(client_ids),
            )
        )
    ).scalars().all()
    existing_map = {document.client_id: document for document in existing_documents}

    schedules = (
        await db.execute(select(BillingSchedule).where(BillingSchedule.client_id.in_(client_ids)))
    ).scalars().all()
    schedule_map = {schedule.client_id: schedule for schedule in schedules}

    documents: list[BillingDocument] = []
    for preview in previews:
        schedule = schedule_map.get(preview.client.id)
        billing_day = schedule.day_of_month if schedule and schedule.active else DEFAULT_BILLING_DAY
        due_date = _calculate_due_date(period, billing_day)

        document = existing_map.get(preview.client.id)
        if document is None:
            document = BillingDocument(client_id=preview.client.id, period=period, due_date=due_date)
            db.add(document)
        elif not overwrite:
            documents.append(document)
            continue

        document.storage_total = preview.storage_amount
        document.preparation_total = preview.preparation_amount
        document.product_creation_total = preview.product_creation_amount
        document.label_print_total = preview.label_print_amount
        document.transport_dispatch_total = preview.transport_dispatch_amount
        document.truck_unloading_total = preview.truck_unloading_amount
        document.manual_charge_total = preview.manual_charge_amount
        document.shipping_total = preview.shipping_amount
        document.total = preview.total
        document.due_date = due_date
        document.status = (
            BillingDocumentStatus.overdue
            if due_date < date.today()
            else BillingDocumentStatus.pending
        )
        documents.append(document)

    await db.flush()
    for document in documents:
        await db.refresh(document)
    return documents


async def generate_single_billing_document(
    db: AsyncSession,
    client_id: int,
    period: str,
    overwrite: bool = True,
) -> dict:
    documents = await generate_billing_documents(db, period, overwrite=overwrite, client_id=client_id)
    if not documents:
        raise BadRequestError("No se pudo generar el remito solicitado")

    client = await db.get(Client, client_id)
    client_name = client.name if client else f"Cliente #{client_id}"
    return _serialize_billing_document(documents[0], client_name)


async def list_billing_documents(
    db: AsyncSession,
    user: User,
    period: str | None = None,
    client_id: int | None = None,
    status: str | None = None,
) -> list[dict]:
    await _refresh_document_statuses(db)

    query = select(BillingDocument, Client.name).join(Client, Client.id == BillingDocument.client_id)
    if period:
        query = query.where(BillingDocument.period == _validate_period_string(period))

    if client_id is not None:
        query = query.where(BillingDocument.client_id == client_id)

    if status:
        try:
            query = query.where(BillingDocument.status == BillingDocumentStatus(status))
        except ValueError as exc:
            raise BadRequestError("Estado de remito inválido") from exc

    if user.role == UserRole.client:
        if user.client_id is None:
            return []
        query = query.where(BillingDocument.client_id == user.client_id)
    elif client_id is not None:
        client = await db.get(Client, client_id)
        if client is None:
            raise NotFoundError(f"Client {client_id} not found")

    query = query.order_by(BillingDocument.due_date.asc(), Client.name.asc())
    rows = (await db.execute(query)).all()
    return [_serialize_billing_document(document, client_name) for document, client_name in rows]


async def mark_billing_document_paid(db: AsyncSession, document_id: int, user: User) -> dict:
    row = (
        await db.execute(
            select(BillingDocument, Client.name)
            .join(Client, Client.id == BillingDocument.client_id)
            .where(BillingDocument.id == document_id)
        )
    ).first()
    if row is None:
        raise NotFoundError(f"Billing document {document_id} not found")

    document, client_name = row
    check_tenant_access(user, document.client_id)
    document.status = BillingDocumentStatus.paid
    await db.flush()
    await db.refresh(document)
    return _serialize_billing_document(document, client_name)


async def get_billing_alerts(db: AsyncSession, user: User) -> dict:
    await _refresh_document_statuses(db)

    today = date.today()
    due_soon_limit = today.fromordinal(today.toordinal() + ALERT_DUE_SOON_DAYS)

    query = select(BillingDocument, Client.name).join(Client, Client.id == BillingDocument.client_id)
    if user.role == UserRole.client:
        if user.client_id is None:
            return {
                "due_soon_count": 0,
                "due_soon_days": ALERT_DUE_SOON_DAYS,
                "overdue_count": 0,
                "due_soon_documents": [],
                "overdue_documents": [],
            }
        query = query.where(BillingDocument.client_id == user.client_id)

    rows = (await db.execute(query)).all()
    due_soon_documents: list[dict] = []
    overdue_documents: list[dict] = []
    for document, client_name in rows:
        serialized = _serialize_billing_document(document, client_name)
        if document.status == BillingDocumentStatus.overdue:
            overdue_documents.append(serialized)
        elif document.status == BillingDocumentStatus.pending and today <= document.due_date <= due_soon_limit:
            due_soon_documents.append(serialized)

    due_soon_documents.sort(key=lambda item: item["due_date"])
    overdue_documents.sort(key=lambda item: item["due_date"])
    return {
        "due_soon_count": len(due_soon_documents),
        "due_soon_days": ALERT_DUE_SOON_DAYS,
        "overdue_count": len(overdue_documents),
        "due_soon_documents": due_soon_documents,
        "overdue_documents": overdue_documents,
    }


# ──────────────────────────────────────────────
#  PREPARATION RECORDS
# ──────────────────────────────────────────────

async def record_prepared_order(
    db: AsyncSession,
    order: Order,
) -> None:
    existing = (
        await db.execute(
            select(PreparationRecord.id).where(PreparationRecord.order_id == order.id).limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return

    cantidad_items = sum(max(int(item.quantity or 0), 0) for item in order.items)
    if cantidad_items <= 0:
        return

    rates = await _get_or_create_global_rates(db)
    precio_base = _to_decimal(rates.preparation_base_fee)
    precio_adicional = _to_decimal(rates.preparation_additional_fee)
    total = precio_base
    if cantidad_items > 1:
        total = _to_decimal(precio_base + (Decimal(cantidad_items - 1) * precio_adicional))

    record = PreparationRecord(
        client_id=order.client_id,
        order_id=order.id,
        product_id=None,
        order_item_id=None,
        cantidad_items=cantidad_items,
        precio_base=precio_base,
        precio_adicional=precio_adicional,
        total=total,
        preparation_type="progresiva",
        price_applied=total,
    )
    db.add(record)


async def list_preparation_records(
    db: AsyncSession,
    client_id: int | None = None,
    period: str | None = None,
    order_id: int | None = None,
    user: User | None = None,
) -> list[dict]:
    query = (
        select(PreparationRecord, Client.name)
        .join(Client, Client.id == PreparationRecord.client_id)
        .order_by(PreparationRecord.recorded_at.desc())
    )

    if user is not None and user.role == UserRole.client:
        if user.client_id is None:
            return []
        query = query.where(PreparationRecord.client_id == user.client_id)
    elif client_id is not None:
        query = query.where(PreparationRecord.client_id == client_id)

    if period:
        start, end = _parse_period(period)
        query = query.where(PreparationRecord.recorded_at >= start, PreparationRecord.recorded_at < end)

    if order_id is not None:
        query = query.where(PreparationRecord.order_id == order_id)

    rows = (await db.execute(query)).all()
    return [
        {
            "id": record.id,
            "client_id": record.client_id,
            "client_name": client_name,
            "order_id": record.order_id,
            "product_id": record.product_id,
            "order_item_id": record.order_item_id,
            "cantidad_items": record.cantidad_items,
            "precio_base": float(record.precio_base),
            "precio_adicional": float(record.precio_adicional),
            "total": float(record.total),
            "preparation_type": record.preparation_type,
            "price_applied": float(record.price_applied),
            "recorded_at": record.recorded_at,
        }
        for record, client_name in rows
    ]


async def record_product_created(db: AsyncSession, product) -> None:
    rates = await _get_or_create_global_rates(db)
    record = ProductCreationRecord(
        client_id=product.client_id,
        product_id=product.id,
        product_name=product.name,
        sku=product.sku,
        price_applied=_to_decimal(rates.product_creation_fee),
    )
    db.add(record)


async def _create_missing_product_creation_records(db: AsyncSession, rate: Decimal) -> None:
    missing_products = (
        await db.execute(
            select(Product)
            .outerjoin(ProductCreationRecord, ProductCreationRecord.product_id == Product.id)
            .where(ProductCreationRecord.id.is_(None))
            .order_by(Product.created_at.asc(), Product.id.asc())
        )
    ).scalars().all()

    for product in missing_products:
        db.add(
            ProductCreationRecord(
                client_id=product.client_id,
                product_id=product.id,
                product_name=product.name,
                sku=product.sku,
                price_applied=rate,
                created_at=product.created_at,
            )
        )
        product.alta_cobrada = True

    existing_uncounted_products = (
        await db.execute(
            select(Product)
            .join(ProductCreationRecord, ProductCreationRecord.product_id == Product.id)
            .where(Product.alta_cobrada.is_(False))
        )
    ).scalars().all()
    for product in existing_uncounted_products:
        product.alta_cobrada = True


def _product_label_reference(product_id: int) -> str:
    return f"product:{product_id}"


async def record_product_first_label_print(
    db: AsyncSession,
    product: Product,
    printed_at: datetime | None = None,
) -> bool:
    if product.id is None:
        return False

    existing = (
        await db.execute(
            select(LabelPrintRecord.id).where(
                LabelPrintRecord.label_type == "product",
                LabelPrintRecord.order_number == _product_label_reference(product.id),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return False

    rates = await _get_or_create_global_rates(db)
    db.add(
        LabelPrintRecord(
            client_id=product.client_id,
            order_id=None,
            order_number=_product_label_reference(product.id),
            label_type="product",
            price_applied=_to_decimal(rates.label_print_fee),
            printed_at=printed_at or datetime.now(timezone.utc),
        )
    )
    await db.flush()
    return True


async def _create_missing_product_label_print_records(db: AsyncSession, rate: Decimal) -> None:
    existing_refs = set(
        (
            await db.execute(
                select(LabelPrintRecord.order_number).where(
                    LabelPrintRecord.label_type == "product",
                    LabelPrintRecord.order_number.like("product:%"),
                )
            )
        ).scalars().all()
    )

    products = (
        await db.execute(select(Product).order_by(Product.created_at.asc(), Product.id.asc()))
    ).scalars().all()

    for product in products:
        reference = _product_label_reference(product.id)
        if reference in existing_refs:
            continue
        db.add(
            LabelPrintRecord(
                client_id=product.client_id,
                order_id=None,
                order_number=reference,
                label_type="product",
                price_applied=rate,
                printed_at=product.created_at,
            )
        )
        existing_refs.add(reference)


async def record_first_label_print(
    db: AsyncSession,
    orders,
    printed_at: datetime,
    label_type,
) -> None:
    return None


async def _create_missing_label_print_records(db: AsyncSession, rate: Decimal) -> None:
    await _create_missing_product_label_print_records(db, rate)


async def _ensure_historical_billing_records(db: AsyncSession) -> None:
    rates = await _get_or_create_global_rates(db)
    await _create_missing_product_creation_records(db, _to_decimal(rates.product_creation_fee))
    await _create_missing_label_print_records(db, _to_decimal(rates.label_print_fee))
    await db.flush()


async def record_transport_dispatch(
    db: AsyncSession,
    *,
    client_id: int,
    transportista: str | None,
    cantidad_pedidos: int,
    fecha: datetime | None = None,
    origen: str = "manual_facturacion",
) -> None:
    rates = await _get_or_create_global_rates(db)
    record = TransportDispatchRecord(
        client_id=client_id,
        transportista=(transportista or "Sin especificar").strip() or "Sin especificar",
        cantidad_pedidos=max(int(cantidad_pedidos), 0),
        origen=(origen or "manual_facturacion").strip() or "manual_facturacion",
        costo_aplicado=_to_decimal(rates.transport_dispatch_fee),
        fecha=fecha or datetime.now(timezone.utc),
    )
    db.add(record)


async def create_transport_dispatch_record(db: AsyncSession, data: dict) -> dict:
    client = await db.get(Client, data["client_id"])
    if client is None:
        raise NotFoundError(f"Client {data['client_id']} not found")

    transportista = str(data["transportista"]).strip()
    if not transportista:
        raise BadRequestError("Debe indicar un transportista")

    fecha = data["fecha"]
    record_datetime = datetime(fecha.year, fecha.month, fecha.day, tzinfo=timezone.utc)

    await record_transport_dispatch(
        db,
        client_id=client.id,
        transportista=transportista,
        cantidad_pedidos=int(data["cantidad_pedidos"]),
        fecha=record_datetime,
        origen="manual_facturacion",
    )
    await db.flush()

    row = (
        await db.execute(
            select(TransportDispatchRecord, Client.name)
            .join(Client, Client.id == TransportDispatchRecord.client_id)
            .where(
                TransportDispatchRecord.client_id == client.id,
                TransportDispatchRecord.transportista == transportista,
                TransportDispatchRecord.cantidad_pedidos == int(data["cantidad_pedidos"]),
                TransportDispatchRecord.origen == "manual_facturacion",
                TransportDispatchRecord.fecha == record_datetime,
            )
            .order_by(TransportDispatchRecord.id.desc())
        )
    ).first()
    if row is None:
        raise BadRequestError("No se pudo crear el despacho a transporte")
    record, client_name = row
    return _serialize_transport_dispatch_record(record, client_name)


async def record_merchandise_reception(
    db: AsyncSession,
    *,
    client_id: int,
    cantidad_camiones: int,
    fecha: datetime | None = None,
    observaciones: str | None = None,
) -> None:
    rates = await _get_or_create_global_rates(db)
    truck_count = max(int(cantidad_camiones), 1)
    unit_cost = _to_decimal(rates.truck_unloading_fee)
    total_cost = _to_decimal(Decimal(truck_count) * unit_cost)
    record = MerchandiseReceptionRecord(
        client_id=client_id,
        fecha=fecha or datetime.now(timezone.utc),
        cantidad_camiones=truck_count,
        observaciones=(observaciones or "").strip() or None,
        costo_unitario=unit_cost,
        costo_total=total_cost,
    )
    db.add(record)


async def create_merchandise_reception_record(db: AsyncSession, data: dict) -> dict:
    client = await db.get(Client, data["client_id"])
    if client is None:
        raise NotFoundError(f"Client {data['client_id']} not found")

    fecha = data["fecha"]
    record_datetime = datetime(fecha.year, fecha.month, fecha.day, tzinfo=timezone.utc)
    observaciones = (data.get("observaciones") or "").strip() or None

    await record_merchandise_reception(
        db,
        client_id=client.id,
        cantidad_camiones=int(data["cantidad_camiones"]),
        fecha=record_datetime,
        observaciones=observaciones,
    )
    await db.flush()

    row = (
        await db.execute(
            select(MerchandiseReceptionRecord, Client.name)
            .join(Client, Client.id == MerchandiseReceptionRecord.client_id)
            .where(
                MerchandiseReceptionRecord.client_id == client.id,
                MerchandiseReceptionRecord.fecha == record_datetime,
                MerchandiseReceptionRecord.cantidad_camiones == int(data["cantidad_camiones"]),
                MerchandiseReceptionRecord.observaciones.is_(observaciones) if observaciones is None else MerchandiseReceptionRecord.observaciones == observaciones,
            )
            .order_by(MerchandiseReceptionRecord.id.desc())
        )
    ).first()
    if row is None:
        raise BadRequestError("No se pudo crear la recepción de mercadería")
    record, client_name = row
    return _serialize_merchandise_reception_record(record, client_name)


async def delete_merchandise_reception_record(db: AsyncSession, record_id: int) -> None:
    record = await db.get(MerchandiseReceptionRecord, record_id)
    if record is None:
        raise NotFoundError(f"Merchandise reception record {record_id} not found")
    await db.delete(record)
    await db.flush()


async def delete_transport_dispatch_record(db: AsyncSession, record_id: int) -> None:
    record = await db.get(TransportDispatchRecord, record_id)
    if record is None:
        raise NotFoundError(f"Transport dispatch record {record_id} not found")
    await db.delete(record)
    await db.flush()


async def list_manual_charges(
    db: AsyncSession,
    client_id: int | None = None,
    period: str | None = None,
    user: User | None = None,
) -> list[dict]:
    query = (
        select(ManualCharge, Client.name)
        .join(Client, Client.id == ManualCharge.client_id)
        .order_by(ManualCharge.fecha.desc(), ManualCharge.id.desc())
    )

    if user is not None and user.role == UserRole.client:
        if user.client_id is None:
            return []
        query = query.where(ManualCharge.client_id == user.client_id)
    elif client_id is not None:
        query = query.where(ManualCharge.client_id == client_id)

    if period:
        query = query.where(ManualCharge.periodo == period)

    rows = (await db.execute(query)).all()
    locked_cache: dict[tuple[int, str], bool] = {}
    serialized: list[dict] = []
    for record, client_name in rows:
        cache_key = (record.client_id, record.periodo)
        if cache_key not in locked_cache:
            locked_cache[cache_key] = await _is_period_closed_for_client(db, record.client_id, record.periodo)
        serialized.append(_serialize_manual_charge(record, client_name, is_locked=locked_cache[cache_key]))
    return serialized


async def create_manual_charge(db: AsyncSession, data: dict) -> dict:
    client = await db.get(Client, data["client_id"])
    if client is None:
        raise NotFoundError(f"Client {data['client_id']} not found")

    period = _validate_period_string(data["periodo"])
    amount = _to_decimal(data.get("monto"))
    if amount == Decimal("0.00"):
        raise BadRequestError("El monto del cargo manual no puede ser 0")

    charge_date = datetime.combine(data["fecha"], datetime.min.time(), tzinfo=timezone.utc)
    if charge_date.strftime("%Y-%m") != period:
        raise BadRequestError("La fecha del cargo manual debe pertenecer al período seleccionado")

    record = ManualCharge(
        client_id=client.id,
        monto=amount,
        descripcion=(data.get("descripcion") or "").strip() or None,
        tipo=(data.get("tipo") or "").strip() or None,
        fecha=charge_date,
        periodo=period,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return _serialize_manual_charge(record, client.name, is_locked=False)


async def delete_manual_charge(db: AsyncSession, charge_id: int) -> None:
    record = await db.get(ManualCharge, charge_id)
    if record is None:
        raise NotFoundError(f"Manual charge {charge_id} not found")
    await db.delete(record)
    await db.flush()


async def list_product_creation_records(
    db: AsyncSession,
    client_id: int | None = None,
    period: str | None = None,
    user: User | None = None,
) -> list[dict]:
    query = (
        select(ProductCreationRecord, Client.name)
        .join(Client, Client.id == ProductCreationRecord.client_id)
        .order_by(ProductCreationRecord.created_at.desc())
    )

    if user is not None and user.role == UserRole.client:
        if user.client_id is None:
            return []
        query = query.where(ProductCreationRecord.client_id == user.client_id)
    elif client_id is not None:
        query = query.where(ProductCreationRecord.client_id == client_id)

    if period:
        start, end = _parse_period(period)
        query = query.where(ProductCreationRecord.created_at >= start, ProductCreationRecord.created_at < end)

    rows = (await db.execute(query)).all()
    return [_serialize_product_creation_record(record, client_name) for record, client_name in rows]


async def list_transport_dispatch_records(
    db: AsyncSession,
    client_id: int | None = None,
    period: str | None = None,
    user: User | None = None,
) -> list[dict]:
    query = (
        select(TransportDispatchRecord, Client.name)
        .join(Client, Client.id == TransportDispatchRecord.client_id)
        .order_by(TransportDispatchRecord.fecha.desc())
    )

    if user is not None and user.role == UserRole.client:
        if user.client_id is None:
            return []
        query = query.where(TransportDispatchRecord.client_id == user.client_id)
    elif client_id is not None:
        query = query.where(TransportDispatchRecord.client_id == client_id)

    if period:
        start, end = _parse_period(period)
        query = query.where(TransportDispatchRecord.fecha >= start, TransportDispatchRecord.fecha < end)

    rows = (await db.execute(query)).all()
    return [_serialize_transport_dispatch_record(record, client_name) for record, client_name in rows]


async def list_merchandise_reception_records(
    db: AsyncSession,
    client_id: int | None = None,
    period: str | None = None,
    user: User | None = None,
) -> list[dict]:
    query = (
        select(MerchandiseReceptionRecord, Client.name)
        .join(Client, Client.id == MerchandiseReceptionRecord.client_id)
        .order_by(MerchandiseReceptionRecord.fecha.desc(), MerchandiseReceptionRecord.id.desc())
    )

    if user is not None and user.role == UserRole.client:
        if user.client_id is None:
            return []
        query = query.where(MerchandiseReceptionRecord.client_id == user.client_id)
    elif client_id is not None:
        query = query.where(MerchandiseReceptionRecord.client_id == client_id)

    if period:
        start, end = _parse_period(period)
        query = query.where(MerchandiseReceptionRecord.fecha >= start, MerchandiseReceptionRecord.fecha < end)

    rows = (await db.execute(query)).all()
    return [_serialize_merchandise_reception_record(record, client_name) for record, client_name in rows]
