from pydantic import BaseModel
from datetime import date, datetime


class TransporterDocumentUpload(BaseModel):
    file_name: str
    content_base64: str


class TransporterCreate(BaseModel):
    name: str
    zone: str | None = None
    phone: str | None = None
    domicilio: str | None = None
    dni_file: TransporterDocumentUpload | None = None
    seguro_file: TransporterDocumentUpload | None = None
    cedula_verde_file: TransporterDocumentUpload | None = None
    insurance_expiration_date: date | None = None
    license_expiration_date: date | None = None
    active: bool = True


class TransporterUpdate(BaseModel):
    name: str | None = None
    zone: str | None = None
    phone: str | None = None
    domicilio: str | None = None
    dni_file: TransporterDocumentUpload | None = None
    seguro_file: TransporterDocumentUpload | None = None
    cedula_verde_file: TransporterDocumentUpload | None = None
    insurance_expiration_date: date | None = None
    license_expiration_date: date | None = None
    active: bool | None = None


class TransporterDocumentResponse(BaseModel):
    id: str
    document_type: str
    url: str
    file_path: str | None = None
    file_name: str
    uploaded_at: datetime | None = None
    expiration_date: date | None = None
    content_type: str | None = None


class TransporterResponse(BaseModel):
    id: int
    name: str
    zone: str | None
    phone: str | None
    domicilio: str | None
    dni_file_path: str | None
    dni_file_name: str | None
    dni_uploaded_at: datetime | None = None
    dni_file_url: str | None
    seguro_file_path: str | None
    seguro_file_name: str | None
    seguro_uploaded_at: datetime | None = None
    seguro_file_url: str | None
    cedula_verde_file_path: str | None
    cedula_verde_file_name: str | None
    cedula_verde_uploaded_at: datetime | None = None
    cedula_verde_file_url: str | None
    insurance_expiration_date: date | None = None
    license_expiration_date: date | None = None
    document_status: str
    missing_documents: list[str] = []
    expiring_documents: list[str] = []
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
