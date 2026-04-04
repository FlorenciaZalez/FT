"""prepare_orders_for_ml_simulation

Revision ID: e4b19c7a2f11
Revises: d2a6f9b4c3e1
Create Date: 2026-03-23 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4b19c7a2f11'
down_revision: Union[str, Sequence[str], None] = 'd2a6f9b4c3e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('orders', sa.Column('external_id', sa.String(length=100), nullable=True))
    op.add_column('orders', sa.Column('ml_item_id', sa.String(length=50), nullable=True))
    op.add_column('orders', sa.Column('ml_variation_id', sa.String(length=50), nullable=True))
    op.add_column('orders', sa.Column('requested_quantity', sa.Integer(), nullable=True))
    op.add_column('orders', sa.Column('mapping_status', sa.String(length=40), nullable=True))
    op.create_index(op.f('ix_orders_external_id'), 'orders', ['external_id'], unique=False)
    op.create_index(op.f('ix_orders_ml_item_id'), 'orders', ['ml_item_id'], unique=False)
    op.create_index(op.f('ix_orders_ml_variation_id'), 'orders', ['ml_variation_id'], unique=False)
    op.create_index(op.f('ix_orders_mapping_status'), 'orders', ['mapping_status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_orders_mapping_status'), table_name='orders')
    op.drop_index(op.f('ix_orders_ml_variation_id'), table_name='orders')
    op.drop_index(op.f('ix_orders_ml_item_id'), table_name='orders')
    op.drop_index(op.f('ix_orders_external_id'), table_name='orders')
    op.drop_column('orders', 'mapping_status')
    op.drop_column('orders', 'requested_quantity')
    op.drop_column('orders', 'ml_variation_id')
    op.drop_column('orders', 'ml_item_id')
    op.drop_column('orders', 'external_id')