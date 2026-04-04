"""add progressive preparation pricing

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-03-30 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "e6f7a8b9c0d1"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("billing_rates", sa.Column("preparation_base_fee", sa.Numeric(12, 2), nullable=True))
    op.add_column("billing_rates", sa.Column("preparation_additional_fee", sa.Numeric(12, 2), nullable=True))
    op.execute(
        """
        UPDATE billing_rates
        SET preparation_base_fee = COALESCE(preparation_price_simple, 0),
            preparation_additional_fee = COALESCE(preparation_price_simple, 0)
        WHERE preparation_base_fee IS NULL OR preparation_additional_fee IS NULL
        """
    )
    op.alter_column("billing_rates", "preparation_base_fee", nullable=False)
    op.alter_column("billing_rates", "preparation_additional_fee", nullable=False)

    op.add_column("preparation_records", sa.Column("cantidad_items", sa.Integer(), nullable=True))
    op.add_column("preparation_records", sa.Column("precio_base", sa.Numeric(12, 2), nullable=True))
    op.add_column("preparation_records", sa.Column("precio_adicional", sa.Numeric(12, 2), nullable=True))
    op.add_column("preparation_records", sa.Column("total", sa.Numeric(12, 2), nullable=True))
    op.execute(
        """
        UPDATE preparation_records
        SET cantidad_items = COALESCE(cantidad_items, 1),
            precio_base = COALESCE(precio_base, price_applied, 0),
            precio_adicional = COALESCE(precio_adicional, 0),
            total = COALESCE(total, price_applied, 0)
        WHERE cantidad_items IS NULL
           OR precio_base IS NULL
           OR precio_adicional IS NULL
           OR total IS NULL
        """
    )
    op.alter_column("preparation_records", "cantidad_items", nullable=False)
    op.alter_column("preparation_records", "precio_base", nullable=False)
    op.alter_column("preparation_records", "precio_adicional", nullable=False)
    op.alter_column("preparation_records", "total", nullable=False)


def downgrade() -> None:
    op.drop_column("preparation_records", "total")
    op.drop_column("preparation_records", "precio_adicional")
    op.drop_column("preparation_records", "precio_base")
    op.drop_column("preparation_records", "cantidad_items")
    op.drop_column("billing_rates", "preparation_additional_fee")
    op.drop_column("billing_rates", "preparation_base_fee")