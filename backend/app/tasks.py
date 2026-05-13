import json
import logging
import datetime
from .worker import celery_app
from .checker import check_target, check_subnet_cidr, COMMON_DNSBLS
from .database import SessionLocal
from .models import Target, CheckHistory
from .alerts import send_slack_alert, send_email_alert

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def monitor_target_task(self, target_id: int):
    db = SessionLocal()
    try:
        target = db.query(Target).filter(Target.id == target_id).first()
        if not target:
            logger.warning("target_not_found", extra={"target_id": target_id})
            return "Target not found"

        logger.info("check_start", extra={"address": target.address, "target_type": target.target_type})
        previous_state = target.is_blacklisted
        now = datetime.datetime.now(datetime.timezone.utc)

        if target.target_type == "subnet":
            subnet_results = check_subnet_cidr(target.address)
            is_listed = bool(subnet_results)
            listed_count = len(subnet_results)
            import ipaddress as _ipaddress
            try:
                total_ips = _ipaddress.ip_network(target.address, strict=False).num_addresses - 2
                total_ips = max(total_ips, 1)
            except Exception:
                total_ips = listed_count
            details = json.dumps({
                "type": "subnet",
                "total_ips": total_ips,
                "listed_count": listed_count,
                "hits": subnet_results,
                "total_checked": len(COMMON_DNSBLS),
                "checked_at": now.isoformat(),
            })
            hit_count = listed_count
        else:
            hits = check_target(target.address, target.target_type)
            is_listed = bool(hits)
            details = json.dumps({
                "hits": hits,
                "total_checked": len(COMMON_DNSBLS),
                "checked_at": now.isoformat(),
            })
            hit_count = len(hits)

        target.is_blacklisted = is_listed
        target.last_checked = now

        if is_listed != previous_state:
            send_slack_alert(target.address, is_listed)
            send_email_alert(target.address, is_listed)

        db.add(CheckHistory(target_id=target.id, status=is_listed, details=details))
        db.commit()
        result = "Listed" if is_listed else "Clean"
        logger.info("check_done", extra={"address": target.address, "result": result, "hits": hit_count})
        return f"Checked {target.address}: {result} ({hit_count} hits)"
    except Exception as exc:
        logger.error("check_error", extra={"target_id": target_id, "error": str(exc)})
        raise self.retry(exc=exc, countdown=60)
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
