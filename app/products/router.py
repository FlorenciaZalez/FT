from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import require_any
from app.auth.models import User
from app.products import service
from app.products.schemas import ProductCreate, ProductUpdate, ProductResponse

router = APIRouter(prefix="/products", tags=["Products"])


@router.get("", response_model=list[ProductResponse])
async def list_products(
    skip: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=5000),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    products, total = await service.list_products(db, user, skip, limit)
    return products


@router.post("", response_model=ProductResponse, status_code=201)
async def create_product(
    body: ProductCreate,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_product(db, user, body.dict())


@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(
    product_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_product(db, product_id, user)


@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int,
    body: ProductUpdate,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_product(db, product_id, user, body.dict(exclude_unset=True))


@router.delete("/{product_id}", status_code=204)
async def delete_product(
    product_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_product(db, product_id, user)


@router.post("/{product_id}/record-first-label-print")
async def record_first_label_print(
    product_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    recorded = await service.record_first_label_print(db, product_id, user)
    return {"recorded": recorded}
