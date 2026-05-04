from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.products.models import Product, ProductWeightCategory
from app.stock.models import Stock
from app.orders.models import OrderItem
from app.locations.models import WarehouseLocation
from app.auth.models import User
from app.common.exceptions import NotFoundError, ConflictError, BadRequestError
from app.common.permissions import tenant_filter, check_tenant_access
from app.integrations.mercadolibre import service as mercadolibre_service
from app.integrations.mercadolibre.models import MLProductMapping


_ML_REFERENCE_UNSET = object()
_PREPARATION_TYPE_UNSET = object()
_DIMENSION_FIELDS = ("width_cm", "height_cm", "depth_cm")


def _map_preparation_type_to_weight_category(preparation_type: str) -> ProductWeightCategory:
    return ProductWeightCategory.heavy if preparation_type == "especial" else ProductWeightCategory.light


def _map_weight_category_to_preparation_type(weight_category: ProductWeightCategory) -> str:
    return "especial" if weight_category == ProductWeightCategory.heavy else "simple"


def _normalize_product_weight_category(
    data: dict,
    current_weight_category: ProductWeightCategory | None = None,
    current_preparation_type: str | None = None,
) -> None:
    preparation_type = data.pop("preparation_type", _PREPARATION_TYPE_UNSET)
    if preparation_type is not _PREPARATION_TYPE_UNSET and preparation_type is not None:
        data["preparation_type"] = preparation_type
        data["weight_category"] = _map_preparation_type_to_weight_category(preparation_type)
        return

    if "weight_category" in data and data["weight_category"] is not None:
        data["preparation_type"] = _map_weight_category_to_preparation_type(data["weight_category"])
        return

    if current_weight_category is not None:
        data["weight_category"] = current_weight_category

    if current_preparation_type is not None:
        data["preparation_type"] = current_preparation_type
    elif current_weight_category is not None:
        data["preparation_type"] = _map_weight_category_to_preparation_type(current_weight_category)


def _normalize_product_volume(data: dict, current_product: Product | None = None) -> None:
    resolved_dimensions: dict[str, float | None] = {}
    for field in _DIMENSION_FIELDS:
        raw_value = data.get(field, getattr(current_product, field, None) if current_product else None)
        if raw_value in ("", None):
            resolved_dimensions[field] = None
            if field in data and data[field] == "":
                data[field] = None
            continue
        try:
            normalized_value = float(raw_value)
        except (TypeError, ValueError) as exc:
            raise BadRequestError("Las medidas del producto deben ser numéricas") from exc
        if normalized_value <= 0:
            raise BadRequestError("Las medidas del producto deben ser mayores a 0")
        resolved_dimensions[field] = normalized_value
        if field in data:
            data[field] = normalized_value

    if all(resolved_dimensions[field] is not None for field in _DIMENSION_FIELDS):
        width = Decimal(str(resolved_dimensions["width_cm"]))
        height = Decimal(str(resolved_dimensions["height_cm"]))
        depth = Decimal(str(resolved_dimensions["depth_cm"]))
        data["volume_m3"] = float((width * height * depth / Decimal("1000000")).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))
    elif any(field in data for field in _DIMENSION_FIELDS):
        data["volume_m3"] = None


def _product_with_relations() -> select:
    return select(Product).options(
        selectinload(Product.client),
        selectinload(Product.location),
        selectinload(Product.ml_mappings),
    )


async def _load_direct_ml_mappings(db: AsyncSession, product_id: int) -> list[MLProductMapping]:
    result = await db.execute(
        select(MLProductMapping).where(
            MLProductMapping.product_id == product_id,
            MLProductMapping.ml_variation_id.is_(None),
        )
    )
    return result.scalars().all()


async def _sync_direct_ml_mappings(
    db: AsyncSession,
    user: User,
    product: Product,
    ml_item_reference: str | None,
) -> None:
    direct_mappings = await _load_direct_ml_mappings(db, product.id)
    normalized_item_ids = mercadolibre_service.normalize_ml_item_ids(ml_item_reference)
    desired_item_ids = set(normalized_item_ids)
    current_by_item_id = {mapping.ml_item_id: mapping for mapping in direct_mappings}

    for mapping in direct_mappings:
        if mapping.ml_item_id in desired_item_ids:
            mapping.is_active = True
            mapping.ml_account_id = None
        else:
            await db.delete(mapping)

    for ml_item_id in normalized_item_ids:
        if ml_item_id in current_by_item_id:
            continue
        await mercadolibre_service.create_mapping(
            db,
            user,
            {
                "client_id": product.client_id,
                "product_id": product.id,
                "ml_item_id": ml_item_id,
                "ml_variation_id": None,
                "ml_account_id": None,
            },
        )

    await db.flush()


