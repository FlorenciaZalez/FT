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


class BillingScheduleInfo(BaseModel):
    day_of_month: int
    active: bool


class MLAccountInfo(BaseModel):
    ml_user_id: str
    ml_nickname: str | None
    connected_at: datetime

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
    created_at: datetime
    updated_at: datetime
    ml_account: MLAccountInfo | None = None
    billing_schedule: BillingScheduleInfo | None = None

    class Config:
        orm_mode = True
