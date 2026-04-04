import base64
import binascii
import mimetypes
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.responses import FileResponse

from app.config import get_settings
from app.transporters.models import Transporter, TransporterZone
from app.orders.models import DispatchBatch
from app.common.exceptions import NotFoundError, ConflictError, BadRequestError


settings = get_settings()
UPLOADS_ROOT = Path(settings.UPLOADS_DIR)
DOCUMENT_EXPIRING_SOON_DAYS = 30
DOCUMENT_CONFIG = {
    "dni": {
        "url_field": "dni_file_url",
        "path_field": "dni_file_path",
        "name_field": "dni_file_name",
        "uploaded_at_field": "dni_uploaded_at",
        "expiration_field": None,
        "label": "DNI",
    },
    "seguro": {
        "url_field": "seguro_file_url",
        "path_field": "seguro_file_path",
        "name_field": "seguro_file_name",
        "uploaded_at_field": "seguro_uploaded_at",
        "expiration_field": "insurance_expiration_date",
        "label": "Seguro",
    },
    "cedula_verde": {
        "url_field": "cedula_verde_file_url",
        "path_field": "cedula_verde_file_path",
        "name_field": "cedula_verde_file_name",
        "uploaded_at_field": "cedula_verde_uploaded_at",
        "expiration_field": "license_expiration_date",
        "label": "Cédula verde",
    },
}


def _slugify_file_name(value: str) -> str:
    base_name = Path(value).name
    stem = re.sub(r"[^a-zA-Z0-9_-]+", "-", Path(base_name).stem).strip("-") or "documento"
    suffix = Path(base_name).suffix.lower()
    return f"{stem}{suffix}"


def _decode_base64_file(content_base64: str) -> bytes:
    try:
        return base64.b64decode(content_base64, validate=True)
    except binascii.Error as exc:
        raise BadRequestError("Archivo inválido en base64") from exc


def _build_file_url(relative_path: Path) -> str:
    return f"/api/v1/uploads/{relative_path.as_posix()}"


def _save_document(transporter_id: int, document_name: str, payload: dict | None) -> dict[str, str | datetime] | None:
    if not payload:
        return None

    file_name = payload.get("file_name")
    content_base64 = payload.get("content_base64")
    if not file_name or not content_base64:
        raise BadRequestError("El archivo debe incluir file_name y content_base64")

    transporter_dir = UPLOADS_ROOT / "transporters" / str(transporter_id)
    transporter_dir.mkdir(parents=True, exist_ok=True)

    safe_name = _slugify_file_name(file_name)
    unique_name = f"{document_name}-{uuid.uuid4().hex[:8]}-{safe_name}"
    relative_path = Path("transporters") / str(transporter_id) / unique_name
    full_path = UPLOADS_ROOT / relative_path
    full_path.write_bytes(_decode_base64_file(content_base64))
    return {
        "url": _build_file_url(relative_path),
        "path": relative_path.as_posix(),
        "file_name": file_name,
        "uploaded_at": datetime.now(timezone.utc),
    }


def _get_document_expiration_date(transporter: Transporter, document_type: str) -> date | None:
    expiration_field = DOCUMENT_CONFIG[document_type]["expiration_field"]
    if not expiration_field:
        return None
    return getattr(transporter, expiration_field)


def _build_document_response(transporter: Transporter, document_type: str) -> dict | None:
    config = DOCUMENT_CONFIG[document_type]
    document_url = getattr(transporter, config["url_field"])
    if not document_url:
        return None

    file_name = getattr(transporter, config["name_field"]) or Path(document_url).name
    content_type, _ = mimetypes.guess_type(file_name)
    return {
        "id": document_type,
        "document_type": document_type,
        "url": document_url,
        "file_path": getattr(transporter, config["path_field"]),
        "file_name": file_name,
        "uploaded_at": getattr(transporter, config["uploaded_at_field"]),
        "expiration_date": _get_document_expiration_date(transporter, document_type),
        "content_type": content_type,
    }


