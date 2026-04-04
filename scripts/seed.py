"""
Seed script: crea un usuario admin inicial y un cliente de ejemplo.
Ejecutar: python -m scripts.seed
"""
import asyncio
import app.models  # noqa: F401 — load all models so relationships resolve
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.auth.models import User, UserRole
from app.auth.security import hash_password
from app.clients.models import Client


async def seed():
    async with AsyncSessionLocal() as db:
        # Check if admin already exists
        result = await db.execute(select(User).where(User.email == "admin@stock.com"))
        if result.scalar_one_or_none():
            print("Admin user already exists, skipping.")
            return

        # Create a demo client
        client = Client(
            name="Cliente Demo",
            business_name="Demo S.A.",
            tax_id="30-12345678-9",
            contact_email="demo@cliente.com",
            contact_phone="+5411999999",
        )
        db.add(client)
        await db.flush()

        # Create admin user (global, no client_id)
        admin = User(
            email="admin@stock.com",
            hashed_password=hash_password("admin123"),
            full_name="Administrador",
            role=UserRole.admin,
            client_id=None,
        )
        db.add(admin)

        # Create operator user
        operator = User(
            email="operario@stock.com",
            hashed_password=hash_password("operario123"),
            full_name="Operario Demo",
            role=UserRole.operator,
            client_id=None,
        )
        db.add(operator)

        # Create client user
        client_user = User(
            email="demo@cliente.com",
            hashed_password=hash_password("cliente123"),
            full_name="Cliente Demo",
            role=UserRole.client,
            client_id=client.id,
        )
        db.add(client_user)

        await db.commit()
        print("Seed completed:")
        print(f"  Admin:    admin@stock.com / admin123")
        print(f"  Operario: operario@stock.com / operario123")
        print(f"  Cliente:  demo@cliente.com / cliente123")


if __name__ == "__main__":
    asyncio.run(seed())
