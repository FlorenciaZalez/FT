from datetime import date, datetime

from pydantic import BaseModel, Field

from app.billing.models import BillingDocumentStatus, ChargeStatus


class BillingRatesUpdate(BaseModel):
    storage_per_m3: float = Field(ge=0)
    preparation_base_fee: float = Field(ge=0, default=0)
    preparation_additional_fee: float = Field(ge=0, default=0)
    product_creation_fee: float = Field(ge=0, default=0)
    label_print_fee: float = Field(ge=0, default=0)
    transport_dispatch_fee: float = Field(ge=0, default=0)
    truck_unloading_fee: float = Field(ge=0, default=0)
    shipping_base: float = Field(ge=0, default=0)


class BillingRatesResponse(BillingRatesUpdate):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True


class PreparationRecordResponse(BaseModel):
    id: int
    client_id: int
    client_name: str | None = None
    order_id: int | None
    product_id: int | None
    order_item_id: int | None
    cantidad_items: int
    precio_base: float
    precio_adicional: float
    total: float
    preparation_type: str
    price_applied: float
    recorded_at: datetime

    class Config:
        orm_mode = True


class ClientRatesUpdate(BaseModel):
    storage_discount_pct: float | None = Field(default=None, ge=0, le=100)
    shipping_discount_pct: float | None = Field(default=None, ge=0, le=100)


class ClientRatesResponse(BaseModel):
    id: int | None = None
    client_id: int
    client_name: str
    storage_discount_pct: float | None = None
    shipping_discount_pct: float | None = None
    effective_storage_per_m3: float
    effective_shipping_base: float
    effective_storage_discount_pct: float
    effective_shipping_discount_pct: float


class BillingPreviewItem(BaseModel):
    client_id: int
    client_name: str
    period: str
    total_m3: float
    total_orders: int
    storage_base_rate: float
    storage_discount_pct: float
    storage_rate: float
    preparation_base_rate: float
    preparation_discount_pct: float
    preparation_rate: float
    shipping_base_amount: float
    shipping_discount_pct: float
    storage_amount: float
    preparation_amount: float
    product_creation_amount: float
    product_creation_products: list[str] = []
    label_print_amount: float
    label_print_count: int = 0
    transport_dispatch_amount: float
    transport_dispatch_count: int = 0
    transport_dispatch_transporters: list[str] = []
    truck_unloading_amount: float
    truck_unloading_count: int = 0
    manual_charge_amount: float
    manual_charge_items: list[dict] = []
    shipping_amount: float
    total: float
    missing_storage: bool


class ClientStorageRecordBase(BaseModel):
    period: str = Field(regex=r"^\d{4}-\d{2}$")
    storage_m3: float = Field(gt=0)


class ClientStorageRecordCreate(ClientStorageRecordBase):
    client_id: int = Field(ge=1)


class ClientStorageRecordUpdate(BaseModel):
    storage_m3: float = Field(gt=0)


class ClientStorageRecordResponse(BaseModel):
    id: int
    client_id: int
    client_name: str
    period: str
    storage_m3: float
    created_at: datetime
    updated_at: datetime


class ChargeResponse(BaseModel):
    id: int
    client_id: int
    client_name: str | None = None
    period: str
    total_m3: float
    total_orders: int
    base_storage_rate: float
    storage_discount_pct: float
    applied_storage_rate: float
    base_preparation_rate: float
    preparation_discount_pct: float
    applied_preparation_rate: float
    applied_shipping_base: float
    applied_shipping_multiplier: float
    shipping_base_amount: float
    shipping_discount_pct: float
    storage_amount: float
    preparation_amount: float
    product_creation_amount: float
    label_print_amount: float
    transport_dispatch_amount: float
    truck_unloading_amount: float
    manual_charge_amount: float
    shipping_amount: float
    total: float
    status: ChargeStatus
    due_date: date
    created_at: datetime
    updated_at: datetime


class GenerateChargesRequest(BaseModel):
    period: str = Field(regex=r"^\d{4}-\d{2}$")
    due_date: date | None = None
    overwrite: bool = True


class GenerateChargesResponse(BaseModel):
    period: str
    generated_count: int
    total_amount: float
    charges: list[ChargeResponse]


class BillingScheduleUpsert(BaseModel):
    day_of_month: int = Field(ge=1, le=31)
    active: bool = True


class BillingScheduleResponse(BaseModel):
    id: int
    client_id: int
    client_name: str
    day_of_month: int
    active: bool
    created_at: datetime
    updated_at: datetime


class BillingDocumentResponse(BaseModel):
    id: int
    client_id: int
    client_name: str
    period: str
    storage_total: float
    preparation_total: float
    product_creation_total: float
    label_print_total: float
    transport_dispatch_total: float
    truck_unloading_total: float
    manual_charge_total: float
    shipping_total: float
    total: float
    status: BillingDocumentStatus
    due_date: date
    created_at: datetime
    updated_at: datetime


class GenerateBillingDocumentsRequest(BaseModel):
    period: str = Field(regex=r"^\d{4}-\d{2}$")
    overwrite: bool = True


class GenerateBillingDocumentsResponse(BaseModel):
    period: str
    generated_count: int
    total_amount: float
    documents: list[BillingDocumentResponse]


class BillingAlertsResponse(BaseModel):
    due_soon_count: int
    due_soon_days: int
    overdue_count: int
    due_soon_documents: list[BillingDocumentResponse]
    overdue_documents: list[BillingDocumentResponse]


class ProductCreationRecordResponse(BaseModel):
    id: int
    client_id: int
    client_name: str | None = None
    product_id: int | None
    product_name: str
    sku: str
    price_applied: float
    created_at: datetime

    class Config:
        orm_mode = True


class TransportDispatchRecordResponse(BaseModel):
    id: int
    client_id: int
    client_name: str | None = None
    transportista: str
    cantidad_pedidos: int
    origen: str
    costo_aplicado: float
    fecha: datetime

    class Config:
        orm_mode = True


class TransportDispatchRecordCreate(BaseModel):
    client_id: int = Field(ge=1)
    fecha: date
    transportista: str = Field(min_length=1, max_length=200)
    cantidad_pedidos: int = Field(ge=1)


class MerchandiseReceptionRecordResponse(BaseModel):
    id: int
    client_id: int
    client_name: str | None = None
    fecha: datetime
    cantidad_camiones: int
    observaciones: str | None = None
    costo_unitario: float
    costo_total: float
    created_at: datetime

    class Config:
        orm_mode = True


class MerchandiseReceptionRecordCreate(BaseModel):
    client_id: int = Field(ge=1)
    fecha: date
    cantidad_camiones: int = Field(ge=1, default=1)
    observaciones: str | None = Field(default=None, max_length=500)


class ManualChargeResponse(BaseModel):
    id: int
    client_id: int
    client_name: str | None = None
    monto: float
    descripcion: str | None = None
    tipo: str | None = None
    fecha: datetime
    periodo: str
    created_at: datetime
    is_locked: bool = False

    class Config:
        orm_mode = True


class ManualChargeCreate(BaseModel):
    client_id: int = Field(ge=1)
    monto: float
    descripcion: str | None = Field(default=None, max_length=500)
    tipo: str | None = Field(default=None, max_length=50)
    fecha: date
    periodo: str = Field(regex=r"^\d{4}-\d{2}$")
