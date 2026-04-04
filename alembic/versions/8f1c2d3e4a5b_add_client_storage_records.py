"""add client storage records

Revision ID: 8f1c2d3e4a5b
Revises: 7a9d3c4b5e6f
Create Date: 2026-03-24 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "8f1c2d3e4a5b"
down_revision: Union[str, None] = "7a9d3c4b5e6f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "client_storage_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("storage_m3", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id", "period", name="uq_client_storage_client_period"),
    )
    op.create_index(op.f("ix_client_storage_records_client_id"), "client_storage_records", ["client_id"], unique=False)
    op.create_index(op.f("ix_client_storage_records_period"), "client_storage_records", ["period"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_client_storage_records_period"), table_name="client_storage_records")
    op.drop_index(op.f("ix_client_storage_records_client_id"), table_name="client_storage_records")
    op.drop_table("client_storage_records")