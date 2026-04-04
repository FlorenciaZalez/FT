from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_admin
from app.auth.models import User
from app.database import get_db
from app.shipping import service
from app.shipping.schemas import (
    HandlingRateCreate,
    HandlingRateResponse,
    HandlingRateUpdate,
    PostalCodeRangeCreate,
    PostalCodeRangeResponse,
    PostalCodeRangeUpdate,
    ShippingRateCreate,
    ShippingRateResponse,
    ShippingRateUpdate,
)

router = APIRouter(prefix="/shipping", tags=["Shipping"])


@router.get("/postal-code-ranges", response_model=list[PostalCodeRangeResponse])
async def list_postal_code_ranges(
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_postal_code_ranges(db)


@router.post("/postal-code-ranges", response_model=PostalCodeRangeResponse, status_code=201)
async def create_postal_code_range(
    body: PostalCodeRangeCreate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_postal_code_range(db, body.dict())


@router.put("/postal-code-ranges/{range_id}", response_model=PostalCodeRangeResponse)
async def update_postal_code_range(
    range_id: int,
    body: PostalCodeRangeUpdate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_postal_code_range(db, range_id, body.dict(exclude_unset=True))


@router.delete("/postal-code-ranges/{range_id}", status_code=204)
async def delete_postal_code_range(
    range_id: int,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_postal_code_range(db, range_id)


@router.get("/rates", response_model=list[ShippingRateResponse])
async def list_shipping_rates(
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_shipping_rates(db)


@router.post("/rates", response_model=ShippingRateResponse, status_code=201)
async def create_shipping_rate(
    body: ShippingRateCreate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_shipping_rate(db, body.dict())


@router.put("/rates/{rate_id}", response_model=ShippingRateResponse)
async def update_shipping_rate(
    rate_id: int,
    body: ShippingRateUpdate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_shipping_rate(db, rate_id, body.dict(exclude_unset=True))


@router.delete("/rates/{rate_id}", status_code=204)
async def delete_shipping_rate(
    rate_id: int,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_shipping_rate(db, rate_id)


@router.get("/handling-rates", response_model=list[HandlingRateResponse])
async def list_handling_rates(
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_handling_rates(db)


@router.post("/handling-rates", response_model=HandlingRateResponse, status_code=201)
async def create_handling_rate(
    body: HandlingRateCreate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_handling_rate(db, body.dict())


@router.put("/handling-rates/{rate_id}", response_model=HandlingRateResponse)
async def update_handling_rate(
    rate_id: int,
    body: HandlingRateUpdate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_handling_rate(db, rate_id, body.dict(exclude_unset=True))


@router.delete("/handling-rates/{rate_id}", status_code=204)
async def delete_handling_rate(
    rate_id: int,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_handling_rate(db, rate_id)