def _list_documents(transporter: Transporter) -> list[dict]:
    documents: list[dict] = []
    for document_type in DOCUMENT_CONFIG:
        document = _build_document_response(transporter, document_type)
        if document is not None:
            documents.append(document)
    return documents


def _compute_document_status(transporter: Transporter) -> tuple[str, list[str], list[str]]:
    today = date.today()
    threshold = today + timedelta(days=DOCUMENT_EXPIRING_SOON_DAYS)
    missing_documents: list[str] = []
    expiring_documents: list[str] = []
    has_expired = False

    for document_type, config in DOCUMENT_CONFIG.items():
        document_url = getattr(transporter, config["url_field"])
        if not document_url:
            missing_documents.append(config["label"])
            continue

        expiration_date = _get_document_expiration_date(transporter, document_type)
        if expiration_date is None:
            continue
        if expiration_date < today:
            has_expired = True
            expiring_documents.append(config["label"])
        elif expiration_date <= threshold:
            expiring_documents.append(config["label"])

    if has_expired:
        return "vencido", missing_documents, expiring_documents
    if missing_documents:
        return "incompleto", missing_documents, expiring_documents
    if expiring_documents:
        return "por_vencer", missing_documents, expiring_documents
    return "completo", missing_documents, expiring_documents


def _serialize_transporter(transporter: Transporter) -> dict:
    document_status, missing_documents, expiring_documents = _compute_document_status(transporter)
    return {
        "id": transporter.id,
        "name": transporter.name,
        "zone": transporter.zone.value if transporter.zone else None,
        "phone": transporter.phone,
        "domicilio": transporter.domicilio,
        "dni_file_path": transporter.dni_file_path,
        "dni_file_name": transporter.dni_file_name,
        "dni_uploaded_at": transporter.dni_uploaded_at,
        "dni_file_url": transporter.dni_file_url,
        "seguro_file_path": transporter.seguro_file_path,
        "seguro_file_name": transporter.seguro_file_name,
        "seguro_uploaded_at": transporter.seguro_uploaded_at,
        "seguro_file_url": transporter.seguro_file_url,
        "cedula_verde_file_path": transporter.cedula_verde_file_path,
        "cedula_verde_file_name": transporter.cedula_verde_file_name,
        "cedula_verde_uploaded_at": transporter.cedula_verde_uploaded_at,
        "cedula_verde_file_url": transporter.cedula_verde_file_url,
        "insurance_expiration_date": transporter.insurance_expiration_date,
        "license_expiration_date": transporter.license_expiration_date,
        "document_status": document_status,
        "missing_documents": missing_documents,
        "expiring_documents": expiring_documents,
        "active": transporter.active,
        "created_at": transporter.created_at,
    }


def _apply_document_updates(transporter: Transporter, data: dict) -> None:
    document_fields = {
        "dni_file": "dni",
        "seguro_file": "seguro",
        "cedula_verde_file": "cedula_verde",
    }
    for input_field, document_type in document_fields.items():
        if input_field in data and data[input_field] is not None:
            saved_document = _save_document(transporter.id, document_type, data[input_field])
            if saved_document is None:
                continue
            config = DOCUMENT_CONFIG[document_type]
            setattr(transporter, config["url_field"], saved_document["url"])
            setattr(transporter, config["path_field"], saved_document["path"])
            setattr(transporter, config["name_field"], saved_document["file_name"])
            setattr(transporter, config["uploaded_at_field"], saved_document["uploaded_at"])


async def list_transporters(
    db: AsyncSession, active_only: bool = False,
) -> list[dict]:
    query = select(Transporter).order_by(Transporter.name)
    if active_only:
        query = query.where(Transporter.active.is_(True))
    result = await db.execute(query)
    return [_serialize_transporter(item) for item in result.scalars().all()]


async def _get_transporter_model(db: AsyncSession, transporter_id: int) -> Transporter:
    result = await db.execute(
        select(Transporter).where(Transporter.id == transporter_id)
    )
    t = result.scalar_one_or_none()
    if t is None:
        raise NotFoundError(f"Transportista {transporter_id} no encontrado")
    return t


