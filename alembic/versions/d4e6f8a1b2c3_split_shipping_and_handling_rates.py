"""split shipping and handling rates

Revision ID: d4e6f8a1b2c3
Revises: c7d5e8f1a2b3
Create Date: 2026-03-26 18:45:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d4e6f8a1b2c3"
down_revision: Union[str, Sequence[str], None] = "c7d5e8f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    product_weight_category = postgresql.ENUM("light", "heavy", name="productweightcategory")
    product_weight_category.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "handling_rates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "weight_category",
            postgresql.ENUM("light", "heavy", name="productweightcategory", create_type=False),
            nullable=False,
        ),
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("weight_category", name="uq_handling_rates_weight_category"),
    )
    op.create_index(op.f("ix_handling_rates_weight_category"), "handling_rates", ["weight_category"], unique=False)

    op.execute(
        """
        CREATE TEMP TABLE shipping_rates_compacted AS
        SELECT DISTINCT ON (cordon)
            cordon,
            price,
            created_at,
            updated_at
        FROM shipping_rates
        ORDER BY
            cordon,
            CASE WHEN weight_category = 'light' THEN 0 ELSE 1 END,
            price ASC,
            id ASC
        """
    )

    op.drop_constraint("uq_shipping_rates_cordon_weight_category", "shipping_rates", type_="unique")
    op.drop_index(op.f("ix_shipping_rates_weight_category"), table_name="shipping_rates")
    op.execute("DELETE FROM shipping_rates")
    op.drop_column("shipping_rates", "weight_category")
    op.create_unique_constraint("uq_shipping_rates_cordon", "shipping_rates", ["cordon"])
    op.execute(
        """
        INSERT INTO shipping_rates (cordon, price, created_at, updated_at)
        SELECT cordon, price, created_at, updated_at
        FROM shipping_rates_compacted
        ORDER BY cordon
        """
    )
    op.execute("DROP TABLE shipping_rates_compacted")


def downgrade() -> None:
    op.execute(
        """
        CREATE TEMP TABLE shipping_rates_expanded AS
        SELECT cordon, price, created_at, updated_at
        FROM shipping_rates
        """
    )

    op.drop_constraint("uq_shipping_rates_cordon", "shipping_rates", type_="unique")
    op.execute("DELETE FROM shipping_rates")
    op.add_column(
        "shipping_rates",
        sa.Column(
            "weight_category",
            postgresql.ENUM("light", "heavy", name="productweightcategory", create_type=False),
            nullable=False,
            server_default="light",
        ),
    )
    op.create_index(op.f("ix_shipping_rates_weight_category"), "shipping_rates", ["weight_category"], unique=False)
    op.create_unique_constraint(
        "uq_shipping_rates_cordon_weight_category",
        "shipping_rates",
        ["cordon", "weight_category"],
    )
    op.execute(
        """
        INSERT INTO shipping_rates (cordon, weight_category, price, created_at, updated_at)
        SELECT cordon, 'light'::productweightcategory, price, created_at, updated_at
        FROM shipping_rates_expanded
        """
    )
    op.execute(
        """
        INSERT INTO shipping_rates (cordon, weight_category, price, created_at, updated_at)
        SELECT cordon, 'heavy'::productweightcategory, price, created_at, updated_at
        FROM shipping_rates_expanded
        """
    )
    op.execute("DROP TABLE shipping_rates_expanded")

    op.drop_index(op.f("ix_handling_rates_weight_category"), table_name="handling_rates")
    op.drop_table("handling_rates")