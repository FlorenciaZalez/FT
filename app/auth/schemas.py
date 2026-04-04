from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: str = "client"
    client_id: int | None = None
    zones: list[str] | None = None


class UpdateUserRequest(BaseModel):
    full_name: str | None = None
    role: str | None = None
    client_id: int | None = None
    zones: list[str] | None = None
    is_active: bool | None = None


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    client_id: int | None
    is_active: bool
    zones: list[str] | None = None

    class Config:
        orm_mode = True
