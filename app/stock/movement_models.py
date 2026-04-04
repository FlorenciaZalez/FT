import enum
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey, Enum, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class MovementType(str, enum.Enum):
    inbound = "inbound"                      # Ingreso de mercadería
    outbound = "outbound"                    # Salida por despacho
    reservation = "reservation"              # Reserva por pedido
    reservation_release = "reservation_release"  # Liberación por cancelación
    adjustment = "adjustment"                # Ajuste manual (inventario)


class ReferenceType(str, enum.Enum):
    order = "order"
    manual = "manual"
    adjustment = "adjustment"
    inbound = "inbound"


class StockMovement(Base):
    """
    Registro append-only de cada movimiento de stock.
    Funciona como libro contable: nunca se edita, solo se inserta.
    """
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    movement_type: Mapped[MovementType] = mapped_column(
        Enum(MovementType), nullable=False, index=True
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)  # +ingreso / -egreso
    reference_type: Mapped[ReferenceType] = mapped_column(
        Enum(ReferenceType), nullable=False
    )
    reference_id: Mapped[int | None] = mapped_column(Integer)  # ID del pedido, ingreso, etc.
    performed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    # Relationships
    product = relationship("Product", back_populates="stock_movements")
    user = relationship("User", foreign_keys=[performed_by])

    def __repr__(self) -> str:
        return f"<StockMovement {self.movement_type} product={self.product_id} qty={self.quantity}>"
