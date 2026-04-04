"""add transport dispatch billing

Revision ID: b1c2d3e4f5a6
Revises: a1b2c3d4e5f6
Create Date: 2026-03-30 19:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "billing_rates",
        sa.Column("transport_dispatch_fee", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )

    op.add_column(
        "charges",
        sa.Column("transport_dispatch_amount", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
    )

    op.add_column(
        "billing_documents",
        sa.Column("transport_dispatch_total", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
    )

    op.create_table(
        "transport_dispatch_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("transportista", sa.String(length=200), nullable=False),
        sa.Column("cantidad_pedidos", sa.Integer(), nullable=False),
        sa.Column("costo_aplicado", sa.Numeric(12, 2), nullable=False),
        sa.Column("fecha", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_transport_dispatch_records_client_id"), "transport_dispatch_records", ["client_id"], unique=False)
    op.create_index(op.f("ix_transport_dispatch_records_fecha"), "transport_dispatch_records", ["fecha"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_transport_dispatch_records_fecha"), table_name="transport_dispatch_records")
    op.drop_index(op.f("ix_transport_dispatch_records_client_id"), table_name="transport_dispatch_records")
    op.drop_table("transport_dispatch_records")

    op.drop_column("billing_documents", "transport_dispatch_total")
    op.drop_column("charges", "transport_dispatch_amount")
    op.drop_column("billing_rates", "transport_dispatch_fee")