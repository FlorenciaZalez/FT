"""add label print billing

Revision ID: f1e2d3c4b5a6
Revises: a9b8c7d6e5f4
Create Date: 2026-05-04 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "f1e2d3c4b5a6"
down_revision = "a9b8c7d6e5f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    billing_rate_columns = {column["name"] for column in inspector.get_columns("billing_rates")}
    if "label_print_fee" not in billing_rate_columns:
        op.add_column("billing_rates", sa.Column("label_print_fee", sa.Numeric(12, 2), nullable=True))
        op.execute("UPDATE billing_rates SET label_print_fee = 0 WHERE label_print_fee IS NULL")
        op.alter_column("billing_rates", "label_print_fee", nullable=False)

    charge_columns = {column["name"] for column in inspector.get_columns("charges")}
    if "label_print_amount" not in charge_columns:
        op.add_column("charges", sa.Column("label_print_amount", sa.Numeric(14, 2), nullable=True))
        op.execute("UPDATE charges SET label_print_amount = 0 WHERE label_print_amount IS NULL")
        op.alter_column("charges", "label_print_amount", nullable=False)

    billing_document_columns = {column["name"] for column in inspector.get_columns("billing_documents")}
    if "label_print_total" not in billing_document_columns:
        op.add_column("billing_documents", sa.Column("label_print_total", sa.Numeric(14, 2), nullable=True))
        op.execute("UPDATE billing_documents SET label_print_total = 0 WHERE label_print_total IS NULL")
        op.alter_column("billing_documents", "label_print_total", nullable=False)

    table_names = set(inspector.get_table_names())
    if "label_print_records" not in table_names:
        op.create_table(
            "label_print_records",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("client_id", sa.Integer(), nullable=False),
            sa.Column("order_id", sa.Integer(), nullable=True),
            sa.Column("order_number", sa.String(length=100), nullable=False),
            sa.Column("label_type", sa.String(length=20), nullable=True),
            sa.Column("price_applied", sa.Numeric(12, 2), nullable=False),
            sa.Column("printed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("order_id", name="uq_label_print_record_order_id"),
        )

    existing_indexes = {index["name"] for index in inspector.get_indexes("label_print_records")}
    if op.f("ix_label_print_records_client_id") not in existing_indexes:
        op.create_index(op.f("ix_label_print_records_client_id"), "label_print_records", ["client_id"], unique=False)
    if op.f("ix_label_print_records_order_id") not in existing_indexes:
        op.create_index(op.f("ix_label_print_records_order_id"), "label_print_records", ["order_id"], unique=False)
    if op.f("ix_label_print_records_printed_at") not in existing_indexes:
        op.create_index(op.f("ix_label_print_records_printed_at"), "label_print_records", ["printed_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_label_print_records_printed_at"), table_name="label_print_records")
    op.drop_index(op.f("ix_label_print_records_order_id"), table_name="label_print_records")
    op.drop_index(op.f("ix_label_print_records_client_id"), table_name="label_print_records")
    op.drop_table("label_print_records")
    op.drop_column("billing_documents", "label_print_total")
    op.drop_column("charges", "label_print_amount")
    op.drop_column("billing_rates", "label_print_fee")