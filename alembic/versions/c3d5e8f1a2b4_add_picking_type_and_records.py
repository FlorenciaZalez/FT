"""add picking type to products and picking records

Revision ID: c3d5e8f1a2b4
Revises: b8d1e2f3a4c5
Create Date: 2026-03-29 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "c3d5e8f1a2b4"
down_revision: Union[str, None] = "b8d1e2f3a4c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

pickingtype_enum = sa.Enum("simple", "premium", name="pickingtype")

pickingtype_column_enum = postgresql.ENUM(
    "simple",
    "premium",
    name="pickingtype",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    pickingtype_enum.create(bind, checkfirst=True)

    # Add picking_type to products
    op.add_column(
        "products",
        sa.Column(
            "picking_type",
            pickingtype_column_enum,
            nullable=False,
            server_default=sa.text("'simple'::pickingtype"),
        ),
    )

    # Add picking price fields to billing_rates
    op.add_column(
        "billing_rates",
        sa.Column("picking_price_simple", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "billing_rates",
        sa.Column("picking_price_premium", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )

    # Create picking_records table
    op.create_table(
        "picking_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("product_id", sa.Integer(), nullable=True),
        sa.Column("order_item_id", sa.Integer(), nullable=True),
        sa.Column("picking_type", pickingtype_column_enum, nullable=False),
        sa.Column("price_applied", sa.Numeric(12, 2), nullable=False),
        sa.Column(
            "picked_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["order_item_id"], ["order_items.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_picking_records_client_id"), "picking_records", ["client_id"])
    op.create_index(op.f("ix_picking_records_order_id"), "picking_records", ["order_id"])
    op.create_index(op.f("ix_picking_records_product_id"), "picking_records", ["product_id"])
    op.create_index(op.f("ix_picking_records_picked_at"), "picking_records", ["picked_at"])


def downgrade() -> None:
    op.drop_index(op.f("ix_picking_records_picked_at"), table_name="picking_records")
    op.drop_index(op.f("ix_picking_records_product_id"), table_name="picking_records")
    op.drop_index(op.f("ix_picking_records_order_id"), table_name="picking_records")
    op.drop_index(op.f("ix_picking_records_client_id"), table_name="picking_records")
    op.drop_table("picking_records")

    op.drop_column("billing_rates", "picking_price_premium")
    op.drop_column("billing_rates", "picking_price_simple")
    op.drop_column("products", "picking_type")

    bind = op.get_bind()
    pickingtype_enum.drop(bind, checkfirst=True)
