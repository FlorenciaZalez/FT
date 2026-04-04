"""add_ml_mapping_reconciliation_logs

Revision ID: 7a9d3c4b5e6f
Revises: e4b19c7a2f11
Create Date: 2026-03-24 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7a9d3c4b5e6f'
down_revision: Union[str, Sequence[str], None] = 'e4b19c7a2f11'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ml_mapping_reconciliation_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=False),
        sa.Column('mapping_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['mapping_id'], ['ml_product_mappings.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_ml_mapping_reconciliation_logs_mapping_id'), 'ml_mapping_reconciliation_logs', ['mapping_id'], unique=False)
    op.create_index(op.f('ix_ml_mapping_reconciliation_logs_order_id'), 'ml_mapping_reconciliation_logs', ['order_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_ml_mapping_reconciliation_logs_order_id'), table_name='ml_mapping_reconciliation_logs')
    op.drop_index(op.f('ix_ml_mapping_reconciliation_logs_mapping_id'), table_name='ml_mapping_reconciliation_logs')
    op.drop_table('ml_mapping_reconciliation_logs')