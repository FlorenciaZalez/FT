from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

import app.models  # noqa: F401
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


async def _ensure_runtime_schema() -> None:
    async with engine.begin() as connection:
        await connection.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_type
                        WHERE typname = 'shippingcategory'
                    ) THEN
                        CREATE TYPE shippingcategory AS ENUM ('A', 'B', 'C');
                    END IF;
                END $$;
                """
            )
        )
        await connection.execute(
            text(
                """
                ALTER TABLE clients
                ADD COLUMN IF NOT EXISTS shipping_category shippingcategory
                """
            )
        )
        await connection.execute(
            text(
                """
                UPDATE clients
                SET shipping_category = 'A'::shippingcategory
                WHERE shipping_category IS NULL
                """
            )
        )
        await connection.execute(
            text(
                """
                ALTER TABLE clients
                ALTER COLUMN shipping_category SET DEFAULT 'A'::shippingcategory
                """
            )
        )
        await connection.execute(
            text(
                """
                ALTER TABLE shipping_rates
                ADD COLUMN IF NOT EXISTS shipping_category shippingcategory
                """
            )
        )
        await connection.execute(
            text(
                """
                UPDATE shipping_rates
                SET shipping_category = 'A'::shippingcategory
                WHERE shipping_category IS NULL
                """
            )
        )
        await connection.execute(
            text(
                """
                ALTER TABLE shipping_rates
                ALTER COLUMN shipping_category SET DEFAULT 'A'::shippingcategory
                """
            )
        )
        await connection.execute(
            text(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM information_schema.table_constraints
                        WHERE table_name = 'shipping_rates'
                        AND constraint_name = 'uq_shipping_rates_cordon'
                    ) THEN
                        ALTER TABLE shipping_rates DROP CONSTRAINT uq_shipping_rates_cordon;
                    END IF;
                END $$;
                """
            )
        )
        await connection.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM information_schema.table_constraints
                        WHERE table_name = 'shipping_rates'
                        AND constraint_name = 'uq_shipping_rates_category_cordon'
                    ) THEN
                        ALTER TABLE shipping_rates
                        ADD CONSTRAINT uq_shipping_rates_category_cordon UNIQUE (shipping_category, cordon);
                    END IF;
                END $$;
                """
            )
        )
        await connection.execute(
            text(
                """
                INSERT INTO shipping_rates (shipping_category, cordon, price, created_at, updated_at)
                SELECT 'B'::shippingcategory, shipping_rates.cordon, shipping_rates.price, now(), now()
                FROM shipping_rates
                WHERE shipping_rates.shipping_category = 'A'::shippingcategory
                AND NOT EXISTS (
                    SELECT 1 FROM shipping_rates existing
                    WHERE existing.shipping_category = 'B'::shippingcategory
                    AND existing.cordon = shipping_rates.cordon
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                INSERT INTO shipping_rates (shipping_category, cordon, price, created_at, updated_at)
                SELECT 'C'::shippingcategory, shipping_rates.cordon, shipping_rates.price, now(), now()
                FROM shipping_rates
                WHERE shipping_rates.shipping_category = 'A'::shippingcategory
                AND NOT EXISTS (
                    SELECT 1 FROM shipping_rates existing
                    WHERE existing.shipping_category = 'C'::shippingcategory
                    AND existing.cordon = shipping_rates.cordon
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                ALTER TABLE clients
                ADD COLUMN IF NOT EXISTS variable_storage_enabled BOOLEAN NOT NULL DEFAULT TRUE
                """
            )
        )
        await connection.execute(
            text(
                """
                UPDATE clients
                SET variable_storage_enabled = TRUE
                WHERE variable_storage_enabled IS NULL
                """
            )
        )
        await connection.execute(
            text(
                """
                ALTER TABLE clients
                ALTER COLUMN variable_storage_enabled SET DEFAULT TRUE
                """
            )
        )
        await connection.execute(
            text(
                """
                ALTER TABLE billing_rates
                ADD COLUMN IF NOT EXISTS label_print_fee NUMERIC(12, 2) NOT NULL DEFAULT 0
                """
            )
        )
        await connection.execute(
            text(
                """
                ALTER TABLE charges
                ADD COLUMN IF NOT EXISTS label_print_amount NUMERIC(14, 2) NOT NULL DEFAULT 0
                """
            )
        )
        await connection.execute(
            text(
                """
                ALTER TABLE billing_documents
                ADD COLUMN IF NOT EXISTS label_print_total NUMERIC(14, 2) NOT NULL DEFAULT 0
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS label_print_records (
                    id SERIAL PRIMARY KEY,
                    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                    order_id INTEGER NULL REFERENCES orders(id) ON DELETE SET NULL,
                    order_number VARCHAR(100) NOT NULL,
                    label_type VARCHAR(20),
                    price_applied NUMERIC(12, 2) NOT NULL DEFAULT 0,
                    printed_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_label_print_records_client_id
                ON label_print_records (client_id)
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_label_print_records_order_id
                ON label_print_records (order_id)
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_label_print_records_printed_at
                ON label_print_records (printed_at)
                """
            )
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


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception):
    import traceback
    return JSONResponse(
        status_code=500,
        content={
            "detail": str(exc),
            "type": type(exc).__name__,
            "trace": traceback.format_exc()[-2000:],
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
app.include_router(admin_seed_router, prefix=API_PREFIX)
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
    await _ensure_runtime_schema()