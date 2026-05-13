import logging
import datetime
from .worker import celery_app
from .checker import check_target
from .database import SessionLocal
from .models import Target, CheckHistory
from .alerts import send_slack_alert, send_email_alert

logger = logging.getLogger(__name__)


@celery_app.task
def monitor_target_task(target_id: int):
    db = SessionLocal()
    try:
        target = db.query(Target).filter(Target.id == target_id).first()
        if not target:
            logger.warning("target_not_found", extra={"target_id": target_id})
            return "Target not found"

        logger.info("check_start", extra={"address": target.address, "target_type": target.target_type})
        previous_state = target.is_blacklisted
        is_listed = check_target(target.address, target.target_type)

        target.is_blacklisted = is_listed
        target.last_checked = datetime.datetime.now(datetime.timezone.utc)

        if is_listed and not previous_state:
            send_slack_alert(target.address, is_listed)
            send_email_alert(target.address, is_listed)

        db.add(CheckHistory(
            target_id=target.id,
            status=is_listed,
            details=f"Checked via DNSBL on {datetime.datetime.now(datetime.timezone.utc).isoformat()}",
        ))
        db.commit()
        result = "Listed" if is_listed else "Clean"
        logger.info("check_done", extra={"address": target.address, "result": result})
        return f"Checked {target.address}: {result}"
    except Exception as exc:
        logger.error("check_error", extra={"target_id": target_id, "error": str(exc)})
        raise
    finally:
        db.close()


@celery_app.task
def monitor_all_targets_task():
    db = SessionLocal()
    try:
        targets = db.query(Target).all()
        for target in targets:
            monitor_target_task.delay(target.id)
        logger.info("batch_queued", extra={"count": len(targets)})
        return f"Queued {len(targets)} targets"
    finally:
        db.close()
