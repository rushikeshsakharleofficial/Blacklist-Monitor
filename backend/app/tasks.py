from .worker import celery_app
from .checker import check_target
from .database import SessionLocal
from .models import Target, CheckHistory
from .alerts import send_slack_alert, send_email_alert
import datetime

@celery_app.task
def monitor_target_task(target_id: int):
    db = SessionLocal()
    try:
        target = db.query(Target).filter(Target.id == target_id).first()
        if not target:
            return "Target not found"

        is_listed = check_target(target.address, target.target_type)

        target.is_blacklisted = is_listed
        target.last_checked = datetime.datetime.utcnow()

        if is_listed:
            send_slack_alert(target.address, is_listed)
            send_email_alert(target.address, is_listed)

        history = CheckHistory(
            target_id=target.id,
            status=is_listed,
            details=f"Checked via DNSBL on {datetime.datetime.utcnow()}"
        )
        db.add(history)
        db.commit()
        return f"Checked {target.address}: {'Listed' if is_listed else 'Clean'}"
    finally:
        db.close()

@celery_app.task
def monitor_all_targets_task():
    db = SessionLocal()
    try:
        targets = db.query(Target).all()
        for target in targets:
            monitor_target_task.delay(target.id)
        return f"Queued {len(targets)} targets"
    finally:
        db.close()
