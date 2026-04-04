from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class WarehouseLocation(Base):
    __tablename__ = "warehouse_locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)  # "A-01-02-03"
    zone: Mapped[str] = mapped_column(String(10), nullable=False)     # pasillo: A, B, C...
    aisle: Mapped[str] = mapped_column(String(10), nullable=False)    # estantería: 01, 02...
    shelf: Mapped[str] = mapped_column(String(10), nullable=False)    # nivel: 01, 02...
    position: Mapped[str] = mapped_column(String(10), nullable=False, server_default="01")  # posición: 01, 02...
    description: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    stock_entries = relationship("Stock", back_populates="location", lazy="selectin")

    def __repr__(self) -> str:
        return f"<Location {self.code}>"
