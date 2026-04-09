from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User, UserRole
from app.auth.security import hash_password
from app.database import get_db

router = APIRouter(tags=["Admin Seed"])


@router.post("/create-admin")
async def create_admin(db: AsyncSession = Depends(get_db)):
    email = "admin@trod.com"
    password = "123456"

    try:
        result = await db.execute(select(User).where(User.email == email))
        existing_user = result.scalar_one_or_none()

        if existing_user is not None:
            return {"message": "admin ya existe"}

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
        await db.refresh(admin)

        return {"message": "admin creado"}
    except ProgrammingError as error:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail="La tabla de usuarios no esta disponible en la base de datos",
        ) from error
    except SQLAlchemyError as error:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail="No se pudo crear el usuario administrador",
        ) from error