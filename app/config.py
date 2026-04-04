from pydantic import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://stock_user:stock_pass@localhost:5432/stock_db"

    # JWT
    SECRET_KEY: str = "change-me-to-a-random-secret-key"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # MercadoLibre
    ML_CLIENT_ID: str = ""
    ML_CLIENT_SECRET: str = ""
    ML_REDIRECT_URI: str = "http://localhost:5173/integrations/ml/callback"

    # App
    APP_ENV: str = "development"
    DEBUG: bool = True
    UPLOADS_DIR: str = "uploads"

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
