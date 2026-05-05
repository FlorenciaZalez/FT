import enum
from datetime import datetime
from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ProductWeightCategory(str, enum.Enum):
    simple = "simple"
    intermedio = "intermedio"
    premium = "premium"


PRODUCT_WEIGHT_CATEGORY_ENUM = Enum(
    ProductWeightCategory,
    name="productweightcategory",
    values_callable=lambda enum_type: [member.value for member in enum_type],
)


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("client_id", "sku", name="uq_product_client_sku"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    barcode: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    weight_kg: Mapped[float | None] = mapped_column(Numeric(10, 3))
    weight_category: Mapped[ProductWeightCategory] = mapped_column(
        PRODUCT_WEIGHT_CATEGORY_ENUM,
        nullable=False,
        default=ProductWeightCategory.simple,
        server_default=ProductWeightCategory.simple.value,
        index=True,
    )
    width_cm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    height_cm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    depth_cm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    volume_m3: Mapped[float | None] = mapped_column(Numeric(12, 4))
    image_url: Mapped[str | None] = mapped_column(String(500))
    location_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("warehouse_locations.id", ondelete="SET NULL"), index=True
    )
    preparation_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="simple",
        server_default="simple",
        index=True,
    )
    alta_cobrada: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    client = relationship("Client", back_populates="products")
    location = relationship("WarehouseLocation", lazy="selectin")
    stock_entries = relationship("Stock", back_populates="product", lazy="selectin")
    ml_mappings = relationship(
        "MLProductMapping",
        back_populates="product",
        lazy="selectin",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    order_items = relationship("OrderItem", back_populates="product", lazy="selectin")
    stock_movements = relationship("StockMovement", back_populates="product", lazy="selectin")

    def __repr__(self) -> str:
        return f"<Product {self.id}: {self.sku} - {self.name}>"
