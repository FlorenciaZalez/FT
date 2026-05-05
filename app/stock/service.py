from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.stock.models import Stock
from app.stock.movement_models import StockMovement, MovementType, ReferenceType
from app.products.models import Product
from app.clients.models import Client
from app.locations.models import WarehouseLocation
from app.auth.models import User
from app.common.exceptions import NotFoundError, BadRequestError, InsufficientStockError
from app.common.permissions import tenant_filter, check_tenant_access
from app.alerts.service import check_stock_after_change


DEFAULT_LOW_STOCK_THRESHOLD = 10


# ──────────────────────────────────────────────
#  HELPERS
# ──────────────────────────────────────────────

async def _get_default_location(db: AsyncSession) -> WarehouseLocation:
    """Get or create a default warehouse location for simplified operations."""
    result = await db.execute(
        select(WarehouseLocation).where(WarehouseLocation.code == "DEFAULT")
    )
    location = result.scalar_one_or_none()
    if location is None:
        location = WarehouseLocation(
            code="DEFAULT", zone="A", aisle="0", shelf="0",
            description="Ubicación por defecto",
        )
        db.add(location)
        await db.flush()
    return location


# ──────────────────────────────────────────────
#  HELPERS
# ──────────────────────────────────────────────

async def _get_or_create_stock(
    db: AsyncSession, client_id: int, product_id: int, location_id: int
) -> Stock:
    result = await db.execute(
        select(Stock).where(
            Stock.client_id == client_id,
            Stock.product_id == product_id,
            Stock.location_id == location_id,
        )
    )
    stock = result.scalar_one_or_none()
    if stock is None:
        stock = Stock(
            client_id=client_id,
            product_id=product_id,
            location_id=location_id,
            quantity_total=0,
            quantity_reserved=0,
            min_stock_alert=DEFAULT_LOW_STOCK_THRESHOLD,
        )
        db.add(stock)
        await db.flush()
    return stock


async def _record_movement(
    db: AsyncSession,
    client_id: int,
    product_id: int,
    movement_type: MovementType,
    quantity: int,
    reference_type: ReferenceType,
    reference_id: int | None = None,
    user_id: int | None = None,
    notes: str | None = None,
) -> StockMovement:
    movement = StockMovement(
        client_id=client_id,
        product_id=product_id,
        movement_type=movement_type,
        quantity=quantity,
        reference_type=reference_type,
        reference_id=reference_id,
        performed_by=user_id,
        notes=notes,
    )
    db.add(movement)
    return movement


def _product_has_resolvable_storage_volume(product: Product) -> bool:
    if product.volume_m3 is not None and Decimal(str(product.volume_m3)) > Decimal("0"):
        return True

    dimensions = (product.width_cm, product.height_cm, product.depth_cm)
    if any(value is None for value in dimensions):
        return False

    return all(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) > Decimal("0.00") for value in dimensions)


def _ensure_product_storage_volume(product: Product) -> None:
    if _product_has_resolvable_storage_volume(product):
        return
    raise BadRequestError(
        "El producto no tiene m3 ni medidas completas. Cargá ancho, alto y profundidad antes de ingresar stock para que el storage se facture correctamente."
    )


# ──────────────────────────────────────────────
#  INBOUND (Ingreso de mercadería)
# ──────────────────────────────────────────────

async def inbound_stock(
    db: AsyncSession, user: User, product_id: int, location_id: int, quantity: int, notes: str | None = None,
) -> Stock:
    if quantity <= 0:
        raise BadRequestError("Quantity must be positive")

    # Validate product belongs to user's tenant
    product = await db.get(Product, product_id)
    if product is None:
        raise NotFoundError(f"Product {product_id} not found")
    check_tenant_access(user, product.client_id)
    _ensure_product_storage_volume(product)

    stock = await _get_or_create_stock(db, product.client_id, product_id, location_id)
    stock.quantity_total += quantity

    await _record_movement(
        db, product.client_id, product_id,
        MovementType.inbound, quantity,
        ReferenceType.inbound, user_id=user.id, notes=notes,
    )

    await db.flush()
    await db.refresh(stock)
    await check_stock_after_change(db, product.client_id, product_id)
    return stock


# ──────────────────────────────────────────────
#  ADJUST (Ajuste manual / inventario)
# ──────────────────────────────────────────────

async def adjust_stock(
    db: AsyncSession, user: User, product_id: int, location_id: int, new_quantity: int, notes: str | None = None,
) -> Stock:
    if new_quantity < 0:
        raise BadRequestError("Quantity cannot be negative")

    product = await db.get(Product, product_id)
    if product is None:
        raise NotFoundError(f"Product {product_id} not found")
    check_tenant_access(user, product.client_id)

    stock = await _get_or_create_stock(db, product.client_id, product_id, location_id)
    if new_quantity < stock.quantity_reserved:
        raise BadRequestError(
            f"Cannot set total to {new_quantity}, there are {stock.quantity_reserved} units reserved"
        )

    diff = new_quantity - stock.quantity_total
    if diff > 0:
        _ensure_product_storage_volume(product)
    stock.quantity_total = new_quantity

    await _record_movement(
        db, product.client_id, product_id,
        MovementType.adjustment, diff,
        ReferenceType.adjustment, user_id=user.id, notes=notes,
    )

    await db.flush()
    await db.refresh(stock)
    await check_stock_after_change(db, product.client_id, product_id)
    return stock


