"""
Seed script: creates the initial admin user.
Run with: python -m app.seed
"""
import asyncio
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.auth.models import User, UserRole
from app.auth.security import hash_password


async def seed():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.role == UserRole.admin).limit(1))
        if result.scalar_one_or_none():
            print("Admin user already exists, skipping seed.")
            return

        admin = User(
            email="admin@stock.com",
            hashed_password=hash_password("admin123"),
            full_name="System Admin",
            role=UserRole.admin,
            client_id=None,
            is_active=True,
        )
        db.add(admin)
        await db.commit()
        print(f"Admin user created: admin@stock.com / admin123")


if __name__ == "__main__":
    asyncio.run(seed())
