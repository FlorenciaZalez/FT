"""add accumulated m3 to billing records

Revision ID: fa4c6e8b1d2f
Revises: f3a4b5c6d7e8
Create Date: 2026-05-28 12:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "fa4c6e8b1d2f"
down_revision: Union[str, Sequence[str], None] = "f3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "charges",
        sa.Column("accumulated_m3", sa.Numeric(14, 3), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "billing_documents",
        sa.Column("accumulated_m3", sa.Numeric(14, 3), nullable=False, server_default=sa.text("0")),
    )

    op.execute(
        """
        UPDATE charges
        SET accumulated_m3 = total_m3
        WHERE accumulated_m3 = 0
        """
    )
    op.execute(
        """
        UPDATE billing_documents AS documents
        SET accumulated_m3 = charges.accumulated_m3
        FROM charges
        WHERE charges.client_id = documents.client_id
          AND charges.period = documents.period
          AND documents.accumulated_m3 = 0
        """
    )

    op.alter_column("charges", "accumulated_m3", server_default=None)
    op.alter_column("billing_documents", "accumulated_m3", server_default=None)


def downgrade() -> None:
    op.drop_column("billing_documents", "accumulated_m3")
    op.drop_column("charges", "accumulated_m3")
