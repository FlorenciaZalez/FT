from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth import service
from app.auth.schemas import LoginRequest, TokenResponse, RefreshRequest, RegisterRequest, UpdateUserRequest, UserResponse
from app.auth.dependencies import get_current_user, require_admin
from app.auth.models import User

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await service.authenticate_user(db, body.email, body.password)
    return service.generate_tokens(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    return await service.refresh_access_token(db, body.refresh_token)


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    return user


@router.get("/users", response_model=list[UserResponse])
async def list_users(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Only admins can list all users."""
    return await service.list_users(db)


@router.post("/register", response_model=UserResponse)
async def register(body: RegisterRequest, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Only admins can register new users."""
    return await service.register_user(
        db,
        email=body.email,
        password=body.password,
        full_name=body.full_name,
        role=body.role,
        client_id=body.client_id,
        zones=body.zones,
    )


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: int, body: UpdateUserRequest, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Only admins can update users."""
    return await service.update_user(db, user_id, body.model_dump(exclude_unset=True))
