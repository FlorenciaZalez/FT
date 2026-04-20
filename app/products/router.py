from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import get_current_user, require_any
from app.auth.models import User
from app.products import service
from app.products.schemas import ProductCreate, ProductUpdate, ProductResponse


def _get_preparation_type(product) -> str:
    preparation_type = getattr(product, "preparation_type", None)
    if preparation_type in {"simple", "especial"}:
        return preparation_type
    return "especial" if getattr(product, "weight_category", None) == "heavy" else "simple"

router = APIRouter(prefix="/products", tags=["Products"])


def _enrich(product) -> dict:
    """Add computed fields used by the products UI."""
    data = {c.key: getattr(product, c.key) for c in product.__table__.columns}
    direct_ml_mappings = [
        mapping for mapping in product.ml_mappings if mapping.is_active and mapping.ml_variation_id is None
    ]
    ml_item_ids = sorted({mapping.ml_item_id for mapping in direct_ml_mappings})
    data["has_ml_mapping"] = bool(ml_item_ids)
    data["ml_item_id"] = ml_item_ids[0] if ml_item_ids else None
    data["ml_item_ids"] = ml_item_ids
    data["client_name"] = product.client.name if getattr(product, "client", None) else None
    data["location_code"] = product.location.code if product.location else None
    data["preparation_type"] = _get_preparation_type(product)
    return data


@router.get("", response_model=list[ProductResponse])
async def list_products(
    skip: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=5000),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    products, total = await service.list_products(db, user, skip, limit)
    return [_enrich(p) for p in products]


@router.post("", response_model=ProductResponse, status_code=201)
async def create_product(
    body: ProductCreate,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    product = await service.create_product(db, user, body.dict())
    return _enrich(product)


@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(
    product_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    product = await service.get_product(db, product_id, user)
    return _enrich(product)


@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int,
    body: ProductUpdate,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    product = await service.update_product(db, product_id, user, body.dict(exclude_unset=True))
    return _enrich(product)


@router.delete("/{product_id}", status_code=204)
async def delete_product(
    product_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_product(db, product_id, user)
