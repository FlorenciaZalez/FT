"""update transporters documents

Revision ID: 7c2d4e6f8a9b
Revises: 6a1b2c3d4e5f
Create Date: 2026-03-25 18:45:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7c2d4e6f8a9b"
down_revision: Union[str, Sequence[str], None] = "6a1b2c3d4e5f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("transporters", sa.Column("domicilio", sa.String(length=255), nullable=True))
    op.add_column("transporters", sa.Column("dni_file_url", sa.String(length=500), nullable=True))
    op.add_column("transporters", sa.Column("seguro_file_url", sa.String(length=500), nullable=True))
    op.add_column("transporters", sa.Column("cedula_verde_file_url", sa.String(length=500), nullable=True))
    op.drop_column("transporters", "type")
    sa.Enum(name="transportertype").drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    transportertype = sa.Enum("camioneta", "moto", "correo", name="transportertype")
    transportertype.create(op.get_bind(), checkfirst=True)
    op.add_column("transporters", sa.Column("type", transportertype, nullable=True))
    op.drop_column("transporters", "cedula_verde_file_url")
    op.drop_column("transporters", "seguro_file_url")
    op.drop_column("transporters", "dni_file_url")
    op.drop_column("transporters", "domicilio")