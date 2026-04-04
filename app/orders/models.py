import enum
from datetime import datetime
from sqlalchemy import (
    String, Integer, Boolean, DateTime, Text, ForeignKey, Enum, Numeric, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class OrderSource(str, enum.Enum):
    mercadolibre = "mercadolibre"
    manual = "manual"
    other = "other"


class OrderLabelType(str, enum.Enum):
    manual = "manual"
    external = "external"


class OrderOperationType(str, enum.Enum):
    sale = "sale"
    return_ = "return"


ORDER_OPERATION_TYPE_ENUM = Enum(
    OrderOperationType,
    name="orderoperationtype",
    values_callable=lambda enum_type: [member.value for member in enum_type],
)


class OrderStatus(str, enum.Enum):
    pending = "pending"
    in_preparation = "in_preparation"
    prepared = "prepared"
    dispatched = "dispatched"
    awaiting_return = "awaiting_return"
    returned_pending_review = "returned_pending_review"
    returned_completed = "returned_completed"
    cancelled = "cancelled"


class ReturnCondition(str, enum.Enum):
    good = "good"
    damaged = "damaged"
    review = "review"


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_number: Mapped[str] = mapped_column(
        String(50), unique=True, nullable=False, index=True
    )
    source: Mapped[OrderSource] = mapped_column(
        Enum(OrderSource), nullable=False
    )
    source_order_id: Mapped[str | None] = mapped_column(String(100))  # ID en ML u otro origen
    external_id: Mapped[str | None] = mapped_column(String(100), index=True)
    shipping_id: Mapped[str | None] = mapped_column(String(100), index=True)
    ml_item_id: Mapped[str | None] = mapped_column(String(50), index=True)
    ml_variation_id: Mapped[str | None] = mapped_column(String(50), index=True)
    requested_quantity: Mapped[int | None] = mapped_column(Integer)
    mapping_status: Mapped[str | None] = mapped_column(String(40), index=True)
    operation_type: Mapped[OrderOperationType] = mapped_column(
        ORDER_OPERATION_TYPE_ENUM, default=OrderOperationType.sale, nullable=False, index=True
    )
    exchange_id: Mapped[str | None] = mapped_column(String(36), index=True)
    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus), default=OrderStatus.pending, nullable=False, index=True
    )

    # Datos de envío
    shipping_label_url: Mapped[str | None] = mapped_column(String(500))
    tracking_number: Mapped[str | None] = mapped_column(String(100))
    label_printed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    label_printed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    label_print_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    label_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    label_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    label_type: Mapped[str | None] = mapped_column(String(20))
    buyer_name: Mapped[str | None] = mapped_column(String(200))
    buyer_address: Mapped[str | None] = mapped_column(Text)
    address_line: Mapped[str | None] = mapped_column(String(500))
    city: Mapped[str | None] = mapped_column(String(200))
    state: Mapped[str | None] = mapped_column(String(200))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    cordon: Mapped[str | None] = mapped_column(String(100), index=True)
    shipping_cost: Mapped[float | None] = mapped_column(Numeric(12, 2))
    shipping_status: Mapped[str | None] = mapped_column(String(40), index=True)
    address_reference: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)

    # Asignación y timestamps operativos
    assigned_operator_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    picked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    packed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Batch dispatch
    dispatch_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("dispatch_batches.id", ondelete="SET NULL"), index=True
    )

    # Zona dominante (pasillo con más productos)
    dominant_zone: Mapped[str | None] = mapped_column(String(10), index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    client = relationship("Client", back_populates="orders")
    assigned_operator = relationship("User", foreign_keys=[assigned_operator_id])
    items = relationship("OrderItem", back_populates="order", lazy="selectin", cascade="all, delete-orphan")
    status_logs = relationship("OrderStatusLog", back_populates="order", lazy="selectin", cascade="all, delete-orphan")
    dispatch_batch = relationship("DispatchBatch", back_populates="orders")
    return_receptions = relationship("ReturnReception", back_populates="order", lazy="selectin", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Order {self.order_number} [{self.status}]>"


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    sku: Mapped[str] = mapped_column(String(100), nullable=False)  # Snapshot del SKU al momento del pedido
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    picked_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    location_code: Mapped[str | None] = mapped_column(String(50))  # Snapshot de dónde buscar

    # Relationships
    order = relationship("Order", back_populates="items")
    product = relationship("Product", back_populates="order_items")

    def __repr__(self) -> str:
        return f"<OrderItem order={self.order_id} sku={self.sku} qty={self.quantity}>"


class OrderStatusLog(Base):
    """Registro inmutable de cada cambio de estado de un pedido."""
    __tablename__ = "order_status_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    old_status: Mapped[str | None] = mapped_column(String(30))
    new_status: Mapped[str] = mapped_column(String(30), nullable=False)
    changed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    order = relationship("Order", back_populates="status_logs")
    user = relationship("User", foreign_keys=[changed_by])

    def __repr__(self) -> str:
        return f"<StatusLog order={self.order_id} {self.old_status}→{self.new_status}>"


class ReturnReception(Base):
    __tablename__ = "return_receptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sku: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    condition: Mapped[ReturnCondition] = mapped_column(
        Enum(ReturnCondition), nullable=False, index=True
    )
    notes: Mapped[str | None] = mapped_column(Text)
    stock_location_id: Mapped[int | None] = mapped_column(
        ForeignKey("warehouse_locations.id", ondelete="SET NULL"), index=True
    )
    received_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    order = relationship("Order", back_populates="return_receptions")
    order_item = relationship("OrderItem")
    product = relationship("Product")
    stock_location = relationship("WarehouseLocation")
    user = relationship("User", foreign_keys=[received_by])

    def __repr__(self) -> str:
        return f"<ReturnReception order={self.order_id} sku={self.sku} condition={self.condition}>"


class DispatchBatch(Base):
    """Lote de despacho masivo."""
    __tablename__ = "dispatch_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_number: Mapped[str] = mapped_column(
        String(20), unique=True, nullable=False, index=True
    )
    carrier: Mapped[str | None] = mapped_column(String(200))
    transporter_id: Mapped[int | None] = mapped_column(
        ForeignKey("transporters.id", ondelete="SET NULL"), index=True
    )
    notes: Mapped[str | None] = mapped_column(Text)
    dispatched_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    order_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    user = relationship("User", foreign_keys=[dispatched_by])
    transporter = relationship("Transporter")
    orders = relationship("Order", back_populates="dispatch_batch")

    def __repr__(self) -> str:
        return f"<DispatchBatch {self.batch_number} ({self.order_count} orders)>"


