from pydantic import BaseModel, EmailStr, Field
from datetime import datetime


class ClientCreate(BaseModel):
    name: str
    business_name: str | None = None
    tax_id: str | None = None
    contact_email: EmailStr
    contact_phone: str | None = None
    contact_name: str | None = None
    contact_phone_operational: str | None = None
    plan: str = "basic"
    billing_day_of_month: int | None = Field(default=None, ge=1, le=31)
    variable_storage_enabled: bool = True


class ClientUpdate(BaseModel):
    name: str | None = None
    business_name: str | None = None
    tax_id: str | None = None
    contact_email: EmailStr | None = None
    contact_phone: str | None = None
    contact_name: str | None = None
    contact_phone_operational: str | None = None
    plan: str | None = None
    is_active: bool | None = None
    billing_day_of_month: int | None = Field(default=None, ge=1, le=31)
    variable_storage_enabled: bool | None = None


class BillingScheduleInfo(BaseModel):
    day_of_month: int | None = None
    active: bool = False

    class Config:
        orm_mode = True


class MLAccountInfo(BaseModel):
    ml_user_id: str | None = None
    ml_nickname: str | None = None
    connected_at: datetime | None = None

    class Config:
        orm_mode = True


class ClientResponse(BaseModel):
    id: int
    name: str
    business_name: str | None
    tax_id: str | None
    contact_email: str
    contact_phone: str | None
    contact_name: str | None
    contact_phone_operational: str | None
    plan: str
    is_active: bool
    variable_storage_enabled: bool = True
    created_at: datetime
    updated_at: datetime
    ml_account: MLAccountInfo | None = None
    billing_schedule: BillingScheduleInfo | None = None

    class Config:
        orm_mode = True
