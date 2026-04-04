from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import require_operator
from app.auth.models import User
from app.locations import service
from app.locations.schemas import LocationCreate, LocationUpdate, LocationResponse

router = APIRouter(prefix="/locations", tags=["Locations"])


@router.get("", response_model=list[LocationResponse])
async def list_locations(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    zone: str | None = None,
    aisle: str | None = None,
    search: str | None = None,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    locations, total = await service.list_locations(db, skip, limit, zone, aisle, search)
    return locations


@router.get("/zones", response_model=list[str])
async def list_zones(
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_zones(db)


@router.post("", response_model=LocationResponse, status_code=201)
async def create_location(
    body: LocationCreate,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_location(db, body.dict())


@router.get("/{location_id}", response_model=LocationResponse)
async def get_location(
    location_id: int,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_location(db, location_id)


@router.put("/{location_id}", response_model=LocationResponse)
async def update_location(
    location_id: int,
    body: LocationUpdate,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_location(db, location_id, body.dict(exclude_unset=True))


@router.delete("/{location_id}", status_code=204)
async def delete_location(
    location_id: int,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_location(db, location_id)
