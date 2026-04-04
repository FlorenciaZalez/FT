from pathlib import Path

from sqlalchemy import select
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
from app.auth.security import hash_password


# ✅ Crear app
app = FastAPI(
    title="Stock & Fulfillment SaaS",
    description="Sistema multi-tenant de gestión de stock y fulfillment",
    version="0.1.0",
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


# 🔥 AUTO ADMIN (CORREGIDO)
@app.on_event("startup")
async def create_admin():
    try:
        email = "florenciarociotrodler@gmail.com"
        password = "Florencia23"

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.email == email))
            existing_user = result.scalar_one_or_none()

            if existing_user is None:
                admin = User(
                    email=email,
                    hashed_password=hash_password(password),
                    full_name="Admin",
                    role=UserRole.admin,
                    client_id=None,
                    is_active=True,
                    zones=None,
                )
                db.add(admin)
                await db.commit()
    except Exception as error:
        print(f"Error creating admin user on startup: {error}")