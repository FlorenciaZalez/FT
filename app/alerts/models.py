import enum
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Text, ForeignKey, Enum, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class AlertType(str, enum.Enum):
    low_stock = "low_stock"
    no_stock = "no_stock"
    pending_timeout = "pending_timeout"              # Pedido pendiente > umbral
    prepared_not_dispatched = "prepared_not_dispatched"  # Preparado pero no despachado
    picking_error = "picking_error"


class AlertSeverity(str, enum.Enum):
    info = "info"
    warning = "warning"
    critical = "critical"


class AlertTargetRole(str, enum.Enum):
    admin = "admin"
    operator = "operator"
    client = "client"


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int | None] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), index=True
    )
    alert_type: Mapped[AlertType] = mapped_column(
        Enum(AlertType), nullable=False, index=True
    )
    severity: Mapped[AlertSeverity] = mapped_column(
        Enum(AlertSeverity), default=AlertSeverity.warning, nullable=False
    )
    target_role: Mapped[AlertTargetRole] = mapped_column(
        Enum(AlertTargetRole), default=AlertTargetRole.admin, nullable=False,
        server_default="admin",
    )
    reference_type: Mapped[str | None] = mapped_column(String(50))   # "product", "order"
    reference_id: Mapped[int | None] = mapped_column()
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    client = relationship("Client", back_populates="alerts")

    def __repr__(self) -> str:
        return f"<Alert {self.alert_type} [{self.severity}] → {self.target_role}>"
