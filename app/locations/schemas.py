from pydantic import BaseModel, field_validator
from datetime import datetime


class LocationCreate(BaseModel):
    zone: str          # pasillo: A, B, C...
    aisle: str         # estantería: 1, 01...
    shelf: str         # nivel: 1, 01...
    position: str = "01"  # posición: 1, 01...
    description: str | None = None

    @field_validator("zone")
    @classmethod
    def zone_upper(cls, v: str) -> str:
        return v.strip().upper()


class LocationUpdate(BaseModel):
    description: str | None = None
    is_active: bool | None = None


class LocationResponse(BaseModel):
    id: int
    code: str
    zone: str
    aisle: str
    shelf: str
    position: str
    description: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
