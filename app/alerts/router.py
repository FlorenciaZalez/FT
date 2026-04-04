from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import require_any
from app.auth.models import User
from app.alerts import service
from app.alerts.schemas import AlertResponse

router = APIRouter(prefix="/alerts", tags=["Alerts"])


@router.get("", response_model=list[AlertResponse])
async def list_alerts(
    active_only: bool = True,
    is_read: bool | None = None,
    alert_type: str | None = None,
    severity: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_alerts(db, user, active_only, is_read, alert_type, severity, skip, limit)


@router.get("/count")
async def count_active_alerts(
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    count = await service.count_active(db, user)
    return {"active": count}


@router.post("/check")
async def run_checks(
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger all automatic alert checks."""
    alerts = await service.run_all_checks(db)
    return {"created": len(alerts)}


@router.put("/read-all")
async def mark_all_read(
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    """Mark all visible unread alerts as read."""
    count = await service.mark_all_read(db, user)
    return {"marked": count}


@router.put("/{alert_id}/read", response_model=AlertResponse)
async def mark_alert_read(
    alert_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.mark_read(db, alert_id)


@router.put("/{alert_id}/resolve", response_model=AlertResponse)
async def resolve_alert(
    alert_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.resolve_alert(db, alert_id)
