"""add_shipping_rules_and_order_costs

Revision ID: d2a6f9b4c3e1
Revises: c1f7b8a9d2e4
Create Date: 2026-03-23 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2a6f9b4c3e1'
down_revision: Union[str, Sequence[str], None] = 'c1f7b8a9d2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'postal_code_ranges',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('cp_from', sa.Integer(), nullable=False),
        sa.Column('cp_to', sa.Integer(), nullable=False),
        sa.Column('cordon', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint('cp_from <= cp_to', name='ck_postal_code_ranges_cp_order'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('cp_from', 'cp_to', 'cordon', name='uq_postal_code_ranges_range_cordon'),
    )
    op.create_index(op.f('ix_postal_code_ranges_cp_from'), 'postal_code_ranges', ['cp_from'], unique=False)
    op.create_index(op.f('ix_postal_code_ranges_cp_to'), 'postal_code_ranges', ['cp_to'], unique=False)
    op.create_index(op.f('ix_postal_code_ranges_cordon'), 'postal_code_ranges', ['cordon'], unique=False)

    op.create_table(
        'shipping_rates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('cordon', sa.String(length=100), nullable=False),
        sa.Column('weight_min', sa.Numeric(10, 3), nullable=False),
        sa.Column('weight_max', sa.Numeric(10, 3), nullable=False),
        sa.Column('price', sa.Numeric(12, 2), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint('weight_min <= weight_max', name='ck_shipping_rates_weight_order'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('cordon', 'weight_min', 'weight_max', name='uq_shipping_rates_cordon_weight_range'),
    )
    op.create_index(op.f('ix_shipping_rates_cordon'), 'shipping_rates', ['cordon'], unique=False)

    op.add_column('orders', sa.Column('cordon', sa.String(length=100), nullable=True))
    op.add_column('orders', sa.Column('shipping_cost', sa.Numeric(12, 2), nullable=True))
    op.add_column('orders', sa.Column('shipping_status', sa.String(length=40), nullable=True))
    op.create_index(op.f('ix_orders_cordon'), 'orders', ['cordon'], unique=False)
    op.create_index(op.f('ix_orders_shipping_status'), 'orders', ['shipping_status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_orders_shipping_status'), table_name='orders')
    op.drop_index(op.f('ix_orders_cordon'), table_name='orders')
    op.drop_column('orders', 'shipping_status')
    op.drop_column('orders', 'shipping_cost')
    op.drop_column('orders', 'cordon')
    op.drop_index(op.f('ix_shipping_rates_cordon'), table_name='shipping_rates')
    op.drop_table('shipping_rates')
    op.drop_index(op.f('ix_postal_code_ranges_cordon'), table_name='postal_code_ranges')
    op.drop_index(op.f('ix_postal_code_ranges_cp_to'), table_name='postal_code_ranges')
    op.drop_index(op.f('ix_postal_code_ranges_cp_from'), table_name='postal_code_ranges')
    op.drop_table('postal_code_ranges')