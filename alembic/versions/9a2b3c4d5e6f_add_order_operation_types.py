"""add order operation types

Revision ID: 9a2b3c4d5e6f
Revises: 8b1c2d3e4f5a
Create Date: 2026-03-25 21:05:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "9a2b3c4d5e6f"
down_revision: Union[str, Sequence[str], None] = "8b1c2d3e4f5a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    order_operation_type = postgresql.ENUM("sale", "return", name="orderoperationtype")
    order_operation_type.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "orders",
        sa.Column(
            "operation_type",
            sa.Enum("sale", "return", name="orderoperationtype", create_type=False),
            nullable=False,
            server_default="sale",
        ),
    )
    op.add_column("orders", sa.Column("exchange_id", sa.String(length=36), nullable=True))
    op.create_index(op.f("ix_orders_operation_type"), "orders", ["operation_type"], unique=False)
    op.create_index(op.f("ix_orders_exchange_id"), "orders", ["exchange_id"], unique=False)
    op.alter_column("orders", "operation_type", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_orders_exchange_id"), table_name="orders")
    op.drop_index(op.f("ix_orders_operation_type"), table_name="orders")
    op.drop_column("orders", "exchange_id")
    op.drop_column("orders", "operation_type")
    postgresql.ENUM(name="orderoperationtype").drop(op.get_bind(), checkfirst=True)