# ──────────────────────────────────────────────
#  RESERVE (Reservar stock para un pedido)
# ──────────────────────────────────────────────

async def reserve_stock(
    db: AsyncSession, client_id: int, product_id: int, quantity: int, order_id: int, user_id: int | None = None,
) -> Stock:
    """Called internally when creating an order."""
    result = await db.execute(
        select(Stock).where(
            Stock.client_id == client_id,
            Stock.product_id == product_id,
        )
    )
    stock = result.scalar_one_or_none()
    if stock is None:
        raise InsufficientStockError("???", 0, quantity)

    available = stock.quantity_total - stock.quantity_reserved
    if available < quantity:
        product = await db.get(Product, product_id)
        raise InsufficientStockError(product.sku if product else "???", available, quantity)

    stock.quantity_reserved += quantity

    await _record_movement(
        db, client_id, product_id,
        MovementType.reservation, quantity,
        ReferenceType.order, reference_id=order_id, user_id=user_id,
    )

    await db.flush()
    await check_stock_after_change(db, client_id, product_id)
    return stock


# ──────────────────────────────────────────────
#  RELEASE (Liberar reserva — cancelación)
# ──────────────────────────────────────────────

async def release_stock(
    db: AsyncSession, client_id: int, product_id: int, quantity: int, order_id: int, user_id: int | None = None,
) -> Stock:
    """Called internally when cancelling an order."""
    result = await db.execute(
        select(Stock).where(
            Stock.client_id == client_id,
            Stock.product_id == product_id,
        )
    )
    stock = result.scalar_one_or_none()
    if stock is None:
        raise NotFoundError("Stock entry not found")

    stock.quantity_reserved = max(0, stock.quantity_reserved - quantity)

    await _record_movement(
        db, client_id, product_id,
        MovementType.reservation_release, -quantity,
        ReferenceType.order, reference_id=order_id, user_id=user_id,
    )

    await db.flush()
    await check_stock_after_change(db, client_id, product_id)
    return stock


# ──────────────────────────────────────────────
#  DISPATCH (Descontar stock — despacho)
# ──────────────────────────────────────────────

async def dispatch_stock(
    db: AsyncSession, client_id: int, product_id: int, quantity: int, order_id: int, user_id: int | None = None,
) -> Stock:
    """Called internally when dispatching an order."""
    result = await db.execute(
        select(Stock).where(
            Stock.client_id == client_id,
            Stock.product_id == product_id,
        )
    )
    stock = result.scalar_one_or_none()
    if stock is None:
        raise NotFoundError("Stock entry not found")

    stock.quantity_total -= quantity
    stock.quantity_reserved = max(0, stock.quantity_reserved - quantity)

    await _record_movement(
        db, client_id, product_id,
        MovementType.outbound, -quantity,
        ReferenceType.order, reference_id=order_id, user_id=user_id,
    )

    await db.flush()
    await check_stock_after_change(db, client_id, product_id)
    return stock


# ──────────────────────────────────────────────
#  QUERIES
# ──────────────────────────────────────────────

async def get_stock_summary(
    db: AsyncSession, user: User, skip: int = 0, limit: int = 50,
) -> list[dict]:
    query = (
        select(
            Stock.product_id,
            Product.name.label("product_name"),
            Product.sku,
            WarehouseLocation.code.label("location_code"),
            Stock.quantity_total,
            Stock.quantity_reserved,
            Stock.quantity_available,
            Stock.min_stock_alert,
        )
        .join(Product, Stock.product_id == Product.id)
        .join(WarehouseLocation, Stock.location_id == WarehouseLocation.id)
    )
    query = tenant_filter(query, Stock, user)
    query = query.order_by(Product.sku).offset(skip).limit(limit)

    result = await db.execute(query)
    rows = result.all()
    return [row._asdict() for row in rows]


