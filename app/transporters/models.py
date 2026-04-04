import enum
from datetime import date, datetime
from sqlalchemy import String, Boolean, DateTime, Date, Enum, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class TransporterZone(str, enum.Enum):
    caba = "CABA"
    gba = "GBA"
    interior = "Interior"


class Transporter(Base):
    __tablename__ = "transporters"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    zone: Mapped[TransporterZone | None] = mapped_column(Enum(TransporterZone), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    domicilio: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dni_file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    dni_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dni_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dni_file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    seguro_file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    seguro_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    seguro_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    seguro_file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cedula_verde_file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cedula_verde_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cedula_verde_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cedula_verde_file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    insurance_expiration_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    license_expiration_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<Transporter {self.name} [{'active' if self.active else 'inactive'}]>"
