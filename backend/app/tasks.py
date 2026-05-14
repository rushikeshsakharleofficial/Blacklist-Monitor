import json
import logging
import datetime
import ipaddress as _ipaddress
import os as _os
from .worker import celery_app
from .checker import check_target, check_subnet_cidr, COMMON_DNSBLS, lookup_org_for_target, lookup_org, check_dnsbl
from .database import SessionLocal
from .models import Target, CheckHistory
from .alerts import send_alerts

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
        if not target.org:
            target.org = lookup_org_for_target(target.address, target.target_type)

        if is_listed != previous_state or target.last_checked is None:
            dispatch_alerts_task.delay(
                target.address,
                is_listed,
                previous_state if target.last_checked else None,
            )

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
        count = 0
        for target in db.query(Target).yield_per(100):
            monitor_target_task.delay(target.id)
            count += 1
        logger.info("batch_queued", extra={"count": count})
        return f"Queued {count} targets"
    finally:
        db.close()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30,
                 soft_time_limit=60, time_limit=90)
def dispatch_alerts_task(self, target_address: str, to_status: bool, from_status):
    try:
        send_alerts(target_address, to_status, from_status, db=None)
    except Exception as exc:
        raise self.retry(exc=exc, countdown=30)


@celery_app.task
def prune_old_history_task(days: int = None):
    if days is None:
        days = int(_os.getenv("HISTORY_RETENTION_DAYS", "90"))
    db = SessionLocal()
    try:
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
        deleted = (
            db.query(CheckHistory)
            .filter(CheckHistory.checked_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        logger.info("history_pruned", extra={"deleted": deleted, "cutoff": cutoff.isoformat()})
        return f"Pruned {deleted} old check history records"
    finally:
        db.close()


@celery_app.task(bind=True, soft_time_limit=600, time_limit=700)
def scan_subnet_task(self, scan_id: str, cidr: str, session_id: int = 0):
    """DNSBL-check all IPs in subnet; write incremental progress to Redis."""
    from .redis_client import rclient
    from concurrent.futures import ThreadPoolExecutor, as_completed as asc
    import json as _json
    import datetime as _dt

    net = _ipaddress.ip_network(cidr, strict=False)
    ips = [str(ip) for ip in net.hosts()] or [str(net.network_address)]
    total = len(ips)
    TTL = 3600
    workers = min(total, 32)
    subnet_org = lookup_org(str(net.network_address))
    total_listed = 0

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(check_dnsbl, ip): ip for ip in ips}
        try:
            for future in asc(futures, timeout=max(300, total * 2)):
                ip = futures[future]
                try:
                    hits = future.result()
                except Exception:
                    hits = []
                if hits:
                    total_listed += 1
                rclient.rpush(f"scan:{scan_id}:results", _json.dumps({
                    "ip": ip, "hits": hits, "is_blacklisted": bool(hits),
                    "total_checked": len(COMMON_DNSBLS),
                    "org": subnet_org,
                }))
                rclient.expire(f"scan:{scan_id}:results", TTL)
                rclient.incr(f"scan:{scan_id}:done")
        except Exception:
            pass

    rclient.setex(f"scan:{scan_id}:info", TTL, _json.dumps({"cidr": cidr, "total": total, "complete": True}))

    if session_id:
        db = SessionLocal()
        try:
            from .models import ScanSession
            sess = db.query(ScanSession).filter(ScanSession.id == session_id).first()
            if sess:
                sess.status = "complete"
                sess.total_listed = total_listed
                sess.completed_at = _dt.datetime.now(_dt.timezone.utc)
                db.commit()
                logger.info("scan_session_complete", extra={"session_id": session_id, "total_listed": total_listed})
        except Exception as e:
            logger.error("scan_session_update_failed", extra={"session_id": session_id, "error": str(e)})
        finally:
            db.close()
