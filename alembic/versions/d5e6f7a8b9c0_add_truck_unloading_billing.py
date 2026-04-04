"""add truck unloading billing

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-03-30 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "d5e6f7a8b9c0"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("billing_rates", sa.Column("truck_unloading_fee", sa.Numeric(12, 2), nullable=True))
    op.execute("UPDATE billing_rates SET truck_unloading_fee = 0 WHERE truck_unloading_fee IS NULL")
    op.alter_column("billing_rates", "truck_unloading_fee", nullable=False)

    op.add_column("charges", sa.Column("truck_unloading_amount", sa.Numeric(14, 2), nullable=True))
    op.execute("UPDATE charges SET truck_unloading_amount = 0 WHERE truck_unloading_amount IS NULL")
    op.alter_column("charges", "truck_unloading_amount", nullable=False)

    op.add_column("billing_documents", sa.Column("truck_unloading_total", sa.Numeric(14, 2), nullable=True))
    op.execute("UPDATE billing_documents SET truck_unloading_total = 0 WHERE truck_unloading_total IS NULL")
    op.alter_column("billing_documents", "truck_unloading_total", nullable=False)

    op.create_table(
        "merchandise_reception_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("fecha", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cantidad_camiones", sa.Integer(), nullable=False),
        sa.Column("observaciones", sa.String(length=500), nullable=True),
        sa.Column("costo_unitario", sa.Numeric(12, 2), nullable=False),
        sa.Column("costo_total", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_merchandise_reception_records_client_id"), "merchandise_reception_records", ["client_id"], unique=False)
    op.create_index(op.f("ix_merchandise_reception_records_fecha"), "merchandise_reception_records", ["fecha"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_merchandise_reception_records_fecha"), table_name="merchandise_reception_records")
    op.drop_index(op.f("ix_merchandise_reception_records_client_id"), table_name="merchandise_reception_records")
    op.drop_table("merchandise_reception_records")
    op.drop_column("billing_documents", "truck_unloading_total")
    op.drop_column("charges", "truck_unloading_amount")
    op.drop_column("billing_rates", "truck_unloading_fee")