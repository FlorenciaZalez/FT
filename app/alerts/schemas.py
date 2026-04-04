from pydantic import BaseModel
from datetime import datetime


class AlertResponse(BaseModel):
    id: int
    client_id: int | None
    alert_type: str
    severity: str
    target_role: str
    reference_type: str | None
    reference_id: int | None
    message: str
    is_read: bool
    resolved_at: datetime | None
    created_at: datetime

    class Config:
        orm_mode = True
