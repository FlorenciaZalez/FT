# Celery configuration
from celery import Celery
from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "stock_tasks",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="America/Argentina/Buenos_Aires",
    enable_utc=True,
    task_track_started=True,
)

# Auto-discover tasks
celery_app.autodiscover_tasks(["app.tasks"])
