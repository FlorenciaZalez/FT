"""add operational contact to clients

Revision ID: 6a1b2c3d4e5f
Revises: 5d8f7c1b2a3e
Create Date: 2026-03-25 18:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "6a1b2c3d4e5f"
down_revision: Union[str, Sequence[str], None] = "5d8f7c1b2a3e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("clients", sa.Column("contact_name", sa.String(length=120), nullable=True))
    op.add_column("clients", sa.Column("contact_phone_operational", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("clients", "contact_phone_operational")
    op.drop_column("clients", "contact_name")