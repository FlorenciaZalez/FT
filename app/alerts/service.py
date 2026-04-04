import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.alerts.models import Alert, AlertType, AlertSeverity, AlertTargetRole
from app.stock.models import Stock
from app.products.models import Product
from app.orders.models import Order, OrderStatus
from app.auth.models import User, UserRole
from app.common.permissions import tenant_filter
from app.common.exceptions import NotFoundError

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────
#  CONFIGURATION
# ──────────────────────────────────────────────

PENDING_TIMEOUT_HOURS = 3        # pedido pendiente > 3 h
PREPARED_NOT_DISPATCHED_HOURS = 6  # preparado > 6 h sin despachar
DEFAULT_LOW_STOCK_THRESHOLD = 10


# ──────────────────────────────────────────────
#  EXTERNAL NOTIFICATIONS (extensible)
# ──────────────────────────────────────────────

async def send_external_alert(alert: Alert) -> None:
    """
    Stub for dispatching critical alerts to external channels
    (WhatsApp, email, Slack, etc.).
    Replace the body with a real integration when ready.
    """
    logger.warning(
        "[EXTERNAL ALERT] type=%s severity=%s message=%s",
        alert.alert_type.value,
        alert.severity.value,
        alert.message,
    )
    # TODO: integrate with Twilio/WhatsApp, SendGrid, Slack webhook, etc.
    # Example:
    # await whatsapp_client.send(to=ADMIN_PHONE, body=alert.message)


# ──────────────────────────────────────────────
#  HELPERS
# ──────────────────────────────────────────────

