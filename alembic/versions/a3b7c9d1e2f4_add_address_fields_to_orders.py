"""add_address_fields_to_orders

Revision ID: a3b7c9d1e2f4
Revises: e0c14f178676
Create Date: 2026-03-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3b7c9d1e2f4'
down_revision: str = 'e0c14f178676'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('orders', sa.Column('address_line', sa.String(500), nullable=True))
    op.add_column('orders', sa.Column('city', sa.String(200), nullable=True))
    op.add_column('orders', sa.Column('state', sa.String(200), nullable=True))
    op.add_column('orders', sa.Column('postal_code', sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column('orders', 'postal_code')
    op.drop_column('orders', 'state')
    op.drop_column('orders', 'city')
    op.drop_column('orders', 'address_line')
