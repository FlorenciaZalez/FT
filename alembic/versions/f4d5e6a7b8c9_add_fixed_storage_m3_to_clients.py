"""add fixed storage m3 to clients

Revision ID: f4d5e6a7b8c9
Revises: e1f2a3b4c5d6
Create Date: 2026-07-05 21:20:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f4d5e6a7b8c9"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("clients", sa.Column("fixed_storage_m3", sa.Numeric(14, 3), nullable=True))


def downgrade() -> None:
    op.drop_column("clients", "fixed_storage_m3")