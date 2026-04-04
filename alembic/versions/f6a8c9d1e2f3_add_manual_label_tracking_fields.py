"""add manual label tracking fields

Revision ID: f6a8c9d1e2f3
Revises: e5f7a9b1c2d3
Create Date: 2026-03-26 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f6a8c9d1e2f3"
down_revision: Union[str, None] = "e5f7a9b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("label_generated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("orders", sa.Column("label_generated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("orders", sa.Column("label_type", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "label_type")
    op.drop_column("orders", "label_generated_at")
    op.drop_column("orders", "label_generated")
