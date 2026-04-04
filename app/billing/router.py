from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_admin, require_any
from app.auth.models import User
from app.billing import service
from app.billing.schemas import (
    BillingAlertsResponse,
    BillingDocumentResponse,
    BillingRatesResponse,
    BillingRatesUpdate,
    ChargeResponse,
    ClientStorageRecordCreate,
    ClientStorageRecordResponse,
    ClientStorageRecordUpdate,
    ClientRatesResponse,
    ClientRatesUpdate,
    GenerateBillingDocumentsRequest,
    GenerateBillingDocumentsResponse,
    GenerateChargesRequest,
    GenerateChargesResponse,
    ManualChargeCreate,
    ManualChargeResponse,
    MerchandiseReceptionRecordCreate,
    MerchandiseReceptionRecordResponse,
    ProductCreationRecordResponse,
    PreparationRecordResponse,
    TransportDispatchRecordCreate,
    TransportDispatchRecordResponse,
)
from app.database import get_db

router = APIRouter(prefix="/billing", tags=["Billing"])


@router.get("/rates/global", response_model=BillingRatesResponse)
async def get_global_rates(
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_global_rates(db)


@router.put("/rates/global", response_model=BillingRatesResponse)
async def update_global_rates(
    body: BillingRatesUpdate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_global_rates(db, body.model_dump())


@router.get("/rates/clients", response_model=list[ClientRatesResponse])
async def list_client_rates(
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_client_rates(db)


@router.put("/rates/clients/{client_id}", response_model=ClientRatesResponse)
async def upsert_client_rates(
    client_id: int,
    body: ClientRatesUpdate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.upsert_client_rates(db, client_id, body.model_dump())


@router.get("/preview")
async def preview_billing(
    period: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.preview_charges(db, user, period)


@router.get("/storage-records", response_model=list[ClientStorageRecordResponse])
async def list_storage_records(
    client_id: int | None = Query(None, ge=1),
    period: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_storage_records(db, client_id=client_id, period=period)


@router.post("/storage-records", response_model=ClientStorageRecordResponse)
async def create_storage_record(
    body: ClientStorageRecordCreate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_storage_record(db, body.model_dump())


@router.put("/storage-records/{record_id}", response_model=ClientStorageRecordResponse)
async def update_storage_record(
    record_id: int,
    body: ClientStorageRecordUpdate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_storage_record(db, record_id, body.model_dump())


@router.delete("/storage-records/{record_id}")
async def delete_storage_record(
    record_id: int,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_storage_record(db, record_id)
    return {"success": True}


@router.post("/charges/generate", response_model=GenerateChargesResponse)
async def generate_billing_charges(
    body: GenerateChargesRequest,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    charges = await service.generate_charges(db, body.period, body.due_date, body.overwrite)
    serialized = await service.list_charges(db, user, body.period)
    return {
        "period": body.period,
        "generated_count": len(charges),
        "total_amount": round(sum(item["total"] for item in serialized), 2),
        "charges": serialized,
    }


@router.get("/charges", response_model=list[ChargeResponse])
async def list_billing_charges(
    period: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    client_id: int | None = Query(None, ge=1),
    due_date_from: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    due_date_to: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    status: str | None = Query(None),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_charges(db, user, period, client_id, due_date_from, due_date_to, status)


@router.get("/charges/{charge_id}", response_model=ChargeResponse)
async def get_billing_charge(
    charge_id: int,
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_charge(db, charge_id, user)


@router.post("/generate", response_model=GenerateBillingDocumentsResponse)
async def generate_billing_documents(
    body: GenerateBillingDocumentsRequest,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    documents = await service.generate_billing_documents(db, body.period, body.overwrite)
    serialized = await service.list_billing_documents(db, user, period=body.period)
    return {
        "period": body.period,
        "generated_count": len(documents),
        "total_amount": round(sum(item["total"] for item in serialized), 2),
        "documents": serialized,
    }


@router.post("/generate/{client_id}", response_model=BillingDocumentResponse)
async def generate_single_billing_document(
    client_id: int,
    body: GenerateBillingDocumentsRequest,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.generate_single_billing_document(db, client_id, body.period, body.overwrite)


@router.get("/documents", response_model=list[BillingDocumentResponse])
async def list_billing_documents(
    period: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    client_id: int | None = Query(None, ge=1),
    status: str | None = Query(None),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_billing_documents(db, user, period=period, client_id=client_id, status=status)


@router.post("/documents/{document_id}/mark-paid", response_model=BillingDocumentResponse)
async def mark_billing_document_paid(
    document_id: int,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.mark_billing_document_paid(db, document_id, user)


@router.get("/alerts", response_model=BillingAlertsResponse)
async def get_billing_alerts(
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_billing_alerts(db, user)


@router.get("/preparation-records", response_model=list[PreparationRecordResponse])
async def list_preparation_records(
    client_id: int | None = Query(None, ge=1),
    period: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    order_id: int | None = Query(None, ge=1),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_preparation_records(db, client_id=client_id, period=period, order_id=order_id, user=user)


@router.get("/product-creation-records", response_model=list[ProductCreationRecordResponse])
async def list_product_creation_records(
    client_id: int | None = Query(None, ge=1),
    period: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_product_creation_records(db, client_id=client_id, period=period, user=user)


@router.get("/transport-dispatch-records", response_model=list[TransportDispatchRecordResponse])
async def list_transport_dispatch_records(
    client_id: int | None = Query(None, ge=1),
    period: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_transport_dispatch_records(db, client_id=client_id, period=period, user=user)


@router.post("/transport-dispatch-records", response_model=TransportDispatchRecordResponse)
async def create_transport_dispatch_record(
    body: TransportDispatchRecordCreate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_transport_dispatch_record(db, body.model_dump())


@router.delete("/transport-dispatch-records/{record_id}")
async def delete_transport_dispatch_record(
    record_id: int,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_transport_dispatch_record(db, record_id)
    return {"success": True}


@router.get("/merchandise-reception-records", response_model=list[MerchandiseReceptionRecordResponse])
async def list_merchandise_reception_records(
    client_id: int | None = Query(None, ge=1),
    period: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_merchandise_reception_records(db, client_id=client_id, period=period, user=user)


@router.post("/merchandise-reception-records", response_model=MerchandiseReceptionRecordResponse)
async def create_merchandise_reception_record(
    body: MerchandiseReceptionRecordCreate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_merchandise_reception_record(db, body.model_dump())


@router.delete("/merchandise-reception-records/{record_id}")
async def delete_merchandise_reception_record(
    record_id: int,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_merchandise_reception_record(db, record_id)
    return {"success": True}


@router.get("/manual-charges", response_model=list[ManualChargeResponse])
async def list_manual_charges(
    client_id: int | None = Query(None, ge=1),
    period: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    user: User = Depends(require_any),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_manual_charges(db, client_id=client_id, period=period, user=user)


@router.post("/manual-charges", response_model=ManualChargeResponse)
async def create_manual_charge(
    body: ManualChargeCreate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_manual_charge(db, body.model_dump())


@router.delete("/manual-charges/{charge_id}")
async def delete_manual_charge(
    charge_id: int,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_manual_charge(db, charge_id)
    return {"success": True}