async def get_movements(
    db: AsyncSession, user: User, product_id: int | None = None, skip: int = 0, limit: int = 50,
) -> list[dict]:
    query = (
        select(StockMovement)
        .options(joinedload(StockMovement.user))
    )
    query = tenant_filter(query, StockMovement, user)
    if product_id:
        query = query.where(StockMovement.product_id == product_id)
    query = query.order_by(StockMovement.created_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    movements = result.scalars().unique().all()
    return [
        {
            "id": m.id,
            "client_id": m.client_id,
            "product_id": m.product_id,
            "movement_type": m.movement_type.value if hasattr(m.movement_type, 'value') else m.movement_type,
            "quantity": m.quantity,
            "reference_type": m.reference_type.value if hasattr(m.reference_type, 'value') else m.reference_type,
            "reference_id": m.reference_id,
            "performed_by": m.performed_by,
            "performed_by_name": m.user.full_name if m.user else None,
            "notes": m.notes,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in movements
    ]


# ──────────────────────────────────────────────
#  SIMPLIFIED ENDPOINTS (frontend stock page)
# ──────────────────────────────────────────────

async def get_stock_list(
    db: AsyncSession,
    user: User,
    *,
    search: str | None = None,
    client_id: int | None = None,
    status: str | None = None,
) -> list[dict]:
    """Aggregated stock per product (across all locations)."""
    quantity_total_expr = func.coalesce(func.sum(Stock.quantity_total), 0)
    quantity_reserved_expr = func.coalesce(func.sum(Stock.quantity_reserved), 0)
    quantity_available_expr = quantity_total_expr - quantity_reserved_expr
    min_stock_alert_expr = func.greatest(
        func.coalesce(func.max(Stock.min_stock_alert), 0),
        DEFAULT_LOW_STOCK_THRESHOLD,
    )

    query = (
        select(
            Product.id.label("product_id"),
            Product.name.label("product_name"),
            Product.sku,
            Product.client_id,
            Client.name.label("client_name"),
            quantity_total_expr.label("quantity"),
            quantity_total_expr.label("quantity_total"),
            quantity_reserved_expr.label("quantity_reserved"),
            quantity_available_expr.label("quantity_available"),
            min_stock_alert_expr.label("min_stock_alert"),
        )
        .outerjoin(Stock, Stock.product_id == Product.id)
        .join(Client, Product.client_id == Client.id)
        .where(Product.is_active == True)
        .group_by(Product.id, Product.name, Product.sku, Product.client_id, Client.name)
    )
    query = tenant_filter(query, Product, user)

    normalized_search = search.strip() if search else ""
    if normalized_search:
        pattern = f"%{normalized_search}%"
        query = query.where(
            or_(
                Product.sku.ilike(pattern),
                Product.name.ilike(pattern),
            )
        )

    if client_id is not None:
        query = query.where(Product.client_id == client_id)

    if status == "available":
        query = query.having(quantity_available_expr > 0)
    elif status == "out_of_stock":
        query = query.having(quantity_available_expr <= 0)
    elif status == "low_stock":
        query = query.having(quantity_available_expr > 0).having(quantity_available_expr <= min_stock_alert_expr)

    query = query.order_by(Product.name)

    result = await db.execute(query)
    return [row._asdict() for row in result.all()]


async def simple_inbound(
    db: AsyncSession, user: User, product_id: int, quantity: int, reason: str | None = None,
) -> dict:
    """Simplified stock inbound using default location."""
    if quantity <= 0:
        raise BadRequestError("La cantidad debe ser positiva")

    product = await db.get(Product, product_id)
    if product is None:
        raise NotFoundError(f"Producto {product_id} no encontrado")
    check_tenant_access(user, product.client_id)
    _ensure_product_storage_volume(product)

    location = await _get_default_location(db)
    stock = await _get_or_create_stock(db, product.client_id, product_id, location.id)
    stock.quantity_total += quantity

    await _record_movement(
        db, product.client_id, product_id,
        MovementType.inbound, quantity,
        ReferenceType.inbound, user_id=user.id, notes=reason,
    )

    await db.flush()
    await db.refresh(stock)
    await check_stock_after_change(db, product.client_id, product_id)
    return {
        "product_id": product_id,
        "product_name": product.name,
        "sku": product.sku,
        "new_quantity": stock.quantity_total,
    }


async def simple_outbound(
    db: AsyncSession, user: User, product_id: int, quantity: int, reason: str | None = None,
) -> dict:
    """Simplified stock outbound (egress) using default location."""
    if quantity <= 0:
        raise BadRequestError("La cantidad debe ser positiva")

    product = await db.get(Product, product_id)
    if product is None:
        raise NotFoundError(f"Producto {product_id} no encontrado")
    check_tenant_access(user, product.client_id)

    location = await _get_default_location(db)

    result = await db.execute(
        select(Stock).where(
            Stock.client_id == product.client_id,
            Stock.product_id == product_id,
            Stock.location_id == location.id,
        )
    )
    stock = result.scalar_one_or_none()

    available = stock.quantity_total - stock.quantity_reserved if stock else 0
    if available < quantity:
        raise InsufficientStockError(product.sku, available, quantity)

    stock.quantity_total -= quantity

    await _record_movement(
        db, product.client_id, product_id,
        MovementType.outbound, -quantity,
        ReferenceType.manual, user_id=user.id, notes=reason,
    )

    await db.flush()
    await db.refresh(stock)
    await check_stock_after_change(db, product.client_id, product_id)
    return {
        "product_id": product_id,
        "product_name": product.name,
        "sku": product.sku,
        "new_quantity": stock.quantity_total,
    }
