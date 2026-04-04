"""add transporter document audit fields

Revision ID: a7c9d1e2f3b4
Revises: f6a8c9d1e2f3
Create Date: 2026-03-26 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7c9d1e2f3b4"
down_revision: Union[str, Sequence[str], None] = "f6a8c9d1e2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("transporters", sa.Column("dni_file_path", sa.String(length=500), nullable=True))
    op.add_column("transporters", sa.Column("dni_file_name", sa.String(length=255), nullable=True))
    op.add_column("transporters", sa.Column("dni_uploaded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transporters", sa.Column("seguro_file_path", sa.String(length=500), nullable=True))
    op.add_column("transporters", sa.Column("seguro_file_name", sa.String(length=255), nullable=True))
    op.add_column("transporters", sa.Column("seguro_uploaded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transporters", sa.Column("cedula_verde_file_path", sa.String(length=500), nullable=True))
    op.add_column("transporters", sa.Column("cedula_verde_file_name", sa.String(length=255), nullable=True))
    op.add_column("transporters", sa.Column("cedula_verde_uploaded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transporters", sa.Column("insurance_expiration_date", sa.Date(), nullable=True))
    op.add_column("transporters", sa.Column("license_expiration_date", sa.Date(), nullable=True))

    op.execute("""
        UPDATE transporters
        SET
            dni_file_path = REPLACE(dni_file_url, '/api/v1/uploads/', ''),
            dni_file_name = split_part(dni_file_url, '/', array_length(string_to_array(dni_file_url, '/'), 1)),
            dni_uploaded_at = created_at,
            seguro_file_path = REPLACE(seguro_file_url, '/api/v1/uploads/', ''),
            seguro_file_name = split_part(seguro_file_url, '/', array_length(string_to_array(seguro_file_url, '/'), 1)),
            seguro_uploaded_at = created_at,
            cedula_verde_file_path = REPLACE(cedula_verde_file_url, '/api/v1/uploads/', ''),
            cedula_verde_file_name = split_part(cedula_verde_file_url, '/', array_length(string_to_array(cedula_verde_file_url, '/'), 1)),
            cedula_verde_uploaded_at = created_at
    """)


def downgrade() -> None:
    op.drop_column("transporters", "license_expiration_date")
    op.drop_column("transporters", "insurance_expiration_date")
    op.drop_column("transporters", "cedula_verde_uploaded_at")
    op.drop_column("transporters", "cedula_verde_file_name")
    op.drop_column("transporters", "cedula_verde_file_path")
    op.drop_column("transporters", "seguro_uploaded_at")
    op.drop_column("transporters", "seguro_file_name")
    op.drop_column("transporters", "seguro_file_path")
    op.drop_column("transporters", "dni_uploaded_at")
    op.drop_column("transporters", "dni_file_name")
    op.drop_column("transporters", "dni_file_path")
