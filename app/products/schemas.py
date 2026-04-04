from datetime import datetime
from typing import Literal

from pydantic import BaseModel


WeightCategory = Literal["light", "heavy"]
PreparationType = Literal["simple", "especial"]


class ProductCreate(BaseModel):
    name: str
    sku: str
    client_id: int | None = None
    ml_item_reference: str | None = None
    barcode: str | None = None
    description: str | None = None
    weight_kg: float | None = None
    preparation_type: PreparationType = "simple"
    width_cm: float | None = None
    height_cm: float | None = None
    depth_cm: float | None = None
    volume_m3: float | None = None
    image_url: str | None = None
    location_id: int | None = None


class ProductUpdate(BaseModel):
    name: str | None = None
    sku: str | None = None
    ml_item_reference: str | None = None
    barcode: str | None = None
    description: str | None = None
    weight_kg: float | None = None
    preparation_type: PreparationType | None = None
    width_cm: float | None = None
    height_cm: float | None = None
    depth_cm: float | None = None
    volume_m3: float | None = None
    image_url: str | None = None
    location_id: int | None = None
    is_active: bool | None = None


class ProductResponse(BaseModel):
    id: int
    client_id: int
    name: str
    sku: str
    has_ml_mapping: bool = False
    ml_item_id: str | None = None
    barcode: str | None
    description: str | None
    weight_kg: float | None
    preparation_type: PreparationType
    weight_category: WeightCategory
    alta_cobrada: bool
    width_cm: float | None
    height_cm: float | None
    depth_cm: float | None
    volume_m3: float | None
    image_url: str | None
    location_id: int | None
    location_code: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True
