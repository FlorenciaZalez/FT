"""add returns flow

Revision ID: 8b1c2d3e4f5a
Revises: 7c2d4e6f8a9b
Create Date: 2026-03-25 20:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "8b1c2d3e4f5a"
down_revision: Union[str, Sequence[str], None] = "7c2d4e6f8a9b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE orderstatus ADD VALUE IF NOT EXISTS 'awaiting_return'")
    op.execute("ALTER TYPE orderstatus ADD VALUE IF NOT EXISTS 'returned_pending_review'")
    op.execute("ALTER TYPE orderstatus ADD VALUE IF NOT EXISTS 'returned_completed'")

    return_condition = postgresql.ENUM("good", "damaged", "review", name="returncondition", create_type=False)
    return_condition.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "return_receptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("order_item_id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=True),
        sa.Column("sku", sa.String(length=100), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("condition", return_condition, nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("stock_location_id", sa.Integer(), nullable=True),
        sa.Column("received_by", sa.Integer(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["order_item_id"], ["order_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["received_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["stock_location_id"], ["warehouse_locations.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_item_id"),
    )
    op.create_index(op.f("ix_return_receptions_order_id"), "return_receptions", ["order_id"], unique=False)
    op.create_index(op.f("ix_return_receptions_order_item_id"), "return_receptions", ["order_item_id"], unique=True)
    op.create_index(op.f("ix_return_receptions_client_id"), "return_receptions", ["client_id"], unique=False)
    op.create_index(op.f("ix_return_receptions_product_id"), "return_receptions", ["product_id"], unique=False)
    op.create_index(op.f("ix_return_receptions_sku"), "return_receptions", ["sku"], unique=False)
    op.create_index(op.f("ix_return_receptions_condition"), "return_receptions", ["condition"], unique=False)
    op.create_index(op.f("ix_return_receptions_stock_location_id"), "return_receptions", ["stock_location_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_return_receptions_stock_location_id"), table_name="return_receptions")
    op.drop_index(op.f("ix_return_receptions_condition"), table_name="return_receptions")
    op.drop_index(op.f("ix_return_receptions_sku"), table_name="return_receptions")
    op.drop_index(op.f("ix_return_receptions_product_id"), table_name="return_receptions")
    op.drop_index(op.f("ix_return_receptions_client_id"), table_name="return_receptions")
    op.drop_index(op.f("ix_return_receptions_order_item_id"), table_name="return_receptions")
    op.drop_index(op.f("ix_return_receptions_order_id"), table_name="return_receptions")
    op.drop_table("return_receptions")

    sa.Enum(name="returncondition").drop(op.get_bind(), checkfirst=True)

    op.execute("UPDATE orders SET status = 'dispatched' WHERE status IN ('awaiting_return', 'returned_pending_review', 'returned_completed')")
    op.execute("ALTER TABLE orders ALTER COLUMN status TYPE varchar(30) USING status::text")
    op.execute("DROP TYPE IF EXISTS orderstatus_old")
    op.execute("ALTER TYPE orderstatus RENAME TO orderstatus_old")
    op.execute("CREATE TYPE orderstatus AS ENUM ('pending', 'in_preparation', 'prepared', 'dispatched', 'cancelled')")
    op.execute("ALTER TABLE orders ALTER COLUMN status TYPE orderstatus USING status::orderstatus")
    op.execute("DROP TYPE orderstatus_old")