async def _active_alert_exists(
    db: AsyncSession,
    alert_type: AlertType,
    reference_type: str,
    reference_id: int,
) -> bool:
    """Check if an unresolved alert already exists for the same reference."""
    result = await db.execute(
        select(Alert.id).where(
            Alert.alert_type == alert_type,
            Alert.reference_type == reference_type,
            Alert.reference_id == reference_id,
            Alert.resolved_at.is_(None),
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


def _effective_min_stock_alert(stock: Stock) -> int:
    return stock.min_stock_alert if stock.min_stock_alert > 0 else DEFAULT_LOW_STOCK_THRESHOLD


def _role_filter(query, user: User):
    """
    Visibility rules:
    - admin → see all alerts
    - operator → see admin + operator targeted alerts
    - client → see only client-targeted alerts (+ tenant filter)
    """
    if user.role == UserRole.admin:
        return query
    if user.role == UserRole.operator:
        return query.where(
            Alert.target_role.in_([AlertTargetRole.admin, AlertTargetRole.operator])
        )
    # client
    return query.where(Alert.target_role == AlertTargetRole.client)


# ──────────────────────────────────────────────
#  CRUD
# ──────────────────────────────────────────────

async def create_alert(
    db: AsyncSession,
    client_id: int | None,
    alert_type: AlertType,
    severity: AlertSeverity,
    message: str,
    target_role: AlertTargetRole = AlertTargetRole.admin,
    reference_type: str | None = None,
    reference_id: int | None = None,
) -> Alert:
    alert = Alert(
        client_id=client_id,
        alert_type=alert_type,
        severity=severity,
        target_role=target_role,
        message=message,
        reference_type=reference_type,
        reference_id=reference_id,
    )
    db.add(alert)
    await db.flush()

    # Dispatch critical alerts to external channels
    if severity == AlertSeverity.critical:
        await send_external_alert(alert)

    return alert


async def list_alerts(
    db: AsyncSession,
    user: User,
    active_only: bool = True,
    is_read: bool | None = None,
    alert_type: str | None = None,
    severity: str | None = None,
    skip: int = 0,
    limit: int = 50,
) -> list[Alert]:
    query = select(Alert)
    query = tenant_filter(query, Alert, user)
    query = _role_filter(query, user)
    if active_only:
        query = query.where(Alert.resolved_at.is_(None))
    if is_read is not None:
        query = query.where(Alert.is_read == is_read)
    if alert_type is not None:
        query = query.where(Alert.alert_type == AlertType(alert_type))
    if severity is not None:
        query = query.where(Alert.severity == AlertSeverity(severity))
    query = query.order_by(Alert.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def count_active(db: AsyncSession, user: User) -> int:
    """Count unresolved alerts visible to this user."""
    query = select(func.count(Alert.id)).where(
        Alert.resolved_at.is_(None),
    )
    query = tenant_filter(query, Alert, user)
    query = _role_filter(query, user)
    result = await db.execute(query)
    return result.scalar_one()


async def mark_read(db: AsyncSession, alert_id: int) -> Alert:
    alert = await db.get(Alert, alert_id)
    if alert is None:
        raise NotFoundError(f"Alert {alert_id} not found")
    alert.is_read = True
    await db.flush()
    await db.refresh(alert)
    return alert


async def mark_all_read(db: AsyncSession, user: User) -> int:
    """Mark all visible unread alerts as read. Returns count affected."""
    # Build a subquery of IDs visible to this user
    sub = select(Alert.id).where(Alert.is_read.is_(False), Alert.resolved_at.is_(None))
    sub = tenant_filter(sub, Alert, user)
    sub = _role_filter(sub, user)

    stmt = update(Alert).where(Alert.id.in_(sub)).values(is_read=True)
    result = await db.execute(stmt)
    await db.flush()
    return result.rowcount  # type: ignore[return-value]


async def resolve_alert(db: AsyncSession, alert_id: int) -> Alert:
    alert = await db.get(Alert, alert_id)
    if alert is None:
        raise NotFoundError(f"Alert {alert_id} not found")
    alert.is_read = True
    alert.resolved_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(alert)
    return alert


# ──────────────────────────────────────────────
#  AUTO-CHECK: Stock bajo / sin stock
# ──────────────────────────────────────────────

async def check_low_stock_alerts(db: AsyncSession) -> list[Alert]:
    """Check all stock entries and create alerts for low/no stock (skip duplicates)."""
    result = await db.execute(
        select(Stock, Product)
        .join(Product, Stock.product_id == Product.id)
    )
    alerts: list[Alert] = []
    for stock, product in result.all():
        available = stock.quantity_total - stock.quantity_reserved
        threshold = _effective_min_stock_alert(stock)
        if available <= 0:
            if await _active_alert_exists(db, AlertType.no_stock, "product", product.id):
                continue
            alert = await create_alert(
                db, stock.client_id, AlertType.no_stock, AlertSeverity.critical,
                f"Sin stock: {product.sku} - {product.name}",
                target_role=AlertTargetRole.admin,
                reference_type="product", reference_id=product.id,
            )
            alerts.append(alert)
        elif available <= threshold:
            if await _active_alert_exists(db, AlertType.low_stock, "product", product.id):
                continue
            alert = await create_alert(
                db, stock.client_id, AlertType.low_stock, AlertSeverity.warning,
                f"Bajo stock de {product.name} (Solo {available} disponibles)",
                target_role=AlertTargetRole.admin,
                reference_type="product", reference_id=product.id,
            )
            alerts.append(alert)
    return alerts


# ──────────────────────────────────────────────
#  AUTO-CHECK: Pedidos retrasados (pendiente > 3 h)
# ──────────────────────────────────────────────

async def check_delayed_orders(db: AsyncSession) -> list[Alert]:
    """Create alerts for orders stuck in pending for too long."""
    threshold = datetime.now(timezone.utc) - timedelta(hours=PENDING_TIMEOUT_HOURS)
    result = await db.execute(
        select(Order).where(
            Order.status == OrderStatus.pending,
            Order.created_at < threshold,
        )
    )
    alerts: list[Alert] = []
    for order in result.scalars().all():
        if await _active_alert_exists(db, AlertType.pending_timeout, "order", order.id):
            continue
        alert = await create_alert(
            db, order.client_id, AlertType.pending_timeout, AlertSeverity.critical,
            f"Pedido sin preparar: {order.order_number} lleva más de {PENDING_TIMEOUT_HOURS}h en estado pendiente",
            target_role=AlertTargetRole.operator,
            reference_type="order", reference_id=order.id,
        )
        alerts.append(alert)
    return alerts


# ──────────────────────────────────────────────
#  AUTO-CHECK: Preparado sin despachar > 6 h
# ──────────────────────────────────────────────

async def check_prepared_not_dispatched(db: AsyncSession) -> list[Alert]:
    """Create alerts for orders prepared but not dispatched within threshold."""
    threshold = datetime.now(timezone.utc) - timedelta(hours=PREPARED_NOT_DISPATCHED_HOURS)
    result = await db.execute(
        select(Order).where(
            Order.status == OrderStatus.prepared,
            Order.packed_at < threshold,
        )
    )
    alerts: list[Alert] = []
    for order in result.scalars().all():
        if await _active_alert_exists(db, AlertType.prepared_not_dispatched, "order", order.id):
            continue
        alert = await create_alert(
            db, order.client_id, AlertType.prepared_not_dispatched, AlertSeverity.warning,
            f"Pedido preparado sin despachar: {order.order_number} lleva más de {PREPARED_NOT_DISPATCHED_HOURS}h listo",
            target_role=AlertTargetRole.operator,
            reference_type="order", reference_id=order.id,
        )
        alerts.append(alert)
    return alerts


# ──────────────────────────────────────────────
#  RUN ALL CHECKS
# ──────────────────────────────────────────────

async def run_all_checks(db: AsyncSession) -> list[Alert]:
    """Run all automatic alert checks."""
    alerts: list[Alert] = []
    alerts.extend(await check_low_stock_alerts(db))
    alerts.extend(await check_delayed_orders(db))
    alerts.extend(await check_prepared_not_dispatched(db))
    return alerts


# ──────────────────────────────────────────────
#  INLINE TRIGGERS (called from other services)
# ──────────────────────────────────────────────

async def check_stock_after_change(
    db: AsyncSession, client_id: int, product_id: int,
) -> None:
    """Called after any stock change to create/auto-resolve alerts."""
    result = await db.execute(
        select(Stock, Product)
        .join(Product, Stock.product_id == Product.id)
        .where(Stock.product_id == product_id, Stock.client_id == client_id)
    )
    row = result.first()
    if row is None:
        return
    stock, product = row
    available = stock.quantity_total - stock.quantity_reserved
    threshold = _effective_min_stock_alert(stock)

    if available <= 0:
        if not await _active_alert_exists(db, AlertType.no_stock, "product", product.id):
            await create_alert(
                db, client_id, AlertType.no_stock, AlertSeverity.critical,
                f"Sin stock: {product.sku} - {product.name}",
                target_role=AlertTargetRole.admin,
                reference_type="product", reference_id=product.id,
            )
    elif available <= threshold:
        if not await _active_alert_exists(db, AlertType.low_stock, "product", product.id):
            await create_alert(
                db, client_id, AlertType.low_stock, AlertSeverity.warning,
                f"Bajo stock de {product.name} (Solo {available} disponibles)",
                target_role=AlertTargetRole.admin,
                reference_type="product", reference_id=product.id,
            )
    elif available > threshold:
        # Auto-resolve stock alerts if stock recovered
        existing = await db.execute(
            select(Alert).where(
                Alert.alert_type.in_([AlertType.low_stock, AlertType.no_stock]),
                Alert.reference_type == "product",
                Alert.reference_id == product.id,
                Alert.resolved_at.is_(None),
            )
        )
        for alert in existing.scalars().all():
            alert.resolved_at = datetime.now(timezone.utc)
            alert.is_read = True


async def create_picking_error_alert(
    db: AsyncSession,
    client_id: int,
    order_id: int,
    order_number: str,
    scanned_sku: str,
    expected_skus: list[str],
) -> Alert:
    """Called when a wrong product is scanned during picking."""
    return await create_alert(
        db, client_id, AlertType.picking_error, AlertSeverity.critical,
        f"Error de escaneo en pedido {order_number}: se escaneó {scanned_sku}, "
        f"se esperaba {', '.join(expected_skus)}",
        target_role=AlertTargetRole.operator,
        reference_type="order", reference_id=order_id,
    )
