"""add client billing discounts

Revision ID: e5f7a9b1c2d3
Revises: d4e6f8a1b2c3
Create Date: 2026-03-26 20:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5f7a9b1c2d3"
down_revision: Union[str, Sequence[str], None] = "d4e6f8a1b2c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("client_rates", sa.Column("storage_discount_pct", sa.Numeric(5, 2), nullable=True))
    op.add_column("client_rates", sa.Column("picking_discount_pct", sa.Numeric(5, 2), nullable=True))
    op.add_column("client_rates", sa.Column("shipping_discount_pct", sa.Numeric(5, 2), nullable=True))

    op.execute(
        """
        UPDATE client_rates AS cr
        SET storage_discount_pct = CASE
                WHEN br.storage_per_m3 > 0
                     AND cr.storage_per_m3 IS NOT NULL
                     AND cr.storage_per_m3 >= 0
                     AND cr.storage_per_m3 <= br.storage_per_m3
                THEN ROUND((1 - (cr.storage_per_m3 / br.storage_per_m3)) * 100, 2)
                ELSE NULL
            END,
            picking_discount_pct = CASE
                WHEN br.picking_per_order > 0
                     AND cr.picking_per_order IS NOT NULL
                     AND cr.picking_per_order >= 0
                     AND cr.picking_per_order <= br.picking_per_order
                THEN ROUND((1 - (cr.picking_per_order / br.picking_per_order)) * 100, 2)
                ELSE NULL
            END,
            shipping_discount_pct = CASE
                WHEN cr.shipping_multiplier IS NOT NULL
                     AND cr.shipping_multiplier >= 0
                     AND cr.shipping_multiplier <= 1
                THEN ROUND((1 - cr.shipping_multiplier) * 100, 2)
                ELSE NULL
            END
        FROM billing_rates AS br
        WHERE br.id = (SELECT id FROM billing_rates ORDER BY id LIMIT 1)
        """
    )

    op.add_column("charges", sa.Column("base_storage_rate", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.add_column("charges", sa.Column("storage_discount_pct", sa.Numeric(5, 2), nullable=False, server_default="0"))
    op.add_column("charges", sa.Column("base_picking_rate", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.add_column("charges", sa.Column("picking_discount_pct", sa.Numeric(5, 2), nullable=False, server_default="0"))
    op.add_column("charges", sa.Column("shipping_base_amount", sa.Numeric(14, 2), nullable=False, server_default="0"))
    op.add_column("charges", sa.Column("shipping_discount_pct", sa.Numeric(5, 2), nullable=False, server_default="0"))

    op.execute(
        """
        UPDATE charges
        SET base_storage_rate = applied_storage_rate,
            storage_discount_pct = 0,
            base_picking_rate = applied_picking_rate,
            picking_discount_pct = 0,
            shipping_base_amount = shipping_amount,
            shipping_discount_pct = 0
        """
    )

    op.alter_column("charges", "base_storage_rate", server_default=None)
    op.alter_column("charges", "storage_discount_pct", server_default=None)
    op.alter_column("charges", "base_picking_rate", server_default=None)
    op.alter_column("charges", "picking_discount_pct", server_default=None)
    op.alter_column("charges", "shipping_base_amount", server_default=None)
    op.alter_column("charges", "shipping_discount_pct", server_default=None)


def downgrade() -> None:
    op.drop_column("charges", "shipping_discount_pct")
    op.drop_column("charges", "shipping_base_amount")
    op.drop_column("charges", "picking_discount_pct")
    op.drop_column("charges", "base_picking_rate")
    op.drop_column("charges", "storage_discount_pct")
    op.drop_column("charges", "base_storage_rate")

    op.drop_column("client_rates", "shipping_discount_pct")
    op.drop_column("client_rates", "picking_discount_pct")
    op.drop_column("client_rates", "storage_discount_pct")