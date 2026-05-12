from .worker import celery_app
from .checker import check_dnsbl
from .database import SessionLocal
from .models import Target, CheckHistory
import datetime

@celery_app.task
def monitor_target_task(target_id: int):
    db = SessionLocal()
    try:
        target = db.query(Target).filter(Target.id == target_id).first()
        if not target:
            return "Target not found"

        is_listed = check_dnsbl(target.address)
        
        # Update target status
        target.is_blacklisted = is_listed
        target.last_checked = datetime.datetime.utcnow()
        
        # Add history entry
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
