"""add origin to transport dispatch records

Revision ID: c4d5e6f7a8b9
Revises: b1c2d3e4f5a6
Create Date: 2026-03-30 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c4d5e6f7a8b9"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transport_dispatch_records",
        sa.Column("origen", sa.String(length=50), nullable=True),
    )
    op.execute(
        "UPDATE transport_dispatch_records SET origen = 'manual_facturacion' WHERE origen IS NULL"
    )
    op.alter_column("transport_dispatch_records", "origen", nullable=False)


def downgrade() -> None:
    op.drop_column("transport_dispatch_records", "origen")