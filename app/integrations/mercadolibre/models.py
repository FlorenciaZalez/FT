from datetime import datetime
from sqlalchemy import Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class MercadoLibreAccount(Base):
    """Cuenta de Mercado Libre conectada a un cliente del sistema."""
    __tablename__ = "mercadolibre_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    ml_user_id: Mapped[str] = mapped_column(String(50), nullable=False)
    ml_nickname: Mapped[str | None] = mapped_column(String(200))
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str] = mapped_column(Text, nullable=False)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    connected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    client = relationship("Client", back_populates="ml_account")

    def __repr__(self) -> str:
        return f"<MercadoLibreAccount client={self.client_id} ml_user={self.ml_user_id}>"


class MLProductMapping(Base):
    """
    Mapeo entre publicaciones de MercadoLibre y productos internos.
    Un mismo producto puede tener múltiples publicaciones en ML.
    Una publicación+variación apunta siempre a un único SKU interno.
    """
    __tablename__ = "ml_product_mappings"
    __table_args__ = (
        UniqueConstraint(
            "client_id", "ml_item_id", "ml_variation_id",
            name="uq_ml_mapping_item_variation"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    ml_item_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # "MLA123456789"
    ml_variation_id: Mapped[str | None] = mapped_column(String(50))  # Variante (talle, color)
    ml_account_id: Mapped[str | None] = mapped_column(String(50))  # Cuenta ML del cliente
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    client = relationship("Client", back_populates="ml_mappings")
    product = relationship("Product", back_populates="ml_mappings")
    reconciliation_logs = relationship(
        "MLMappingReconciliationLog",
        back_populates="mapping",
        lazy="selectin",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<MLMapping {self.ml_item_id}:{self.ml_variation_id} → product={self.product_id}>"


class MLMappingReconciliationLog(Base):
    __tablename__ = "ml_mapping_reconciliation_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    mapping_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("ml_product_mappings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    mapping = relationship("MLProductMapping", back_populates="reconciliation_logs")

    def __repr__(self) -> str:
        return f"<MLMappingReconciliationLog order={self.order_id} mapping={self.mapping_id}>"
