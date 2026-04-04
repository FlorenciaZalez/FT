"""add manual charges

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-03-30 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "f7a8b9c0d1e2"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("charges", sa.Column("manual_charge_amount", sa.Numeric(14, 2), nullable=True))
    op.execute("UPDATE charges SET manual_charge_amount = 0 WHERE manual_charge_amount IS NULL")
    op.alter_column("charges", "manual_charge_amount", nullable=False)

    op.add_column("billing_documents", sa.Column("manual_charge_total", sa.Numeric(14, 2), nullable=True))
    op.execute("UPDATE billing_documents SET manual_charge_total = 0 WHERE manual_charge_total IS NULL")
    op.alter_column("billing_documents", "manual_charge_total", nullable=False)

    op.create_table(
        "manual_charges",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("monto", sa.Numeric(14, 2), nullable=False),
        sa.Column("descripcion", sa.String(length=500), nullable=True),
        sa.Column("tipo", sa.String(length=50), nullable=True),
        sa.Column("fecha", sa.DateTime(timezone=True), nullable=False),
        sa.Column("periodo", sa.String(length=7), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_manual_charges_client_id"), "manual_charges", ["client_id"], unique=False)
    op.create_index(op.f("ix_manual_charges_fecha"), "manual_charges", ["fecha"], unique=False)
    op.create_index(op.f("ix_manual_charges_periodo"), "manual_charges", ["periodo"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_manual_charges_periodo"), table_name="manual_charges")
    op.drop_index(op.f("ix_manual_charges_fecha"), table_name="manual_charges")
    op.drop_index(op.f("ix_manual_charges_client_id"), table_name="manual_charges")
    op.drop_table("manual_charges")
    op.drop_column("billing_documents", "manual_charge_total")
    op.drop_column("charges", "manual_charge_amount")