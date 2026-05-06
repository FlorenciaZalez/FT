"""add premium preparation categories

Revision ID: f3a4b5c6d7e8
Revises: e1f2a3b4c5d6
Create Date: 2026-05-05 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, Sequence[str], None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


OLD_PRODUCT_WEIGHT_CATEGORY = postgresql.ENUM("light", "heavy", name="productweightcategory")
NEW_PRODUCT_WEIGHT_CATEGORY = postgresql.ENUM("simple", "intermedio", "premium", name="productweightcategory")


def upgrade() -> None:
    bind = op.get_bind()

    # Check if the enum type already has the new values (idempotency guard)
    result = bind.execute(
        sa.text(
            """
            SELECT EXISTS (
                SELECT 1 FROM pg_enum e
                JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = 'productweightcategory'
                  AND e.enumlabel = 'premium'
            )
            """
        )
    )
    already_migrated = result.scalar()

    if not already_migrated:
        # Remove server default before changing the type
        bind.execute(
            sa.text(
                "ALTER TABLE products ALTER COLUMN weight_category DROP DEFAULT"
            )
        )

        bind.execute(
            sa.text("ALTER TYPE productweightcategory RENAME TO productweightcategory_old")
        )
        NEW_PRODUCT_WEIGHT_CATEGORY.create(bind, checkfirst=True)

        bind.execute(
            sa.text(
                """
                ALTER TABLE products
                ALTER COLUMN weight_category TYPE productweightcategory
                USING (
                    CASE weight_category::text
                        WHEN 'light' THEN 'simple'
                        WHEN 'heavy' THEN 'intermedio'
                        ELSE 'simple'
                    END::productweightcategory
                )
                """
            )
        )
        bind.execute(
            sa.text(
                """
                ALTER TABLE handling_rates
                ALTER COLUMN weight_category TYPE productweightcategory
                USING (
                    CASE weight_category::text
                        WHEN 'light' THEN 'simple'
                        WHEN 'heavy' THEN 'intermedio'
                        ELSE 'simple'
                    END::productweightcategory
                )
                """
            )
        )
        bind.execute(sa.text("DROP TYPE IF EXISTS productweightcategory_old"))

    # Always normalize preparation_type values
    bind.execute(
        sa.text(
            """
            UPDATE products
            SET preparation_type = CASE
                WHEN preparation_type = 'especial' THEN 'intermedio'
                WHEN preparation_type = 'simple' THEN 'simple'
                ELSE COALESCE(preparation_type, 'simple')
            END
            """
        )
    )

    # Insert premium handling rate if not present
    bind.execute(
        sa.text(
            """
            INSERT INTO handling_rates (weight_category, price, created_at, updated_at)
            SELECT 'premium'::productweightcategory, price, now(), now()
            FROM handling_rates
            WHERE weight_category = 'intermedio'::productweightcategory
            AND NOT EXISTS (
                SELECT 1 FROM handling_rates WHERE weight_category = 'premium'::productweightcategory
            )
            LIMIT 1
            """
        )
    )

    # Set server defaults
    bind.execute(
        sa.text(
            "ALTER TABLE products ALTER COLUMN weight_category SET DEFAULT 'simple'::productweightcategory"
        )
    )
    bind.execute(
        sa.text(
            "ALTER TABLE products ALTER COLUMN preparation_type SET DEFAULT 'simple'"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()

    op.alter_column(
        "products",
        "weight_category",
        existing_type=NEW_PRODUCT_WEIGHT_CATEGORY,
        server_default=None,
        existing_nullable=False,
    )

    op.execute("DELETE FROM handling_rates WHERE weight_category = 'premium'::productweightcategory")
    op.execute(
        """
        UPDATE products
        SET preparation_type = CASE
            WHEN preparation_type = 'intermedio' THEN 'especial'
            WHEN preparation_type = 'premium' THEN 'especial'
            ELSE 'simple'
        END
        """
    )

    op.execute("ALTER TYPE productweightcategory RENAME TO productweightcategory_new")
    OLD_PRODUCT_WEIGHT_CATEGORY.create(bind, checkfirst=False)

    op.alter_column(
        "products",
        "weight_category",
        existing_type=NEW_PRODUCT_WEIGHT_CATEGORY,
        type_=OLD_PRODUCT_WEIGHT_CATEGORY,
        existing_nullable=False,
        postgresql_using=(
            "CASE weight_category::text "
            "WHEN 'simple' THEN 'light' "
            "WHEN 'intermedio' THEN 'heavy' "
            "WHEN 'premium' THEN 'heavy' "
            "ELSE 'light' END::productweightcategory"
        ),
    )
    op.alter_column(
        "handling_rates",
        "weight_category",
        existing_type=NEW_PRODUCT_WEIGHT_CATEGORY,
        type_=OLD_PRODUCT_WEIGHT_CATEGORY,
        existing_nullable=False,
        postgresql_using=(
            "CASE weight_category::text "
            "WHEN 'simple' THEN 'light' "
            "WHEN 'intermedio' THEN 'heavy' "
            "WHEN 'premium' THEN 'heavy' "
            "ELSE 'light' END::productweightcategory"
        ),
    )
    op.execute("DROP TYPE productweightcategory_new")

    op.alter_column(
        "products",
        "weight_category",
        existing_type=OLD_PRODUCT_WEIGHT_CATEGORY,
        server_default="light",
        existing_nullable=False,
    )
    op.alter_column(
        "products",
        "preparation_type",
        existing_type=sa.String(length=20),
        server_default="simple",
        existing_nullable=False,
    )