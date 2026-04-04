"""simplify shipping by weight category

Revision ID: c7d5e8f1a2b3
Revises: f2b4c6d8e9a1
Create Date: 2026-03-26 14:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c7d5e8f1a2b3"
down_revision: Union[str, Sequence[str], None] = "9a2b3c4d5e6f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    product_weight_category = postgresql.ENUM("light", "heavy", name="productweightcategory")
    shipping_cordon = postgresql.ENUM("cordon_1", "cordon_2", "cordon_3", name="shippingcordon")
    product_weight_category.create(op.get_bind(), checkfirst=True)
    shipping_cordon.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "products",
        sa.Column(
            "weight_category",
            sa.Enum("light", "heavy", name="productweightcategory", create_type=False),
            nullable=False,
            server_default="light",
        ),
    )
    op.create_index(op.f("ix_products_weight_category"), "products", ["weight_category"], unique=False)

    op.add_column(
        "shipping_rates",
        sa.Column(
            "weight_category",
            sa.Enum("light", "heavy", name="productweightcategory", create_type=False),
            nullable=False,
            server_default="light",
        ),
    )
    op.execute(
        """
        UPDATE shipping_rates
        SET weight_category = CASE
            WHEN weight_max <= 1 THEN 'light'::productweightcategory
            ELSE 'heavy'::productweightcategory
        END
        """
    )

    op.drop_constraint("ck_shipping_rates_weight_order", "shipping_rates", type_="check")
    op.drop_constraint("uq_shipping_rates_cordon_weight_range", "shipping_rates", type_="unique")
    op.create_unique_constraint(
        "uq_shipping_rates_cordon_weight_category",
        "shipping_rates",
        ["cordon", "weight_category"],
    )
    op.create_index(op.f("ix_shipping_rates_weight_category"), "shipping_rates", ["weight_category"], unique=False)
    op.drop_column("shipping_rates", "weight_min")
    op.drop_column("shipping_rates", "weight_max")

    op.alter_column(
        "postal_code_ranges",
        "cordon",
        existing_type=sa.String(length=100),
        type_=sa.Enum("cordon_1", "cordon_2", "cordon_3", name="shippingcordon", create_type=False),
        existing_nullable=False,
        postgresql_using="cordon::shippingcordon",
    )
    op.alter_column(
        "shipping_rates",
        "cordon",
        existing_type=sa.String(length=100),
        type_=sa.Enum("cordon_1", "cordon_2", "cordon_3", name="shippingcordon", create_type=False),
        existing_nullable=False,
        postgresql_using="cordon::shippingcordon",
    )


def downgrade() -> None:
    op.alter_column(
        "shipping_rates",
        "cordon",
        existing_type=sa.Enum("cordon_1", "cordon_2", "cordon_3", name="shippingcordon", create_type=False),
        type_=sa.String(length=100),
        existing_nullable=False,
        postgresql_using="cordon::text",
    )
    op.alter_column(
        "postal_code_ranges",
        "cordon",
        existing_type=sa.Enum("cordon_1", "cordon_2", "cordon_3", name="shippingcordon", create_type=False),
        type_=sa.String(length=100),
        existing_nullable=False,
        postgresql_using="cordon::text",
    )

    op.add_column("shipping_rates", sa.Column("weight_max", sa.Numeric(10, 3), nullable=False, server_default="999999"))
    op.add_column("shipping_rates", sa.Column("weight_min", sa.Numeric(10, 3), nullable=False, server_default="0"))
    op.execute(
        """
        UPDATE shipping_rates
        SET weight_min = CASE WHEN weight_category = 'heavy' THEN 1.001 ELSE 0 END,
            weight_max = CASE WHEN weight_category = 'heavy' THEN 999999 ELSE 1 END
        """
    )
    op.drop_index(op.f("ix_shipping_rates_weight_category"), table_name="shipping_rates")
    op.drop_constraint("uq_shipping_rates_cordon_weight_category", "shipping_rates", type_="unique")
    op.create_check_constraint("ck_shipping_rates_weight_order", "shipping_rates", "weight_min <= weight_max")
    op.create_unique_constraint(
        "uq_shipping_rates_cordon_weight_range",
        "shipping_rates",
        ["cordon", "weight_min", "weight_max"],
    )
    op.drop_column("shipping_rates", "weight_category")

    op.drop_index(op.f("ix_products_weight_category"), table_name="products")
    op.drop_column("products", "weight_category")

    postgresql.ENUM(name="shippingcordon").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="productweightcategory").drop(op.get_bind(), checkfirst=True)