"""add product creation fee

Revision ID: a1b2c3d4e5f6
Revises: f9c1d2e3a4b5
Create Date: 2026-03-30 18:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f9c1d2e3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("alta_cobrada", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.execute("UPDATE products SET alta_cobrada = true")

    op.add_column(
        "billing_rates",
        sa.Column("product_creation_fee", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )

    op.add_column(
        "charges",
        sa.Column("product_creation_amount", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
    )

    op.add_column(
        "billing_documents",
        sa.Column("product_creation_total", sa.Numeric(14, 2), nullable=False, server_default=sa.text("0")),
    )

    op.create_table(
        "product_creation_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=True),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("sku", sa.String(length=100), nullable=False),
        sa.Column("price_applied", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_product_creation_records_client_id"), "product_creation_records", ["client_id"], unique=False)
    op.create_index(op.f("ix_product_creation_records_product_id"), "product_creation_records", ["product_id"], unique=False)
    op.create_index(op.f("ix_product_creation_records_created_at"), "product_creation_records", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_product_creation_records_created_at"), table_name="product_creation_records")
    op.drop_index(op.f("ix_product_creation_records_product_id"), table_name="product_creation_records")
    op.drop_index(op.f("ix_product_creation_records_client_id"), table_name="product_creation_records")
    op.drop_table("product_creation_records")

    op.drop_column("billing_documents", "product_creation_total")
    op.drop_column("charges", "product_creation_amount")
    op.drop_column("billing_rates", "product_creation_fee")
    op.drop_column("products", "alta_cobrada")