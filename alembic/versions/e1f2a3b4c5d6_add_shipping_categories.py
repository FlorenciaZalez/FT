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

    # Add shipping_category to clients if it doesn't exist
    bind.execute(
        sa.text(
            """
            ALTER TABLE clients
            ADD COLUMN IF NOT EXISTS shipping_category shippingcategory NOT NULL DEFAULT 'A'
            """
        )
    )
    # Add shipping_category to shipping_rates if it doesn't exist
    bind.execute(
        sa.text(
            """
            ALTER TABLE shipping_rates
            ADD COLUMN IF NOT EXISTS shipping_category shippingcategory NOT NULL DEFAULT 'A'
            """
        )
    )

    # Drop old unique constraint if it exists
    bind.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                    WHERE table_name = 'shipping_rates'
                      AND constraint_name = 'uq_shipping_rates_cordon'
                ) THEN
                    ALTER TABLE shipping_rates DROP CONSTRAINT uq_shipping_rates_cordon;
                END IF;
            END $$
            """
        )
    )
    # Create new unique constraint if it doesn't exist
    bind.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                    WHERE table_name = 'shipping_rates'
                      AND constraint_name = 'uq_shipping_rates_category_cordon'
                ) THEN
                    ALTER TABLE shipping_rates
                    ADD CONSTRAINT uq_shipping_rates_category_cordon UNIQUE (shipping_category, cordon);
                END IF;
            END $$
            """
        )
    )

    shipping_rates = list(bind.execute(sa.text("SELECT cordon, price FROM shipping_rates WHERE shipping_category = 'A'")))
    for category in ("B", "C"):
        for cordon, price in shipping_rates:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO shipping_rates (shipping_category, cordon, price)
                    VALUES (:shipping_category, :cordon, :price)
                    ON CONFLICT (shipping_category, cordon) DO NOTHING
                    """
                ),
                {"shipping_category": category, "cordon": cordon, "price": price},
            )

    bind.execute(
        sa.text("ALTER TABLE clients ALTER COLUMN shipping_category DROP DEFAULT")
    )
    bind.execute(
        sa.text("ALTER TABLE shipping_rates ALTER COLUMN shipping_category DROP DEFAULT")
    )


def downgrade() -> None:
    op.drop_constraint("uq_shipping_rates_category_cordon", "shipping_rates", type_="unique")
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM shipping_rates WHERE shipping_category IN ('B', 'C')"))
    op.create_unique_constraint("uq_shipping_rates_cordon", "shipping_rates", ["cordon"])
    op.drop_column("shipping_rates", "shipping_category")
    op.drop_column("clients", "shipping_category")
    shipping_category_enum.drop(bind, checkfirst=True)