"""add_target_role_to_alerts

Revision ID: e0c14f178676
Revises: 9e996b729073
Create Date: 2026-03-20 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e0c14f178676'
down_revision: Union[str, None] = '1c49a8f0fad6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum type first
    alert_target_role = sa.Enum('admin', 'operator', 'client', name='alerttargetrole')
    alert_target_role.create(op.get_bind(), checkfirst=True)

    op.add_column(
        'alerts',
        sa.Column(
            'target_role',
            alert_target_role,
            nullable=False,
            server_default='admin',
        ),
    )


def downgrade() -> None:
    op.drop_column('alerts', 'target_role')
    sa.Enum(name='alerttargetrole').drop(op.get_bind(), checkfirst=True)
