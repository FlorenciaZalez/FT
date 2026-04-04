from datetime import datetime
from sqlalchemy import Integer, DateTime, ForeignKey, UniqueConstraint, Computed, func, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Stock(Base):
    """
    Stock real de un producto en una ubicación, para un cliente.
    quantity_available es columna generada: total - reserved.
    """
    __tablename__ = "stock"
    __table_args__ = (
        UniqueConstraint("product_id", "location_id", name="uq_stock_product_location"),
        CheckConstraint("quantity_total >= 0", name="ck_stock_total_non_negative"),
        CheckConstraint("quantity_reserved >= 0", name="ck_stock_reserved_non_negative"),
        CheckConstraint(
            "quantity_reserved <= quantity_total",
            name="ck_stock_reserved_lte_total"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[int] = mapped_column(
        ForeignKey("warehouse_locations.id", ondelete="RESTRICT"), nullable=False
    )
    quantity_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    quantity_reserved: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    quantity_available: Mapped[int] = mapped_column(
        Computed("quantity_total - quantity_reserved")
    )
    min_stock_alert: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    client = relationship("Client", back_populates="stock_entries")
    product = relationship("Product", back_populates="stock_entries")
    location = relationship("WarehouseLocation", back_populates="stock_entries")

    def __repr__(self) -> str:
        return f"<Stock product={self.product_id} loc={self.location_id} total={self.quantity_total} avail={self.quantity_available}>"
