from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ShippingCordonValue = Literal["cordon_1", "cordon_2", "cordon_3"]
WeightCategoryValue = Literal["light", "heavy"]


class PostalCodeRangeBase(BaseModel):
    cp_from: int = Field(ge=0)
    cp_to: int = Field(ge=0)
    cordon: ShippingCordonValue


class PostalCodeRangeCreate(PostalCodeRangeBase):
    pass


class PostalCodeRangeUpdate(BaseModel):
    cp_from: int | None = Field(default=None, ge=0)
    cp_to: int | None = Field(default=None, ge=0)
    cordon: ShippingCordonValue | None = None


class PostalCodeRangeResponse(PostalCodeRangeBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True


class ShippingRateBase(BaseModel):
    cordon: ShippingCordonValue
    price: float = Field(ge=0)


class ShippingRateCreate(ShippingRateBase):
    pass


class ShippingRateUpdate(BaseModel):
    cordon: ShippingCordonValue | None = None
    price: float | None = Field(default=None, ge=0)


class ShippingRateResponse(ShippingRateBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True


class HandlingRateBase(BaseModel):
    weight_category: WeightCategoryValue
    price: float = Field(ge=0)


class HandlingRateCreate(HandlingRateBase):
    pass


class HandlingRateUpdate(BaseModel):
    weight_category: WeightCategoryValue | None = None
    price: float | None = Field(default=None, ge=0)


class HandlingRateResponse(HandlingRateBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True