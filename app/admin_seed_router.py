from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession
import traceback

import app.models  # noqa: F401
from app.auth.models import User, UserRole
from app.auth.security import hash_password, verify_password
from app.clients.models import Client
from app.config import get_settings
from app.database import Base, engine, get_db

router = APIRouter(tags=["Admin Seed"])
settings = get_settings()


@router.get("/create-admin")
async def create_admin(db: AsyncSession = Depends(get_db)):
    email = settings.FIRST_SUPERUSER_EMAIL.strip() or "admin@trod.com"
    password = settings.FIRST_SUPERUSER_PASSWORD or "123456"
    full_name = settings.FIRST_SUPERUSER_FULL_NAME.strip() or "Admin"

    try:
        async with engine.begin() as connection:
            await connection.run_sync(lambda sync_connection: Client.__table__.create(bind=sync_connection, checkfirst=True))
            await connection.run_sync(lambda sync_connection: User.__table__.create(bind=sync_connection, checkfirst=True))

        result = await db.execute(select(User).where(User.email == email))
        existing_user = result.scalar_one_or_none()

        if existing_user is not None:
            existing_user.full_name = full_name
            existing_user.role = UserRole.admin
            existing_user.client_id = None
            existing_user.is_active = True
            existing_user.zones = None
            if not verify_password(password, existing_user.hashed_password):
                existing_user.hashed_password = hash_password(password)

            await db.commit()
            await db.refresh(existing_user)
            return {"message": "admin actualizado"}

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
        await db.commit()
        await db.refresh(admin)

        return {"message": "admin creado"}
    except ProgrammingError as error:
        await db.rollback()
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"ProgrammingError: {str(error)}",
        ) from error
    except SQLAlchemyError as error:
        await db.rollback()
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"SQLAlchemyError: {str(error)}",
        ) from error