async def _validate_location(db: AsyncSession, location_id: int | None) -> None:
    """Ensure location_id references an existing location."""
    if location_id is None:
        return
    loc = await db.get(WarehouseLocation, location_id)
    if loc is None:
        raise BadRequestError(f"La ubicación con id {location_id} no existe")


async def list_products(
    db: AsyncSession, user: User, skip: int = 0, limit: int = 50
) -> tuple[list[Product], int]:
    base = select(Product)
    base = tenant_filter(base, Product, user)
    data_query = tenant_filter(_product_with_relations(), Product, user)

    count_q = await db.execute(select(func.count()).select_from(base.subquery()))
    total = count_q.scalar_one()

    result = await db.execute(
        data_query.order_by(Product.id).offset(skip).limit(limit)
    )
    return result.scalars().all(), total


async def get_product(db: AsyncSession, product_id: int, user: User) -> Product:
    result = await db.execute(_product_with_relations().where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if product is None:
        raise NotFoundError(f"Product {product_id} not found")
    check_tenant_access(user, product.client_id)
    return product


async def create_product(db: AsyncSession, user: User, data: dict) -> Product:
    client_id = data.pop("client_id", None) or user.client_id
    ml_item_reference = data.pop("ml_item_reference", None)
    if client_id is None:
        raise BadRequestError("client_id is required")

    check_tenant_access(user, client_id)
    await _validate_location(db, data.get("location_id"))
    _normalize_product_weight_category(data)
    _normalize_product_volume(data)

    # Check unique SKU per client
    existing = await db.execute(
        select(Product).where(Product.client_id == client_id, Product.sku == data["sku"])
    )
    existing_product = existing.scalar_one_or_none()
    if existing_product is not None:
        if existing_product.is_active:
            raise ConflictError(f"SKU '{data['sku']}' already exists for this client")

        for key, value in data.items():
            if key == "location_id" or value is not None:
                setattr(existing_product, key, value)
        existing_product.is_active = True
        product = existing_product
    else:
        product = Product(client_id=client_id, **data)
        db.add(product)

    await db.flush()
    if not product.alta_cobrada:
        from app.billing.service import record_product_created

        await record_product_created(db, product)
        product.alta_cobrada = True
        await db.flush()

    await _sync_direct_ml_mappings(db, user, product, ml_item_reference)

    await db.refresh(product)
    return await get_product(db, product.id, user)


async def update_product(db: AsyncSession, product_id: int, user: User, data: dict) -> Product:
    product = await get_product(db, product_id, user)
    ml_item_reference = data.pop("ml_item_reference", _ML_REFERENCE_UNSET)
    _normalize_product_weight_category(data, product.weight_category, getattr(product, "preparation_type", None))
    _normalize_product_volume(data, product)
    if "sku" in data and data["sku"] is not None and data["sku"] != product.sku:
        existing = await db.execute(
            select(Product).where(
                Product.client_id == product.client_id,
                Product.sku == data["sku"],
                Product.id != product.id,
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError(f"SKU '{data['sku']}' already exists for this client")
    if "location_id" in data:
        await _validate_location(db, data["location_id"])
    for key, value in data.items():
        if key == "location_id" or value is not None:
            setattr(product, key, value)
    await db.flush()

    if ml_item_reference is not _ML_REFERENCE_UNSET:
        await _sync_direct_ml_mappings(db, user, product, ml_item_reference)

    await db.refresh(product)
    return await get_product(db, product.id, user)


async def delete_product(db: AsyncSession, product_id: int, user: User) -> None:
    product = await get_product(db, product_id, user)

    stock_count = (await db.execute(
        select(func.count(Stock.id)).where(Stock.product_id == product_id)
    )).scalar_one()

    order_count = (await db.execute(
        select(func.count(OrderItem.id)).where(OrderItem.product_id == product_id)
    )).scalar_one()

    if stock_count > 0 or order_count > 0:
        raise ConflictError(
            "No se puede eliminar este producto porque tiene stock o pedidos asociados"
        )

    await db.delete(product)
    await db.flush()


async def record_first_label_print(db: AsyncSession, product_id: int, user: User) -> bool:
    product = await get_product(db, product_id, user)

    from app.billing.service import record_product_first_label_print

    return await record_product_first_label_print(db, product)
