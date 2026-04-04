"""Public endpoints for dispatch verification by drivers (no auth required)."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.orders.models import DispatchBatch, DispatchVerification
from app.common.exceptions import NotFoundError, BadRequestError

router = APIRouter(prefix="/dispatch", tags=["Dispatch Verification"])

MAX_ATTEMPTS = 3


class VerifyRequest(BaseModel):
    entered_count: int = Field(..., ge=0)


async def _get_batch_by_number(db: AsyncSession, batch_number: str, *, load_transporter: bool = False):
    """Lookup a DispatchBatch by its batch_number (e.g. DESP-00012)."""
    stmt = select(DispatchBatch).where(DispatchBatch.batch_number == batch_number)
    if load_transporter:
        stmt = stmt.options(selectinload(DispatchBatch.transporter))
    batch = (await db.execute(stmt)).scalar_one_or_none()
    if batch is None:
        raise NotFoundError("Lote no encontrado")
    return batch


@router.get("/{batch_number}")
async def get_batch_info(batch_number: str, db: AsyncSession = Depends(get_db)):
    """Public: return batch summary for verification screen."""
    batch = await _get_batch_by_number(db, batch_number, load_transporter=True)

    # Count previous attempts
    attempts = (await db.execute(
        select(func.count(DispatchVerification.id))
        .where(DispatchVerification.batch_id == batch.id)
    )).scalar_one()

    # Check if already verified successfully
    success = (await db.execute(
        select(DispatchVerification.id)
        .where(DispatchVerification.batch_id == batch.id, DispatchVerification.is_match.is_(True))
        .limit(1)
    )).scalar_one_or_none()

    return {
        "batch_number": batch.batch_number,
        "transporter_name": batch.transporter.name if batch.transporter else batch.carrier,
        "attempts_used": attempts,
        "max_attempts": MAX_ATTEMPTS,
        "locked": attempts >= MAX_ATTEMPTS and success is None,
        "verified": success is not None,
    }


@router.post("/{batch_number}/verify")
async def verify_count(
    batch_number: str, body: VerifyRequest, db: AsyncSession = Depends(get_db),
):
    """Public: verify the package count entered by the driver."""
    batch = await _get_batch_by_number(db, batch_number)

    # Count previous attempts
    attempts = (await db.execute(
        select(func.count(DispatchVerification.id))
        .where(DispatchVerification.batch_id == batch.id)
    )).scalar_one()

    # Already verified?
    success = (await db.execute(
        select(DispatchVerification.id)
        .where(DispatchVerification.batch_id == batch.id, DispatchVerification.is_match.is_(True))
        .limit(1)
    )).scalar_one_or_none()
    if success is not None:
        return {"match": True, "locked": False, "verified": True,
                "message": "Este lote ya fue verificado correctamente."}

    if attempts >= MAX_ATTEMPTS:
        raise BadRequestError("Máximo de intentos alcanzado. Contactar al operador.")

    is_match = body.entered_count == batch.order_count
    attempt = DispatchVerification(
        batch_id=batch.id,
        entered_count=body.entered_count,
        expected_count=batch.order_count,
        is_match=is_match,
        attempt_number=attempts + 1,
    )
    db.add(attempt)
    await db.flush()

    new_attempts = attempts + 1
    locked = new_attempts >= MAX_ATTEMPTS and not is_match

    if is_match:
        return {
            "match": True,
            "locked": False,
            "verified": True,
            "attempts_used": new_attempts,
            "message": "Cantidad correcta. Podés iniciar el recorrido.",
        }

    remaining = MAX_ATTEMPTS - new_attempts
    return {
        "match": False,
        "locked": locked,
        "verified": False,
        "attempts_used": new_attempts,
        "message": "Contactar al operador." if locked
        else f"La cantidad no coincide. Revisar paquetes. ({remaining} intento{'s' if remaining != 1 else ''} restante{'s' if remaining != 1 else ''}).",
    }
