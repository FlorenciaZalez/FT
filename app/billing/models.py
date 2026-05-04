import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ChargeStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    cancelled = "cancelled"


class BillingDocumentStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    overdue = "overdue"


class BillingRates(Base):
    __tablename__ = "billing_rates"

    id: Mapped[int] = mapped_column(primary_key=True)
    storage_per_m3: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    preparation_base_fee: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    preparation_additional_fee: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    preparation_price_simple: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    preparation_price_special: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    product_creation_fee: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    label_print_fee: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    transport_dispatch_fee: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    truck_unloading_fee: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    shipping_base: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ClientRates(Base):
    __tablename__ = "client_rates"
    __table_args__ = (UniqueConstraint("client_id", name="uq_client_rates_client_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    storage_per_m3: Mapped[float | None] = mapped_column(Numeric(12, 2))
    shipping_multiplier: Mapped[float | None] = mapped_column(Numeric(12, 4))
    storage_discount_pct: Mapped[float | None] = mapped_column(Numeric(5, 2))
    shipping_discount_pct: Mapped[float | None] = mapped_column(Numeric(5, 2))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    client = relationship("Client")


class ClientStorageRecord(Base):
    __tablename__ = "client_storage_records"
    __table_args__ = (UniqueConstraint("client_id", "period", name="uq_client_storage_client_period"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    storage_m3: Mapped[float] = mapped_column(Numeric(14, 3), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    client = relationship("Client", back_populates="storage_records")


class Charge(Base):
    __tablename__ = "charges"
    __table_args__ = (UniqueConstraint("client_id", "period", name="uq_charge_client_period"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    total_m3: Mapped[float] = mapped_column(Numeric(14, 3), nullable=False, default=0)
    total_orders: Mapped[int] = mapped_column(nullable=False, default=0)
    base_storage_rate: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    storage_discount_pct: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    applied_storage_rate: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    base_preparation_rate: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    preparation_discount_pct: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    applied_preparation_rate: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    applied_shipping_base: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    applied_shipping_multiplier: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False, default=1)
    shipping_base_amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    shipping_discount_pct: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    storage_amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    preparation_amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    product_creation_amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    label_print_amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    transport_dispatch_amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    truck_unloading_amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    manual_charge_amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    shipping_amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    status: Mapped[ChargeStatus] = mapped_column(
        Enum(ChargeStatus), nullable=False, default=ChargeStatus.pending
    )
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    client = relationship("Client")


class PreparationRecord(Base):
    """Registro inmutable del costo de preparación aplicado a cada pedido."""
    __tablename__ = "preparation_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[int | None] = mapped_column(
        ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True
    )
    order_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("order_items.id", ondelete="SET NULL"), nullable=True
    )
    cantidad_items: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    precio_base: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    precio_adicional: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    total: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    preparation_type: Mapped[str] = mapped_column(String(20), nullable=False)
    price_applied: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    client = relationship("Client")


class ProductCreationRecord(Base):
    __tablename__ = "product_creation_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True
    )
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str] = mapped_column(String(100), nullable=False)
    price_applied: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    client = relationship("Client")
    product = relationship("Product")


class LabelPrintRecord(Base):
    __tablename__ = "label_print_records"
    __table_args__ = (UniqueConstraint("order_id", name="uq_label_print_record_order_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[int | None] = mapped_column(
        ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    order_number: Mapped[str] = mapped_column(String(100), nullable=False)
    label_type: Mapped[str | None] = mapped_column(String(20))
    price_applied: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    printed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    client = relationship("Client")
    order = relationship("Order")


class TransportDispatchRecord(Base):
    __tablename__ = "transport_dispatch_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    transportista: Mapped[str] = mapped_column(String(200), nullable=False)
    cantidad_pedidos: Mapped[int] = mapped_column(Integer, nullable=False)
    origen: Mapped[str] = mapped_column(String(50), nullable=False, default="manual_facturacion")
    costo_aplicado: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    client = relationship("Client")


class MerchandiseReceptionRecord(Base):
    __tablename__ = "merchandise_reception_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    cantidad_camiones: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    observaciones: Mapped[str | None] = mapped_column(String(500), nullable=True)
    costo_unitario: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    costo_total: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    client = relationship("Client")


class ManualCharge(Base):
    __tablename__ = "manual_charges"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    monto: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(String(500), nullable=True)
    tipo: Mapped[str | None] = mapped_column(String(50), nullable=True)
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    periodo: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    client = relationship("Client")


class BillingSchedule(Base):
    __tablename__ = "billing_schedules"
    __table_args__ = (UniqueConstraint("client_id", name="uq_billing_schedule_client_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day_of_month: Mapped[int] = mapped_column(nullable=False)
    active: Mapped[bool] = mapped_column(nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    client = relationship("Client", back_populates="billing_schedule")


class BillingDocument(Base):
    __tablename__ = "billing_documents"
    __table_args__ = (UniqueConstraint("client_id", "period", name="uq_billing_document_client_period"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    storage_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    preparation_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    product_creation_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    label_print_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    transport_dispatch_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    truck_unloading_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    manual_charge_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    shipping_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    status: Mapped[BillingDocumentStatus] = mapped_column(
        Enum(BillingDocumentStatus), nullable=False, default=BillingDocumentStatus.pending
    )
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    client = relationship("Client", back_populates="billing_documents")
