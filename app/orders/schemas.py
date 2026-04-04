from pydantic import BaseModel
from datetime import datetime


# ── Create / Manual order ──
class OrderItemCreate(BaseModel):
    product_id: int
    quantity: int


class OrderCreate(BaseModel):
    client_id: int | None = None
    source: str = "manual"
    operation_type: str = "sale"
    source_order_id: str | None = None
    external_id: str | None = None
    shipping_id: str | None = None
    ml_item_id: str | None = None
    variation_id: str | None = None
    quantity: int | None = None
    zip_code: str | None = None
    buyer_name: str | None = None
    buyer_address: str | None = None
    address_line: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    address_reference: str | None = None
    shipping_label_url: str | None = None
    notes: str | None = None
    items: list[OrderItemCreate] = []
    delivery_items: list[OrderItemCreate] = []
    return_items: list[OrderItemCreate] = []


class OrderUpdate(BaseModel):
    external_id: str | None = None
    shipping_id: str | None = None
    ml_item_id: str | None = None
    variation_id: str | None = None
    quantity: int | None = None
    zip_code: str | None = None
    buyer_name: str | None = None
    buyer_address: str | None = None
    address_line: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    address_reference: str | None = None
    shipping_label_url: str | None = None
    notes: str | None = None
    items: list[OrderItemCreate] | None = None


# ── Picking ──
class PickItemRequest(BaseModel):
    order_item_id: int
    scanned_sku: str


class PickBySkuRequest(BaseModel):
    sku: str


class BatchPickingScanRequest(BaseModel):
    sku: str


class MarkAwaitingReturnRequest(BaseModel):
    notes: str | None = None


class ReturnReceiveRequest(BaseModel):
    order_id: int
    sku: str
    condition: str
    notes: str | None = None


# ── Responses ──
class OrderItemResponse(BaseModel):
    id: int
    product_id: int
    sku: str
    product_name: str | None = None
    product_image_url: str | None = None
    quantity: int
    picked_quantity: int
    location_code: str | None

    class Config:
        orm_mode = True


class OrderStatusLogResponse(BaseModel):
    id: int
    old_status: str | None
    new_status: str
    changed_by: int | None
    notes: str | None
    created_at: datetime

    class Config:
        orm_mode = True


class ReturnReceptionResponse(BaseModel):
    id: int
    order_item_id: int
    sku: str
    quantity: int
    condition: str
    notes: str | None
    stock_location_code: str | None = None
    received_by: int | None
    received_by_name: str | None = None
    received_at: datetime


class OrderResponse(BaseModel):
    id: int
    client_id: int
    client_name: str | None = None
    order_number: str
    source: str
    source_order_id: str | None
    external_id: str | None = None
    shipping_id: str | None = None
    ml_item_id: str | None = None
    variation_id: str | None = None
    requested_quantity: int | None = None
    mapping_status: str | None = None
    operation_type: str
    display_operation_type: str
    exchange_id: str | None = None
    status: str
    shipping_label_url: str | None
    tracking_number: str | None
    label_printed: bool
    label_printed_at: datetime | None = None
    label_print_count: int
    label_generated: bool
    label_generated_at: datetime | None = None
    label_type: str | None = None
    buyer_name: str | None
    buyer_address: str | None
    address_line: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    cordon: str | None = None
    shipping_cost: float | None = None
    shipping_status: str | None = None
    address_reference: str | None = None
    notes: str | None
    assigned_operator_id: int | None
    picked_at: datetime | None
    packed_at: datetime | None
    dispatched_at: datetime | None
    cancelled_at: datetime | None
    created_at: datetime
    updated_at: datetime
    items: list[OrderItemResponse] = []
    return_receptions: list[ReturnReceptionResponse] = []

    class Config:
        orm_mode = True


class AssignOperatorRequest(BaseModel):
    operator_id: int


class BatchDispatchRequest(BaseModel):
    order_ids: list[int]
    carrier: str | None = None
    transporter_id: int | None = None
    notes: str | None = None
    register_transport_transfer: bool = False


class ResolveMarketplaceOrderRequest(BaseModel):
    product_id: int


class BatchPickingAssignmentResponse(BaseModel):
    id: int
    order_id: int
    order_item_id: int
    order_number: str
    location_code: str | None = None
    quantity_total: int
    quantity_picked: int
    is_complete: bool


class BatchPickingSessionItemResponse(BaseModel):
    id: int
    product_id: int | None = None
    product_name: str
    sku: str
    quantity_total: int
    quantity_picked: int
    location_codes: list[str] = []
    is_complete: bool
    pending_assignments: list[BatchPickingAssignmentResponse] = []


class BatchPickingSessionResponse(BaseModel):
    id: int
    status: str
    user_id: int | None = None
    user_name: str | None = None
    created_at: datetime
    completed_at: datetime | None = None
    total_units: int
    picked_units: int
    is_complete: bool
    items: list[BatchPickingSessionItemResponse] = []


class BatchPickingScanResponse(BaseModel):
    success: bool
    scanned_sku: str
    assigned_order_id: int
    assigned_order_number: str
    item_picked: int
    item_total: int
    sku_completed: bool
    session_completed: bool
    session: BatchPickingSessionResponse
