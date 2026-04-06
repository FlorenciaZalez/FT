from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.models import BillingSchedule
from app.clients.models import Client, PlanType
from app.orders.models import Order
from app.products.models import Product
from app.stock.models import Stock
from app.common.exceptions import NotFoundError, ConflictError


def _client_with_relations():
    return select(Client).options(
        selectinload(Client.ml_account),
        selectinload(Client.billing_schedule),
    )


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


async def list_clients(db: AsyncSession, skip: int = 0, limit: int = 50) -> tuple[list[Client], int]:
    total_q = await db.execute(select(func.count(Client.id)))
    total = total_q.scalar_one()

    result = await db.execute(
        _client_with_relations().order_by(Client.id).offset(skip).limit(limit)
    )
    return result.scalars().all(), total


async def get_client(db: AsyncSession, client_id: int) -> Client:
    result = await db.execute(_client_with_relations().where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if client is None:
        raise NotFoundError(f"Client {client_id} not found")
    return client


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


async def update_client(db: AsyncSession, client_id: int, data: dict) -> Client:
    client = await get_client(db, client_id)
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
    client = await get_client(db, client_id)

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
