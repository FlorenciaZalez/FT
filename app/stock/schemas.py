from pydantic import BaseModel, Field
from datetime import datetime


# ── Simplified requests (no location needed) ──

class StockInRequest(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    reason: str | None = None


class StockOutRequest(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    reason: str | None = None


# ── List item for the stock table ──

class StockListItem(BaseModel):
    product_id: int
    product_name: str
    sku: str
    client_id: int
    client_name: str
    quantity: int
    quantity_total: int
    quantity_reserved: int
    quantity_available: int
    min_stock_alert: int


# ── Original detailed schemas (kept for advanced use) ──

class StockInboundRequest(BaseModel):
    product_id: int
    location_id: int
    quantity: int
    notes: str | None = None


class StockAdjustRequest(BaseModel):
    product_id: int
    location_id: int
    new_quantity: int
    notes: str | None = None


class StockResponse(BaseModel):
    id: int
    client_id: int
    product_id: int
    location_id: int
    quantity_total: int
    quantity_reserved: int
    quantity_available: int
    min_stock_alert: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class StockSummaryItem(BaseModel):
    product_id: int
    product_name: str
    sku: str
    location_code: str
    quantity_total: int
    quantity_reserved: int
    quantity_available: int
    min_stock_alert: int


class StockMovementResponse(BaseModel):
    id: int
    client_id: int
    product_id: int
    movement_type: str
    quantity: int
    reference_type: str
    reference_id: int | None
    performed_by: int | None = None
    performed_by_name: str | None = None
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
