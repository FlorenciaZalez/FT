from __future__ import annotations

import re
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.models import Client
from app.common.exceptions import BadRequestError, ConflictError, NotFoundError
from app.orders.models import Order, OrderItem
from app.products.models import Product, ProductWeightCategory
from app.shipping.models import HandlingRate, PostalCodeRange, ShippingCategory, ShippingCordon, ShippingRate

SHIPPING_STATUS_CALCULATED = "calculated"
SHIPPING_STATUS_ZONE_UNDEFINED = "zone_undefined"
SHIPPING_STATUS_RATE_UNDEFINED = "rate_undefined"


def _normalize_postal_code(postal_code: str | None) -> int | None:
    if not postal_code:
        return None
    digits = "".join(re.findall(r"\d+", postal_code))
    if not digits:
        return None
    return int(digits)


async def get_cordon_by_postal_code(db: AsyncSession, cp: int) -> ShippingCordon | None:
    result = await db.execute(
        select(PostalCodeRange.cordon)
        .where(PostalCodeRange.cp_from <= cp, PostalCodeRange.cp_to >= cp)
        .order_by(PostalCodeRange.cp_from.asc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_product_by_sku(db: AsyncSession, client_id: int, sku: str) -> Product | None:
    result = await db.execute(
        select(Product).where(Product.client_id == client_id, Product.sku == sku)
    )
    return result.scalar_one_or_none()


async def get_shipping_rate(
    db: AsyncSession,
    shipping_category: ShippingCategory,
    cordon: ShippingCordon,
) -> ShippingRate | None:
    result = await db.execute(
        select(ShippingRate)
        .where(ShippingRate.shipping_category == shipping_category, ShippingRate.cordon == cordon)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_handling_rate(
    db: AsyncSession,
    weight_category: ProductWeightCategory,
) -> HandlingRate | None:
    result = await db.execute(
        select(HandlingRate)
        .where(HandlingRate.weight_category == weight_category)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _resolve_order_weight_category(
    db: AsyncSession,
    items: Sequence[OrderItem],
    products_by_id: dict[int, Product] | None = None,
) -> ProductWeightCategory:
    resolved_category = ProductWeightCategory.simple
    for item in items:
        product = products_by_id.get(item.product_id) if products_by_id is not None else None
        if product is None:
            product = await db.get(Product, item.product_id)
        if product is None:
            raise NotFoundError(f"Product {item.product_id} not found")
        if product.weight_category == ProductWeightCategory.premium:
            return ProductWeightCategory.premium
        if product.weight_category == ProductWeightCategory.intermedio:
            resolved_category = ProductWeightCategory.intermedio
    return resolved_category


async def calculate_shipping(
    db: AsyncSession,
    order: Order,
    items: Sequence[OrderItem],
    products_by_id: dict[int, Product] | None = None,
) -> dict:
    normalized_cp = _normalize_postal_code(order.postal_code)
    if normalized_cp is None:
        order.cordon = None
        order.shipping_cost = None
        order.shipping_status = SHIPPING_STATUS_ZONE_UNDEFINED
        return {"status": SHIPPING_STATUS_ZONE_UNDEFINED, "cordon": None, "shipping_cost": None}

    cordon = await get_cordon_by_postal_code(db, normalized_cp)
    if cordon is None:
        order.cordon = None
        order.shipping_cost = None
        order.shipping_status = SHIPPING_STATUS_ZONE_UNDEFINED
        return {"status": SHIPPING_STATUS_ZONE_UNDEFINED, "cordon": None, "shipping_cost": None}

    client = await db.get(Client, order.client_id)
    shipping_category = client.shipping_category if client is not None else ShippingCategory.A

    shipping_rate = await get_shipping_rate(db, shipping_category, cordon)
    order.cordon = cordon.value
    if shipping_rate is None:
        order.shipping_cost = None
        order.shipping_status = SHIPPING_STATUS_RATE_UNDEFINED
        return {"status": SHIPPING_STATUS_RATE_UNDEFINED, "cordon": cordon.value, "shipping_cost": None}

    weight_category = await _resolve_order_weight_category(db, items, products_by_id)
    handling_rate = await get_handling_rate(db, weight_category)
    if handling_rate is None:
        order.shipping_cost = None
        order.shipping_status = SHIPPING_STATUS_RATE_UNDEFINED
        return {"status": SHIPPING_STATUS_RATE_UNDEFINED, "cordon": cordon.value, "shipping_cost": None}

    total_cost = float(shipping_rate.price) + float(handling_rate.price)
    order.shipping_cost = total_cost
    order.shipping_status = SHIPPING_STATUS_CALCULATED
    return {"status": SHIPPING_STATUS_CALCULATED, "cordon": cordon.value, "shipping_cost": total_cost}


async def list_postal_code_ranges(db: AsyncSession) -> list[PostalCodeRange]:
    result = await db.execute(select(PostalCodeRange).order_by(PostalCodeRange.cp_from.asc(), PostalCodeRange.cp_to.asc()))
    return list(result.scalars().all())


async def create_postal_code_range(db: AsyncSession, data: dict) -> PostalCodeRange:
    if data["cp_from"] > data["cp_to"]:
        raise BadRequestError("cp_from no puede ser mayor que cp_to")
    existing = await db.execute(
        select(PostalCodeRange).where(
            PostalCodeRange.cp_from == data["cp_from"],
            PostalCodeRange.cp_to == data["cp_to"],
            PostalCodeRange.cordon == data["cordon"],
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise ConflictError("Ya existe ese rango postal para el cordón indicado")
    item = PostalCodeRange(**data)
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return item


async def update_postal_code_range(db: AsyncSession, range_id: int, data: dict) -> PostalCodeRange:
    item = await db.get(PostalCodeRange, range_id)
    if item is None:
        raise NotFoundError(f"Postal code range {range_id} not found")
    next_cp_from = data.get("cp_from", item.cp_from)
    next_cp_to = data.get("cp_to", item.cp_to)
    if next_cp_from > next_cp_to:
        raise BadRequestError("cp_from no puede ser mayor que cp_to")
    for key, value in data.items():
        setattr(item, key, value)
    await db.flush()
    await db.refresh(item)
    return item


async def delete_postal_code_range(db: AsyncSession, range_id: int) -> None:
    item = await db.get(PostalCodeRange, range_id)
    if item is None:
        raise NotFoundError(f"Postal code range {range_id} not found")
    await db.delete(item)
    await db.flush()


async def list_shipping_rates(db: AsyncSession) -> list[ShippingRate]:
    result = await db.execute(select(ShippingRate).order_by(ShippingRate.shipping_category.asc(), ShippingRate.cordon.asc()))
    return list(result.scalars().all())


async def create_shipping_rate(db: AsyncSession, data: dict) -> ShippingRate:
    existing = await db.execute(
        select(ShippingRate).where(
            ShippingRate.shipping_category == data["shipping_category"],
            ShippingRate.cordon == data["cordon"],
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise ConflictError("Ya existe una tarifa de envío para esa categoría y cordón")
    item = ShippingRate(**data)
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return item


async def update_shipping_rate(db: AsyncSession, rate_id: int, data: dict) -> ShippingRate:
    item = await db.get(ShippingRate, rate_id)
    if item is None:
        raise NotFoundError(f"Shipping rate {rate_id} not found")
    next_category = data.get("shipping_category", item.shipping_category)
    next_cordon = data.get("cordon", item.cordon)
    existing = await db.execute(
        select(ShippingRate).where(
            ShippingRate.shipping_category == next_category,
            ShippingRate.cordon == next_cordon,
            ShippingRate.id != rate_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise ConflictError("Ya existe una tarifa de envío para esa categoría y cordón")
    for key, value in data.items():
        setattr(item, key, value)
    await db.flush()
    await db.refresh(item)
    return item


async def delete_shipping_rate(db: AsyncSession, rate_id: int) -> None:
    item = await db.get(ShippingRate, rate_id)
    if item is None:
        raise NotFoundError(f"Shipping rate {rate_id} not found")
    await db.delete(item)
    await db.flush()


async def list_handling_rates(db: AsyncSession) -> list[HandlingRate]:
    result = await db.execute(select(HandlingRate).order_by(HandlingRate.weight_category.asc()))
    return list(result.scalars().all())


async def create_handling_rate(db: AsyncSession, data: dict) -> HandlingRate:
    existing = await db.execute(
        select(HandlingRate).where(HandlingRate.weight_category == data["weight_category"])
    )
    if existing.scalar_one_or_none() is not None:
        raise ConflictError("Ya existe una tarifa de preparación para esa categoría de peso")
    item = HandlingRate(**data)
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return item


async def update_handling_rate(db: AsyncSession, rate_id: int, data: dict) -> HandlingRate:
    item = await db.get(HandlingRate, rate_id)
    if item is None:
        raise NotFoundError(f"Handling rate {rate_id} not found")
    next_weight_category = data.get("weight_category", item.weight_category)
    existing = await db.execute(
        select(HandlingRate).where(
            HandlingRate.weight_category == next_weight_category,
            HandlingRate.id != rate_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise ConflictError("Ya existe una tarifa de preparación para esa categoría de peso")
    for key, value in data.items():
        setattr(item, key, value)
    await db.flush()
    await db.refresh(item)
    return item


async def delete_handling_rate(db: AsyncSession, rate_id: int) -> None:
    item = await db.get(HandlingRate, rate_id)
    if item is None:
        raise NotFoundError(f"Handling rate {rate_id} not found")
    await db.delete(item)
    await db.flush()