import enum
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Enum, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class PlanType(str, enum.Enum):
    basic = "basic"
    professional = "professional"
    enterprise = "enterprise"


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    business_name: Mapped[str | None] = mapped_column(String(200))
    tax_id: Mapped[str | None] = mapped_column(String(20), unique=True)  # CUIT
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_phone: Mapped[str | None] = mapped_column(String(50))
    contact_name: Mapped[str | None] = mapped_column(String(120))
    contact_phone_operational: Mapped[str | None] = mapped_column(String(50))
    plan: Mapped[PlanType] = mapped_column(
        Enum(PlanType), default=PlanType.basic, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    variable_storage_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    users = relationship("User", back_populates="client", lazy="selectin")
    products = relationship("Product", back_populates="client", lazy="selectin")
    orders = relationship("Order", back_populates="client", lazy="selectin")
    stock_entries = relationship("Stock", back_populates="client", lazy="selectin")
    alerts = relationship("Alert", back_populates="client", lazy="selectin")
    ml_mappings = relationship("MLProductMapping", back_populates="client", lazy="selectin")
    ml_account = relationship("MercadoLibreAccount", back_populates="client", uselist=False, lazy="selectin")
    storage_records = relationship("ClientStorageRecord", back_populates="client", lazy="selectin", cascade="all, delete-orphan")
    billing_schedule = relationship(
        "BillingSchedule",
        back_populates="client",
        uselist=False,
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    billing_documents = relationship(
        "BillingDocument",
        back_populates="client",
        lazy="selectin",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Client {self.id}: {self.name}>"
