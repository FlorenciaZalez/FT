from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_any
from app.auth.models import User
from app.database import get_db
from app.reports.schemas import OrderReportRow
from app.reports import service

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/orders", response_model=list[OrderReportRow])
async def get_orders_report(
    from_date: datetime = Query(...),
    to_date: datetime = Query(...),
    format: str = Query("json", pattern="^(json|csv)$"),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    rows = await service.list_order_report_rows(
        db,
        user_client_id=user.client_id,
        from_date=from_date,
        to_date=to_date,
    )

    if format == "csv":
        csv_content = service.render_order_report_csv(rows)
        file_name = f"reporte-pedidos-{from_date.date().isoformat()}-{to_date.date().isoformat()}.csv"
        return StreamingResponse(
            iter([csv_content.encode("utf-8")]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
        )

    return rows