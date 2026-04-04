"""add billing documents and schedules

Revision ID: b8d1e2f3a4c5
Revises: a7c9d1e2f3b4
Create Date: 2026-03-26 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "b8d1e2f3a4c5"
down_revision: Union[str, None] = "a7c9d1e2f3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


billing_document_status = sa.Enum(
    "pending",
    "paid",
    "overdue",
    name="billingdocumentstatus",
)

billing_document_status_column = postgresql.ENUM(
    "pending",
    "paid",
    "overdue",
    name="billingdocumentstatus",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    billing_document_status.create(bind, checkfirst=True)

    op.create_table(
        "billing_schedules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("day_of_month", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id", name="uq_billing_schedule_client_id"),
    )
    op.create_index(op.f("ix_billing_schedules_client_id"), "billing_schedules", ["client_id"], unique=False)

    op.create_table(
        "billing_documents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("storage_total", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("preparation_total", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("shipping_total", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("total", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("status", billing_document_status_column, nullable=False, server_default=sa.text("'pending'::billingdocumentstatus")),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id", "period", name="uq_billing_document_client_period"),
    )
    op.create_index(op.f("ix_billing_documents_client_id"), "billing_documents", ["client_id"], unique=False)
    op.create_index(op.f("ix_billing_documents_period"), "billing_documents", ["period"], unique=False)

    op.execute(
        sa.text(
            """
            INSERT INTO billing_schedules (client_id, day_of_month, active)
            SELECT id, 5, true
            FROM clients
            WHERE NOT EXISTS (
                SELECT 1
                FROM billing_schedules
                WHERE billing_schedules.client_id = clients.id
            )
            """
        )
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_billing_documents_period"), table_name="billing_documents")
    op.drop_index(op.f("ix_billing_documents_client_id"), table_name="billing_documents")
    op.drop_table("billing_documents")
    op.drop_index(op.f("ix_billing_schedules_client_id"), table_name="billing_schedules")
    op.drop_table("billing_schedules")

    bind = op.get_bind()
    billing_document_status.drop(bind, checkfirst=True)