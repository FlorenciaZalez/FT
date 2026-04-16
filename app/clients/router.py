from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import require_admin, require_any
from app.auth.models import User
from app.clients import service
from app.clients.schemas import ClientCreate, ClientUpdate, ClientResponse

router = APIRouter(prefix="/clients", tags=["Clients"])


@router.get("", response_model=list[ClientResponse])
async def list_clients(
    skip: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=5000),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    clients, total = await service.list_clients(db, user, skip, limit)
    return clients


@router.post("", response_model=ClientResponse, status_code=201)
async def create_client(
    body: ClientCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_client(db, body.dict())


@router.get("/{client_id}", response_model=ClientResponse)
async def get_client(
    client_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_client(db, client_id, user)


@router.put("/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: int,
    body: ClientUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_client(db, client_id, body.dict(exclude_unset=True))


@router.delete("/{client_id}", status_code=204)
async def delete_client(
    client_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_client(db, client_id)
