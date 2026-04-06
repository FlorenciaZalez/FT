from pathlib import Path

from sqlalchemy import select
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.auth.router import router as auth_router
from app.clients.router import router as clients_router
from app.products.router import router as products_router
from app.locations.router import router as locations_router
from app.stock.router import router as stock_router
from app.orders.router import router as orders_router, returns_router
from app.alerts.router import router as alerts_router
from app.integrations.mercadolibre.router import router as ml_router
from app.transporters.router import router as transporters_router
from app.orders.verify_router import router as dispatch_verify_router
from app.billing.router import router as billing_router
from app.shipping.router import router as shipping_router
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.auth.models import User, UserRole
from app.auth.security import hash_password, verify_password


# ✅ Crear app
app = FastAPI(
    title="Stock & Fulfillment SaaS",
    description="Sistema multi-tenant de gestión de stock y fulfillment",
    version="0.1.0",
)


def _format_validation_error(exc: RequestValidationError) -> str:
    messages: list[str] = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc", []) if part != "body")
        message = error.get("msg", "Error de validacion")
        messages.append(f"{location}: {message}" if location else message)
    return "; ".join(messages) if messages else "Datos invalidos"


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "detail": _format_validation_error(exc),
            "errors": exc.errors(),
        },
    )


# ✅ Ruta base
@app.get("/")
def root():
    return {"status": "ok"}


# ✅ Health
@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


# ✅ CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ✅ Config uploads
API_PREFIX = "/api/v1"
settings = get_settings()

uploads_dir = Path(settings.UPLOADS_DIR)
uploads_dir.mkdir(parents=True, exist_ok=True)

app.mount(f"{API_PREFIX}/uploads", StaticFiles(directory=uploads_dir), name="uploads")


# ✅ Routers
app.include_router(auth_router, prefix=API_PREFIX)
app.include_router(transporters_router, prefix=API_PREFIX)
app.include_router(clients_router, prefix=API_PREFIX)
app.include_router(products_router, prefix=API_PREFIX)
app.include_router(locations_router, prefix=API_PREFIX)
app.include_router(stock_router, prefix=API_PREFIX)
app.include_router(orders_router, prefix=API_PREFIX)
app.include_router(returns_router, prefix=API_PREFIX)
app.include_router(alerts_router, prefix=API_PREFIX)
app.include_router(ml_router, prefix=API_PREFIX)
app.include_router(dispatch_verify_router, prefix=API_PREFIX)
app.include_router(billing_router, prefix=API_PREFIX)
app.include_router(shipping_router, prefix=API_PREFIX)


# 🔥 AUTO ADMIN (FINAL)
@app.on_event("startup")
async def create_admin():
    try:
        email = settings.FIRST_SUPERUSER_EMAIL.strip()
        password = settings.FIRST_SUPERUSER_PASSWORD
        full_name = settings.FIRST_SUPERUSER_FULL_NAME.strip() or "Admin"

        if not email or not password:
            return

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.email == email))
            existing_user = result.scalar_one_or_none()

            if existing_user is None:
                admin = User(
                    email=email,
                    hashed_password=hash_password(password),
                    full_name=full_name,
                    role=UserRole.admin,
                    client_id=None,
                    is_active=True,
                    zones=None,
                )
                db.add(admin)
            else:
                existing_user.full_name = full_name
                existing_user.role = UserRole.admin
                existing_user.client_id = None
                existing_user.is_active = True
                existing_user.zones = None
                if not verify_password(password, existing_user.hashed_password):
                    existing_user.hashed_password = hash_password(password)

            await db.commit()

    except Exception as error:
        print(f"Error creating admin user on startup: {error}")