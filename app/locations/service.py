from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.locations.models import WarehouseLocation
from app.common.exceptions import NotFoundError, ConflictError, BadRequestError


def _build_code(zone: str, aisle: str, shelf: str, position: str) -> str:
    """Generate location code like A-01-02-03."""
    return f"{zone.upper()}-{aisle.zfill(2)}-{shelf.zfill(2)}-{position.zfill(2)}"


async def list_zones(db: AsyncSession) -> list[str]:
    result = await db.execute(
        select(WarehouseLocation.zone)
        .where(WarehouseLocation.is_active.is_(True))
        .distinct()
        .order_by(WarehouseLocation.zone)
    )
    return [row[0] for row in result.all()]


async def list_locations(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    zone: str | None = None,
    aisle: str | None = None,
    search: str | None = None,
) -> tuple[list[WarehouseLocation], int]:
    base = select(WarehouseLocation)
    if zone:
        base = base.where(WarehouseLocation.zone == zone.upper())
    if aisle:
        base = base.where(WarehouseLocation.aisle == aisle)
    if search:
        base = base.where(WarehouseLocation.code.ilike(f"%{search}%"))

    count_q = await db.execute(select(func.count()).select_from(base.subquery()))
    total = count_q.scalar_one()

    result = await db.execute(base.order_by(WarehouseLocation.code).offset(skip).limit(limit))
    return result.scalars().all(), total


async def get_location(db: AsyncSession, location_id: int) -> WarehouseLocation:
    result = await db.execute(select(WarehouseLocation).where(WarehouseLocation.id == location_id))
    loc = result.scalar_one_or_none()
    if loc is None:
        raise NotFoundError(f"Location {location_id} not found")
    return loc


async def get_location_by_code(db: AsyncSession, code: str) -> WarehouseLocation:
    result = await db.execute(select(WarehouseLocation).where(WarehouseLocation.code == code))
    loc = result.scalar_one_or_none()
    if loc is None:
        raise NotFoundError(f"Location '{code}' not found")
    return loc


async def create_location(db: AsyncSession, data: dict) -> WarehouseLocation:
    code = _build_code(data["zone"], data["aisle"], data["shelf"], data.get("position", "01"))
    data["code"] = code

    existing = await db.execute(
        select(WarehouseLocation).where(WarehouseLocation.code == code)
    )
    if existing.scalar_one_or_none():
        raise ConflictError(f"Ya existe una ubicación con código '{code}'")

    loc = WarehouseLocation(**data)
    db.add(loc)
    await db.flush()
    await db.refresh(loc)
    return loc


async def update_location(db: AsyncSession, location_id: int, data: dict) -> WarehouseLocation:
    loc = await get_location(db, location_id)
    for key, value in data.items():
        if value is not None:
            setattr(loc, key, value)
    await db.flush()
    await db.refresh(loc)
    return loc


async def delete_location(db: AsyncSession, location_id: int) -> None:
    from app.stock.models import Stock
    loc = await get_location(db, location_id)
    # Check if location has stock entries
    stock_check = await db.execute(
        select(func.count(Stock.id)).where(Stock.location_id == location_id)
    )
    if stock_check.scalar_one() > 0:
        raise BadRequestError("No se puede eliminar una ubicación con stock asociado")
    await db.delete(loc)
    await db.flush()
