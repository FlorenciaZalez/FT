"""add fixed storage amount to clients

Revision ID: a6b7c8d9e0f1
Revises: f4d5e6a7b8c9
Create Date: 2026-07-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "a6b7c8d9e0f1"
down_revision = "f4d5e6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("clients", sa.Column("fixed_storage_amount", sa.Numeric(14, 2), nullable=True))
    op.execute(
        """
        UPDATE clients
        SET variable_storage_enabled = FALSE,
            fixed_storage_amount = 25000.00
        WHERE LOWER(name) LIKE '%emilio%'
          AND fixed_storage_amount IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("clients", "fixed_storage_amount")
