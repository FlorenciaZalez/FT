from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User, UserRole
from app.auth.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token
from app.common.exceptions import NotFoundError, ConflictError, BadRequestError


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(password, user.hashed_password):
        raise BadRequestError("Invalid email or password")
    if not user.is_active:
        raise BadRequestError("User account is inactive")
    return user


def generate_tokens(user: User) -> dict:
    payload = {"sub": str(user.id), "role": user.role.value}
    if user.client_id:
        payload["client_id"] = user.client_id
    return {
        "access_token": create_access_token(payload),
        "refresh_token": create_refresh_token(payload),
        "token_type": "bearer",
    }


async def refresh_access_token(db: AsyncSession, refresh_token: str) -> dict:
    payload = decode_token(refresh_token)
    if payload is None or payload.get("type") != "refresh":
        raise BadRequestError("Invalid refresh token")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == int(user_id), User.is_active.is_(True)))
    user = result.scalar_one_or_none()
    if user is None:
        raise NotFoundError("User not found")
    return generate_tokens(user)


async def list_users(db: AsyncSession) -> list[User]:
    result = await db.execute(select(User).order_by(User.id))
    return list(result.scalars().all())


async def register_user(
    db: AsyncSession,
    email: str,
    password: str,
    full_name: str,
    role: str,
    client_id: int | None,
    zones: list[str] | None = None,
) -> User:
    # Check duplicate email
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise ConflictError("Email already registered")

    user = User(
        email=email,
        hashed_password=hash_password(password),
        full_name=full_name,
        role=UserRole(role),
        client_id=client_id,
        is_active=True,
        zones=zones,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


async def update_user(
    db: AsyncSession,
    user_id: int,
    data: dict,
) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise NotFoundError(f"User {user_id} not found")

    for field in ("full_name", "role", "client_id", "zones", "is_active"):
        if field in data and data[field] is not None:
            value = data[field]
            if field == "role":
                value = UserRole(value)
            setattr(user, field, value)

    await db.flush()
    await db.refresh(user)
    return user
