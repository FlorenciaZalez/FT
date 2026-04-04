"""simplify preparation cost model

Revision ID: f9c1d2e3a4b5
Revises: c3d5e8f1a2b4
Create Date: 2026-03-30 17:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f9c1d2e3a4b5"
down_revision: Union[str, None] = "c3d5e8f1a2b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # Products: replace picking_type with preparation_type (simple|especial)
    op.add_column(
        "products",
        sa.Column("preparation_type", sa.String(length=20), nullable=True, server_default=sa.text("'simple'")),
    )
    op.execute(
        """
        UPDATE products
        SET preparation_type = CASE
            WHEN weight_category = 'heavy' THEN 'especial'
            ELSE 'simple'
        END
        """
    )
    op.alter_column("products", "preparation_type", nullable=False)

    op.execute("DROP INDEX IF EXISTS ix_products_picking_type")
    op.drop_column("products", "picking_type")

    # Billing rates: keep only preparation prices (no per-order picking)
    op.add_column(
        "billing_rates",
        sa.Column("preparation_price_simple", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "billing_rates",
        sa.Column("preparation_price_special", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )
    op.execute(
        """
        UPDATE billing_rates
        SET
            preparation_price_simple = COALESCE(picking_price_simple, 0),
            preparation_price_special = COALESCE(picking_price_premium, 0)
        """
    )
    op.drop_column("billing_rates", "picking_per_order")
    op.drop_column("billing_rates", "picking_price_simple")
    op.drop_column("billing_rates", "picking_price_premium")

    # Client rates: remove picking-specific discount/override
    op.drop_column("client_rates", "picking_per_order")
    op.drop_column("client_rates", "picking_discount_pct")

    # Charges: rename picking fields to preparation fields
    op.alter_column("charges", "base_picking_rate", new_column_name="base_preparation_rate")
    op.alter_column("charges", "picking_discount_pct", new_column_name="preparation_discount_pct")
    op.alter_column("charges", "applied_picking_rate", new_column_name="applied_preparation_rate")
    op.alter_column("charges", "picking_amount", new_column_name="preparation_amount")

    # Picking records -> preparation records
    op.rename_table("picking_records", "preparation_records")
    op.execute("ALTER INDEX IF EXISTS ix_picking_records_client_id RENAME TO ix_preparation_records_client_id")
    op.execute("ALTER INDEX IF EXISTS ix_picking_records_order_id RENAME TO ix_preparation_records_order_id")
    op.execute("ALTER INDEX IF EXISTS ix_picking_records_product_id RENAME TO ix_preparation_records_product_id")
    op.execute("ALTER INDEX IF EXISTS ix_picking_records_picked_at RENAME TO ix_preparation_records_recorded_at")
    op.alter_column("preparation_records", "picked_at", new_column_name="recorded_at")
    op.alter_column("preparation_records", "picking_type", new_column_name="preparation_type")

    if bind.dialect.name == "postgresql":
        op.execute(
            """
            ALTER TABLE preparation_records
            ALTER COLUMN preparation_type TYPE VARCHAR(20)
            USING preparation_type::text
            """
        )
    else:
        op.alter_column("preparation_records", "preparation_type", type_=sa.String(length=20))

    op.execute(
        """
        UPDATE preparation_records
        SET preparation_type = CASE
            WHEN preparation_type = 'premium' THEN 'especial'
            ELSE 'simple'
        END
        """
    )

    if bind.dialect.name == "postgresql":
        op.execute("DROP TYPE IF EXISTS pickingtype")


def downgrade() -> None:
    bind = op.get_bind()

    # preparation records -> picking records
    op.execute(
        """
        UPDATE preparation_records
        SET preparation_type = CASE
            WHEN preparation_type = 'especial' THEN 'premium'
            ELSE 'simple'
        END
        """
    )

    if bind.dialect.name == "postgresql":
        op.execute("CREATE TYPE pickingtype AS ENUM ('simple', 'premium')")
        op.execute(
            """
            ALTER TABLE preparation_records
            ALTER COLUMN preparation_type TYPE pickingtype
            USING preparation_type::pickingtype
            """
        )
    else:
        op.alter_column("preparation_records", "preparation_type", type_=sa.String(length=20))

    op.alter_column("preparation_records", "preparation_type", new_column_name="picking_type")
    op.alter_column("preparation_records", "recorded_at", new_column_name="picked_at")
    op.execute("ALTER INDEX IF EXISTS ix_preparation_records_client_id RENAME TO ix_picking_records_client_id")
    op.execute("ALTER INDEX IF EXISTS ix_preparation_records_order_id RENAME TO ix_picking_records_order_id")
    op.execute("ALTER INDEX IF EXISTS ix_preparation_records_product_id RENAME TO ix_picking_records_product_id")
    op.execute("ALTER INDEX IF EXISTS ix_preparation_records_recorded_at RENAME TO ix_picking_records_picked_at")
    op.rename_table("preparation_records", "picking_records")

    # Charges
    op.alter_column("charges", "preparation_amount", new_column_name="picking_amount")
    op.alter_column("charges", "applied_preparation_rate", new_column_name="applied_picking_rate")
    op.alter_column("charges", "preparation_discount_pct", new_column_name="picking_discount_pct")
    op.alter_column("charges", "base_preparation_rate", new_column_name="base_picking_rate")

    # Client rates
    op.add_column("client_rates", sa.Column("picking_discount_pct", sa.Numeric(5, 2), nullable=True))
    op.add_column("client_rates", sa.Column("picking_per_order", sa.Numeric(12, 2), nullable=True))

    # Billing rates
    op.add_column(
        "billing_rates",
        sa.Column("picking_price_premium", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "billing_rates",
        sa.Column("picking_price_simple", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "billing_rates",
        sa.Column("picking_per_order", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )
    op.execute(
        """
        UPDATE billing_rates
        SET
            picking_price_simple = COALESCE(preparation_price_simple, 0),
            picking_price_premium = COALESCE(preparation_price_special, 0)
        """
    )
    op.drop_column("billing_rates", "preparation_price_special")
    op.drop_column("billing_rates", "preparation_price_simple")

    # Products
    if bind.dialect.name == "postgresql":
        op.execute("CREATE TYPE pickingtype AS ENUM ('simple', 'premium')")
    op.add_column(
        "products",
        sa.Column("picking_type", sa.String(length=20), nullable=False, server_default=sa.text("'simple'")),
    )
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            ALTER TABLE products
            ALTER COLUMN picking_type TYPE pickingtype
            USING picking_type::pickingtype
            """
        )
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_picking_type ON products (picking_type)")
    op.drop_column("products", "preparation_type")