async def get_transporter(db: AsyncSession, transporter_id: int) -> dict:
    return _serialize_transporter(await _get_transporter_model(db, transporter_id))


async def create_transporter(db: AsyncSession, data: dict) -> dict:
    # Check duplicate name
    existing = await db.execute(
        select(Transporter).where(Transporter.name == data["name"])
    )
    if existing.scalar_one_or_none():
        raise ConflictError(f"Ya existe un transportista con el nombre '{data['name']}'")

    t = Transporter(
        name=data["name"],
        zone=TransporterZone(data["zone"]) if data.get("zone") else None,
        phone=data.get("phone"),
        domicilio=data.get("domicilio"),
        insurance_expiration_date=data.get("insurance_expiration_date"),
        license_expiration_date=data.get("license_expiration_date"),
        active=data.get("active", True),
    )
    db.add(t)
    await db.flush()
    _apply_document_updates(t, data)
    await db.flush()
    await db.refresh(t)
    return _serialize_transporter(t)


async def update_transporter(db: AsyncSession, transporter_id: int, data: dict) -> dict:
    t = await _get_transporter_model(db, transporter_id)

    if "name" in data and data["name"] is not None:
        # Check duplicate name (excluding self)
        existing = await db.execute(
            select(Transporter).where(
                Transporter.name == data["name"],
                Transporter.id != transporter_id,
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError(f"Ya existe un transportista con el nombre '{data['name']}'")
        t.name = data["name"]

    if "zone" in data:
        t.zone = TransporterZone(data["zone"]) if data["zone"] else None
    if "phone" in data:
        t.phone = data["phone"]
    if "domicilio" in data:
        t.domicilio = data["domicilio"]
    if "insurance_expiration_date" in data:
        t.insurance_expiration_date = data["insurance_expiration_date"]
    if "license_expiration_date" in data:
        t.license_expiration_date = data["license_expiration_date"]
    if "active" in data and data["active"] is not None:
        t.active = data["active"]

    _apply_document_updates(t, data)

    await db.flush()
    await db.refresh(t)
    return _serialize_transporter(t)


async def delete_transporter(db: AsyncSession, transporter_id: int) -> None:
    t = await _get_transporter_model(db, transporter_id)

    # Check for associated dispatch batches
    result = await db.execute(
        select(func.count()).select_from(DispatchBatch).where(
            DispatchBatch.transporter_id == transporter_id
        )
    )
    count = result.scalar_one()
    if count > 0:
        raise ConflictError(
            "Este transportista no puede eliminarse porque tiene despachos asociados. "
            "Podés desactivarlo en su lugar."
        )

    await db.delete(t)
    await db.flush()


async def list_transporter_documents(db: AsyncSession, transporter_id: int) -> list[dict]:
    transporter = await _get_transporter_model(db, transporter_id)
    return _list_documents(transporter)


async def download_transporter_document(db: AsyncSession, transporter_id: int, document_id: str) -> FileResponse:
    transporter = await _get_transporter_model(db, transporter_id)
    if document_id not in DOCUMENT_CONFIG:
        raise NotFoundError(f"Documento {document_id} no encontrado")

    config = DOCUMENT_CONFIG[document_id]
    relative_path = getattr(transporter, config["path_field"])
    if not relative_path:
        raise NotFoundError(f"Documento {config['label']} no encontrado")

    full_path = (UPLOADS_ROOT / relative_path).resolve()
    uploads_root = UPLOADS_ROOT.resolve()
    try:
        full_path.relative_to(uploads_root)
    except ValueError as exc:
        raise BadRequestError("Ruta de documento inválida") from exc
    if not full_path.exists() or not full_path.is_file():
        raise NotFoundError(f"Archivo de {config['label']} no disponible")

    file_name = getattr(transporter, config["name_field"]) or full_path.name
    content_type, _ = mimetypes.guess_type(file_name)
    return FileResponse(path=full_path, media_type=content_type or "application/octet-stream", filename=file_name)
