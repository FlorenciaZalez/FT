"""add_billing_module

Revision ID: c1f7b8a9d2e4
Revises: b4c8d2e3f5a6, a3b7c9d1e2f4, f18c087d9f2b, b90bf512090e, 4924bea2d9c9, b23c2499ad8d, a3c005e64767, 9e996b729073, 4f8df70d2b78, 65c4594e200d, e0c14f178676, eb873c795b36
Create Date: 2026-03-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c1f7b8a9d2e4'
down_revision: Union[str, Sequence[str], None] = (
    'b4c8d2e3f5a6',
    'a3b7c9d1e2f4',
    'f18c087d9f2b',
    'b90bf512090e',
    '4924bea2d9c9',
    'b23c2499ad8d',
    'a3c005e64767',
    '9e996b729073',
    '4f8df70d2b78',
    '65c4594e200d',
    'e0c14f178676',
    'eb873c795b36',
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    charge_status = postgresql.ENUM('pending', 'paid', 'cancelled', name='chargestatus', create_type=False)
    charge_status.create(op.get_bind(), checkfirst=True)

    op.add_column('products', sa.Column('volume_m3', sa.Numeric(12, 4), nullable=True))

    op.create_table(
        'billing_rates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('storage_per_m3', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('picking_per_order', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('shipping_base', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'client_rates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('client_id', sa.Integer(), nullable=False),
        sa.Column('storage_per_m3', sa.Numeric(12, 2), nullable=True),
        sa.Column('picking_per_order', sa.Numeric(12, 2), nullable=True),
        sa.Column('shipping_multiplier', sa.Numeric(12, 4), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('client_id', name='uq_client_rates_client_id'),
    )
    op.create_index(op.f('ix_client_rates_client_id'), 'client_rates', ['client_id'], unique=False)

    op.create_table(
        'charges',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('client_id', sa.Integer(), nullable=False),
        sa.Column('period', sa.String(length=7), nullable=False),
        sa.Column('total_m3', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('total_orders', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('applied_storage_rate', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('applied_picking_rate', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('applied_shipping_base', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('applied_shipping_multiplier', sa.Numeric(12, 4), nullable=False, server_default='1'),
        sa.Column('storage_amount', sa.Numeric(14, 2), nullable=False, server_default='0'),
        sa.Column('picking_amount', sa.Numeric(14, 2), nullable=False, server_default='0'),
        sa.Column('shipping_amount', sa.Numeric(14, 2), nullable=False, server_default='0'),
        sa.Column('total', sa.Numeric(14, 2), nullable=False, server_default='0'),
        sa.Column('status', charge_status, nullable=False, server_default='pending'),
        sa.Column('due_date', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('client_id', 'period', name='uq_charge_client_period'),
    )
    op.create_index(op.f('ix_charges_client_id'), 'charges', ['client_id'], unique=False)
    op.create_index(op.f('ix_charges_period'), 'charges', ['period'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_charges_period'), table_name='charges')
    op.drop_index(op.f('ix_charges_client_id'), table_name='charges')
    op.drop_table('charges')
    op.drop_index(op.f('ix_client_rates_client_id'), table_name='client_rates')
    op.drop_table('client_rates')
    op.drop_table('billing_rates')
    op.drop_column('products', 'volume_m3')
    sa.Enum(name='chargestatus').drop(op.get_bind(), checkfirst=True)