"""
Celery tasks for alert checks.
Runs periodically to detect stock issues and delayed orders.
"""
import asyncio
from app.tasks import celery_app
from app.database import AsyncSessionLocal
from app.alerts.service import run_all_checks


@celery_app.task(name="tasks.check_alerts")
def check_alerts():
    """Run all automatic alert checks (stock, delayed orders, prepared-not-dispatched)."""
    async def _run():
        async with AsyncSessionLocal() as db:
            alerts = await run_all_checks(db)
            await db.commit()
            return len(alerts)

    count = asyncio.run(_run())
    return {"alerts_created": count}


# Schedule: run every 10 minutes
celery_app.conf.beat_schedule = {
    "check-alerts-every-10-min": {
        "task": "tasks.check_alerts",
        "schedule": 600.0,  # seconds
    },
}
