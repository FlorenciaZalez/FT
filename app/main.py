from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.admin_seed_router import router as admin_seed_router
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
from app.database import Base, engine


# ✅ Crear app
app = FastAPI(
    title="Stock & Fulfillment SaaS",
    description="Sistema multi-tenant de gestión de stock y fulfillment",
    version="0.1.0",
)

API_PREFIX = "/api/v1"
settings = get_settings()


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
uploads_dir = Path(settings.UPLOADS_DIR)
uploads_dir.mkdir(parents=True, exist_ok=True)

app.mount(f"{API_PREFIX}/uploads", StaticFiles(directory=uploads_dir), name="uploads")


# ✅ Routers
app.include_router(admin_seed_router)
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
async def initialize_database():
    async with engine.begin() as connection:
        await connection.run_sync(lambda sync_connection: Base.metadata.create_all(bind=sync_connection))