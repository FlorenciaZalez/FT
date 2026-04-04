from pydantic import BaseModel
from datetime import datetime


class MLMappingCreate(BaseModel):
    client_id: int | None = None
    product_id: int
    ml_item_id: str
    ml_variation_id: str | None = None
    ml_account_id: str | None = None


class MLMappingUpdate(BaseModel):
    product_id: int | None = None
    ml_item_id: str | None = None
    ml_variation_id: str | None = None
    ml_account_id: str | None = None
    is_active: bool | None = None


class MLMappingResponse(BaseModel):
    id: int
    client_id: int
    product_id: int
    ml_item_id: str
    ml_variation_id: str | None
    ml_account_id: str | None
    is_active: bool
    created_at: datetime

    class Config:
        orm_mode = True


class MLMappingCreateResponse(BaseModel):
    success: bool = True
    reconciled_orders: int = 0
    mapping: MLMappingResponse


# ─── OAuth schemas ────────────────────────────────────────────────

class MLAuthUrlResponse(BaseModel):
    auth_url: str


class MLCallbackRequest(BaseModel):
    code: str
    client_id: int


class MLAccountResponse(BaseModel):
    id: int
    client_id: int
    ml_user_id: str
    ml_nickname: str | None
    connected_at: datetime
    token_expires_at: datetime | None

    class Config:
        orm_mode = True
