"""
Importa todos los modelos para que SQLAlchemy y Alembic los detecten.
"""
from app.clients.models import Client  # noqa: F401
from app.auth.models import User  # noqa: F401
from app.products.models import Product  # noqa: F401
from app.locations.models import WarehouseLocation  # noqa: F401
from app.stock.models import Stock  # noqa: F401
from app.stock.movement_models import StockMovement  # noqa: F401
from app.orders.models import (  # noqa: F401
	Order,
	OrderItem,
	OrderStatusLog,
	DispatchBatch,
	DispatchVerification,
	BatchPickingSession,
	BatchPickingSessionItem,
	BatchPickingSessionAssignment,
	BatchPickingScanLog,
)
from app.alerts.models import Alert  # noqa: F401
from app.integrations.mercadolibre.models import MLProductMapping, MercadoLibreAccount, MLMappingReconciliationLog  # noqa: F401
from app.transporters.models import Transporter  # noqa: F401
from app.billing.models import (  # noqa: F401
	BillingRates,
	ClientRates,
	ClientStorageRecord,
	Charge,
	MerchandiseReceptionRecord,
	ProductCreationRecord,
	LabelPrintRecord,
	TransportDispatchRecord,
	BillingDocument,
	BillingSchedule,
)
from app.shipping.models import PostalCodeRange, ShippingRate  # noqa: F401
