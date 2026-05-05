"""add shipping categories

Revision ID: e1f2a3b4c5d6
Revises: c9d8e7f6a5b4
Create Date: 2026-05-05 17:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e1f2a3b4c5d6"
down_revision = "c9d8e7f6a5b4"
branch_labels = None
depends_on = None


shipping_category_enum = sa.Enum("A", "B", "C", name="shippingcategory")


def upgrade() -> None:
    bind = op.get_bind()
    shipping_category_enum.create(bind, checkfirst=True)

    op.add_column(
        "clients",
        sa.Column("shipping_category", shipping_category_enum, nullable=False, server_default="A"),
    )
    op.add_column(
        "shipping_rates",
        sa.Column("shipping_category", shipping_category_enum, nullable=False, server_default="A"),
    )

    op.drop_constraint("uq_shipping_rates_cordon", "shipping_rates", type_="unique")
    op.create_unique_constraint(
        "uq_shipping_rates_category_cordon",
        "shipping_rates",
        ["shipping_category", "cordon"],
    )

    shipping_rates = list(bind.execute(sa.text("SELECT cordon, price FROM shipping_rates WHERE shipping_category = 'A'")))
    for category in ("B", "C"):
        for cordon, price in shipping_rates:
            bind.execute(
                sa.text(
                    "INSERT INTO shipping_rates (shipping_category, cordon, price) VALUES (:shipping_category, :cordon, :price)"
                ),
                {"shipping_category": category, "cordon": cordon, "price": price},
            )

    op.alter_column("clients", "shipping_category", server_default=None)
    op.alter_column("shipping_rates", "shipping_category", server_default=None)


def downgrade() -> None:
    op.drop_constraint("uq_shipping_rates_category_cordon", "shipping_rates", type_="unique")
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM shipping_rates WHERE shipping_category IN ('B', 'C')"))
    op.create_unique_constraint("uq_shipping_rates_cordon", "shipping_rates", ["cordon"])
    op.drop_column("shipping_rates", "shipping_category")
    op.drop_column("clients", "shipping_category")
    shipping_category_enum.drop(bind, checkfirst=True)