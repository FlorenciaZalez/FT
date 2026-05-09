from datetime import datetime
from pydantic import BaseModel


class OrderReportRow(BaseModel):
    order_id: int
    created_at: datetime
    product_name: str
    customer_name: str | None = None
    shipping_address: str | None = None
    zip_code: str | None = None
    city: str | None = None
    province: str | None = None
    status: str
    carrier: str | None = None
    cordon: str