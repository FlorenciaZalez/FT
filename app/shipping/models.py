import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Integer, Numeric, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.products.models import ProductWeightCategory


class ShippingCordon(str, enum.Enum):
    cordon_1 = "cordon_1"
    cordon_2 = "cordon_2"
    cordon_3 = "cordon_3"


SHIPPING_CORDON_ENUM = Enum(
    ShippingCordon,
    name="shippingcordon",
    values_callable=lambda enum_type: [member.value for member in enum_type],
)


PRODUCT_WEIGHT_CATEGORY_ENUM = Enum(
    ProductWeightCategory,
    name="productweightcategory",
    values_callable=lambda enum_type: [member.value for member in enum_type],
)


class PostalCodeRange(Base):
    __tablename__ = "postal_code_ranges"
    __table_args__ = (
        UniqueConstraint("cp_from", "cp_to", "cordon", name="uq_postal_code_ranges_range_cordon"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cp_from: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    cp_to: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    cordon: Mapped[ShippingCordon] = mapped_column(SHIPPING_CORDON_ENUM, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ShippingRate(Base):
    __tablename__ = "shipping_rates"
    __table_args__ = (
        UniqueConstraint("cordon", name="uq_shipping_rates_cordon"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cordon: Mapped[ShippingCordon] = mapped_column(SHIPPING_CORDON_ENUM, nullable=False, index=True)
    price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class HandlingRate(Base):
    __tablename__ = "handling_rates"
    __table_args__ = (
        UniqueConstraint("weight_category", name="uq_handling_rates_weight_category"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    weight_category: Mapped[ProductWeightCategory] = mapped_column(
        PRODUCT_WEIGHT_CATEGORY_ENUM,
        nullable=False,
        index=True,
    )
    price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )