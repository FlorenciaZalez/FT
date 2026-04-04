from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import require_operator, require_any
from app.auth.models import User
from app.transporters import service
from app.transporters.schemas import (
    TransporterCreate,
    TransporterDocumentResponse,
    TransporterUpdate,
    TransporterResponse,
)

router = APIRouter(prefix="/transporters", tags=["Transporters"])


@router.get("", response_model=list[TransporterResponse])
async def list_transporters(
    active_only: bool = Query(False),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_transporters(db, active_only)


@router.get("/{transporter_id}", response_model=TransporterResponse)
async def get_transporter(
    transporter_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_transporter(db, transporter_id)


@router.get("/{transporter_id}/documents", response_model=list[TransporterDocumentResponse])
async def list_transporter_documents(
    transporter_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_transporter_documents(db, transporter_id)


@router.get("/{transporter_id}/documents/{document_id}/download")
async def download_transporter_document(
    transporter_id: int,
    document_id: str,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.download_transporter_document(db, transporter_id, document_id)


@router.post("", response_model=TransporterResponse, status_code=201)
async def create_transporter(
    body: TransporterCreate,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_transporter(db, body.model_dump())


@router.put("/{transporter_id}", response_model=TransporterResponse)
async def update_transporter(
    transporter_id: int,
    body: TransporterUpdate,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_transporter(db, transporter_id, body.model_dump(exclude_unset=True))


@router.delete("/{transporter_id}", status_code=204)
async def delete_transporter(
    transporter_id: int,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_transporter(db, transporter_id)
