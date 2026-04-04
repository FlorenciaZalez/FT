"""add_batch_picking_sessions

Revision ID: f2b4c6d8e9a1
Revises: 8f1c2d3e4a5b
Create Date: 2026-03-25 12:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2b4c6d8e9a1'
down_revision: Union[str, Sequence[str], None] = '8f1c2d3e4a5b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'batch_picking_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_batch_picking_sessions_status'), 'batch_picking_sessions', ['status'], unique=False)
    op.create_index(op.f('ix_batch_picking_sessions_user_id'), 'batch_picking_sessions', ['user_id'], unique=False)

    op.create_table(
        'batch_picking_session_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=True),
        sa.Column('product_name', sa.String(length=255), nullable=False),
        sa.Column('sku', sa.String(length=100), nullable=False),
        sa.Column('quantity_total', sa.Integer(), nullable=False),
        sa.Column('quantity_picked', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['session_id'], ['batch_picking_sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_batch_picking_session_items_product_id'), 'batch_picking_session_items', ['product_id'], unique=False)
    op.create_index(op.f('ix_batch_picking_session_items_session_id'), 'batch_picking_session_items', ['session_id'], unique=False)
    op.create_index(op.f('ix_batch_picking_session_items_sku'), 'batch_picking_session_items', ['sku'], unique=False)

    op.create_table(
        'batch_picking_session_assignments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('session_item_id', sa.Integer(), nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=False),
        sa.Column('order_item_id', sa.Integer(), nullable=False),
        sa.Column('order_number', sa.String(length=50), nullable=False),
        sa.Column('location_code', sa.String(length=50), nullable=True),
        sa.Column('quantity_total', sa.Integer(), nullable=False),
        sa.Column('quantity_picked', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['order_item_id'], ['order_items.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['session_item_id'], ['batch_picking_session_items.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('session_item_id', 'order_item_id', name='uq_batch_assignment_session_item_order_item'),
    )
    op.create_index(op.f('ix_batch_picking_session_assignments_order_id'), 'batch_picking_session_assignments', ['order_id'], unique=False)
    op.create_index(op.f('ix_batch_picking_session_assignments_order_item_id'), 'batch_picking_session_assignments', ['order_item_id'], unique=False)
    op.create_index(op.f('ix_batch_picking_session_assignments_session_item_id'), 'batch_picking_session_assignments', ['session_item_id'], unique=False)

    op.create_table(
        'batch_picking_scan_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=False),
        sa.Column('session_item_id', sa.Integer(), nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=False),
        sa.Column('order_item_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('scanned_sku', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['order_item_id'], ['order_items.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['session_id'], ['batch_picking_sessions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['session_item_id'], ['batch_picking_session_items.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_batch_picking_scan_logs_order_id'), 'batch_picking_scan_logs', ['order_id'], unique=False)
    op.create_index(op.f('ix_batch_picking_scan_logs_order_item_id'), 'batch_picking_scan_logs', ['order_item_id'], unique=False)
    op.create_index(op.f('ix_batch_picking_scan_logs_scanned_sku'), 'batch_picking_scan_logs', ['scanned_sku'], unique=False)
    op.create_index(op.f('ix_batch_picking_scan_logs_session_id'), 'batch_picking_scan_logs', ['session_id'], unique=False)
    op.create_index(op.f('ix_batch_picking_scan_logs_session_item_id'), 'batch_picking_scan_logs', ['session_item_id'], unique=False)
    op.create_index(op.f('ix_batch_picking_scan_logs_user_id'), 'batch_picking_scan_logs', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_batch_picking_scan_logs_user_id'), table_name='batch_picking_scan_logs')
    op.drop_index(op.f('ix_batch_picking_scan_logs_session_item_id'), table_name='batch_picking_scan_logs')
    op.drop_index(op.f('ix_batch_picking_scan_logs_session_id'), table_name='batch_picking_scan_logs')
    op.drop_index(op.f('ix_batch_picking_scan_logs_scanned_sku'), table_name='batch_picking_scan_logs')
    op.drop_index(op.f('ix_batch_picking_scan_logs_order_item_id'), table_name='batch_picking_scan_logs')
    op.drop_index(op.f('ix_batch_picking_scan_logs_order_id'), table_name='batch_picking_scan_logs')
    op.drop_table('batch_picking_scan_logs')

    op.drop_index(op.f('ix_batch_picking_session_assignments_session_item_id'), table_name='batch_picking_session_assignments')
    op.drop_index(op.f('ix_batch_picking_session_assignments_order_item_id'), table_name='batch_picking_session_assignments')
    op.drop_index(op.f('ix_batch_picking_session_assignments_order_id'), table_name='batch_picking_session_assignments')
    op.drop_table('batch_picking_session_assignments')

    op.drop_index(op.f('ix_batch_picking_session_items_sku'), table_name='batch_picking_session_items')
    op.drop_index(op.f('ix_batch_picking_session_items_session_id'), table_name='batch_picking_session_items')
    op.drop_index(op.f('ix_batch_picking_session_items_product_id'), table_name='batch_picking_session_items')
    op.drop_table('batch_picking_session_items')

    op.drop_index(op.f('ix_batch_picking_sessions_user_id'), table_name='batch_picking_sessions')
    op.drop_index(op.f('ix_batch_picking_sessions_status'), table_name='batch_picking_sessions')
    op.drop_table('batch_picking_sessions')