class DispatchVerification(Base):
    """Registro de intentos de verificación de paquetes por el chofer."""
    __tablename__ = "dispatch_verifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("dispatch_batches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    entered_count: Mapped[int] = mapped_column(Integer, nullable=False)
    expected_count: Mapped[int] = mapped_column(Integer, nullable=False)
    is_match: Mapped[bool] = mapped_column(Boolean, nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    batch = relationship("DispatchBatch")

    def __repr__(self) -> str:
        return f"<DispatchVerification batch={self.batch_id} entered={self.entered_count} match={self.is_match}>"


class BatchPickingSession(Base):
    __tablename__ = "batch_picking_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True, default="active")
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user = relationship("User", foreign_keys=[user_id])
    items = relationship(
        "BatchPickingSessionItem",
        back_populates="session",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="BatchPickingSessionItem.sort_order",
    )
    scan_logs = relationship(
        "BatchPickingScanLog",
        back_populates="session",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="BatchPickingScanLog.created_at",
    )

    def __repr__(self) -> str:
        return f"<BatchPickingSession {self.id} [{self.status}]>"


class BatchPickingSessionItem(Base):
    __tablename__ = "batch_picking_session_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("batch_picking_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), index=True
    )
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    quantity_total: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity_picked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    session = relationship("BatchPickingSession", back_populates="items")
    product = relationship("Product")
    assignments = relationship(
        "BatchPickingSessionAssignment",
        back_populates="session_item",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="BatchPickingSessionAssignment.sort_order",
    )
    scan_logs = relationship(
        "BatchPickingScanLog",
        back_populates="session_item",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="BatchPickingScanLog.created_at",
    )

    def __repr__(self) -> str:
        return f"<BatchPickingSessionItem session={self.session_id} sku={self.sku}>"


class BatchPickingSessionAssignment(Base):
    __tablename__ = "batch_picking_session_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_item_id: Mapped[int] = mapped_column(
        ForeignKey("batch_picking_session_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_number: Mapped[str] = mapped_column(String(50), nullable=False)
    location_code: Mapped[str | None] = mapped_column(String(50))
    quantity_total: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity_picked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    session_item = relationship("BatchPickingSessionItem", back_populates="assignments")
    order = relationship("Order")
    order_item = relationship("OrderItem")

    def __repr__(self) -> str:
        return f"<BatchPickingAssignment order={self.order_id} item={self.order_item_id}>"


class BatchPickingScanLog(Base):
    __tablename__ = "batch_picking_scan_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("batch_picking_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_item_id: Mapped[int] = mapped_column(
        ForeignKey("batch_picking_session_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    scanned_sku: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    session = relationship("BatchPickingSession", back_populates="scan_logs")
    session_item = relationship("BatchPickingSessionItem", back_populates="scan_logs")
    order = relationship("Order")
    order_item = relationship("OrderItem")
    user = relationship("User", foreign_keys=[user_id])

    def __repr__(self) -> str:
        return f"<BatchPickingScanLog session={self.session_id} sku={self.scanned_sku}>"
