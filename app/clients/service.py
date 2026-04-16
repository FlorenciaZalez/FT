from sqlalchemy import select, func, cast, String
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.models import BillingSchedule
from app.clients.models import Client, PlanType
from app.orders.models import Order
from app.products.models import Product
from app.stock.models import Stock
from app.auth.models import UserRole
from app.common.exceptions import NotFoundError, ConflictError, ForbiddenError
from app.integrations.mercadolibre.models import MercadoLibreAccount


def _client_with_relations():
    return select(Client).options(
        selectinload(Client.ml_account),
        selectinload(Client.billing_schedule),
    )


def _scope_client_query(query, user=None):
    if user is None:
        return query
    if user.role in (UserRole.admin, UserRole.operator):
        return query
    if user.client_id is None:
        raise ForbiddenError("User has no associated client")
    return query.where(Client.id == user.client_id)


async def _upsert_billing_schedule(db: AsyncSession, client: Client, day_of_month: int | None) -> None:
    if day_of_month is None:
        return

    result = await db.execute(select(BillingSchedule).where(BillingSchedule.client_id == client.id))
    schedule = result.scalar_one_or_none()
    if schedule is None:
        schedule = BillingSchedule(client_id=client.id, day_of_month=day_of_month, active=True)
        db.add(schedule)
        await db.flush()
        return

    schedule.day_of_month = day_of_month
    schedule.active = True


def _client_base_query():
    return select(
        Client.id,
        Client.name,
        Client.business_name,
        Client.tax_id,
        Client.contact_email,
        Client.contact_phone,
        Client.contact_name,
        Client.contact_phone_operational,
        cast(Client.__table__.c.plan, String).label("plan"),
        Client.is_active,
        func.coalesce(Client.variable_storage_enabled, False).label("variable_storage_enabled"),
        Client.created_at,
        Client.updated_at,
    )


async def _attach_client_relations(db: AsyncSession, rows: list[dict]) -> list[dict]:
    if not rows:
        return []

    client_ids = [int(row["id"]) for row in rows]
    billing_schedule_map: dict[int, dict] = {}
    ml_account_map: dict[int, dict] = {}

    schedule_result = await db.execute(
        select(BillingSchedule.client_id, BillingSchedule.day_of_month, BillingSchedule.active).where(
            BillingSchedule.client_id.in_(client_ids)
        )
    )
    for client_id, day_of_month, active in schedule_result.all():
        billing_schedule_map[client_id] = {
            "day_of_month": day_of_month,
            "active": bool(active),
        }

    ml_result = await db.execute(
        select(
            MercadoLibreAccount.client_id,
            cast(MercadoLibreAccount.ml_user_id, String),
            MercadoLibreAccount.ml_nickname,
            MercadoLibreAccount.connected_at,
        ).where(MercadoLibreAccount.client_id.in_(client_ids))
    )
    for client_id, ml_user_id, ml_nickname, connected_at in ml_result.all():
        ml_account_map[client_id] = {
            "ml_user_id": ml_user_id,
            "ml_nickname": ml_nickname,
            "connected_at": connected_at,
        }

    payloads: list[dict] = []
    for row in rows:
        payload = dict(row)
        payload["plan"] = payload.get("plan") or "basic"
        payload["is_active"] = bool(payload.get("is_active", True))
        payload["variable_storage_enabled"] = bool(payload.get("variable_storage_enabled", False))
        payload["billing_schedule"] = billing_schedule_map.get(payload["id"])
        payload["ml_account"] = ml_account_map.get(payload["id"])
        payloads.append(payload)
    return payloads


async def list_clients(db: AsyncSession, user=None, skip: int = 0, limit: int = 50) -> tuple[list[dict], int]:
    base_ids_query = _scope_client_query(select(Client.id), user)
    total_q = await db.execute(select(func.count()).select_from(base_ids_query.subquery()))
    total = total_q.scalar_one()

    query = _scope_client_query(_client_base_query().order_by(Client.id), user).offset(skip).limit(limit)
    result = await db.execute(query)
    return await _attach_client_relations(db, result.mappings().all()), total


async def get_client(db: AsyncSession, client_id: int, user=None) -> dict:
    query = _scope_client_query(_client_base_query().where(Client.id == client_id), user)
    result = await db.execute(query)
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundError(f"Client {client_id} not found")
    payloads = await _attach_client_relations(db, [row])
    return payloads[0]


async def create_client(db: AsyncSession, data: dict) -> Client:
    if data.get("tax_id"):
        existing = await db.execute(select(Client).where(Client.tax_id == data["tax_id"]))
        if existing.scalar_one_or_none():
            raise ConflictError(f"Tax ID {data['tax_id']} already registered")

    billing_day_of_month = data.pop("billing_day_of_month", None)
    client = Client(**{**data, "plan": PlanType(data.get("plan", "basic"))})
    db.add(client)
    await db.flush()
    await _upsert_billing_schedule(db, client, billing_day_of_month)
    await db.refresh(client)
    return await get_client(db, client.id)


async def _get_client_model(db: AsyncSession, client_id: int) -> Client:
    result = await db.execute(_client_with_relations().where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if client is None:
        raise NotFoundError(f"Client {client_id} not found")
    return client


async def update_client(db: AsyncSession, client_id: int, data: dict) -> Client:
    client = await _get_client_model(db, client_id)
    has_billing_day_of_month = "billing_day_of_month" in data
    billing_day_of_month = data.pop("billing_day_of_month", None) if has_billing_day_of_month else None
    for key, value in data.items():
        if value is not None:
            if key == "plan":
                value = PlanType(value)
            setattr(client, key, value)
    if has_billing_day_of_month:
        await _upsert_billing_schedule(db, client, billing_day_of_month)
    await db.flush()
    await db.refresh(client)
    return await get_client(db, client.id)


async def delete_client(db: AsyncSession, client_id: int) -> None:
    client = await _get_client_model(db, client_id)

    order_count = (await db.execute(
        select(func.count(Order.id)).where(Order.client_id == client_id)
    )).scalar_one()

    product_count = (await db.execute(
        select(func.count(Product.id)).where(Product.client_id == client_id)
    )).scalar_one()

    stock_count = (await db.execute(
        select(func.count(Stock.id)).where(Stock.client_id == client_id)
    )).scalar_one()

    reasons = []
    if order_count > 0:
        reasons.append(f"{order_count} pedido(s)")
    if product_count > 0:
        reasons.append(f"{product_count} producto(s)")
    if stock_count > 0:
        reasons.append(f"{stock_count} registro(s) de stock")

    if reasons:
        raise ConflictError(
            f"No se puede eliminar el cliente porque tiene {', '.join(reasons)} asociados"
        )

    await db.delete(client)
    await db.flush()
