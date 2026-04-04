"""add_order_label_print_fields

Revision ID: 5d8f7c1b2a3e
Revises: f2b4c6d8e9a1
Create Date: 2026-03-25 14:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5d8f7c1b2a3e'
down_revision: Union[str, Sequence[str], None] = 'f2b4c6d8e9a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('orders', sa.Column('shipping_id', sa.String(length=100), nullable=True))
    op.add_column('orders', sa.Column('label_printed', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('orders', sa.Column('label_printed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('orders', sa.Column('label_print_count', sa.Integer(), server_default='0', nullable=False))
    op.create_index(op.f('ix_orders_shipping_id'), 'orders', ['shipping_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_orders_shipping_id'), table_name='orders')
    op.drop_column('orders', 'label_print_count')
    op.drop_column('orders', 'label_printed_at')
    op.drop_column('orders', 'label_printed')
    op.drop_column('orders', 'shipping_id')