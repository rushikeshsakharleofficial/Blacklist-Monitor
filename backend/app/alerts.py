import os
import json
import logging
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import requests

logger = logging.getLogger(__name__)

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
SMTP_SERVER = os.getenv("SMTP_SERVER", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
ALERT_EMAIL_TO = os.getenv("ALERT_EMAIL_TO", "")

# ── Default templates ─────────────────────────────────────────────────────────
# Variables available: {address}, {from_status}, {to_status}, {timestamp}, {emoji}

DEFAULT_SLACK_LISTED = """\
{
  "blocks": [
    {
      "type": "header",
      "text": {"type": "plain_text", "text": "🚨 Blacklist Alert — IP Listed", "emoji": true}
    },
    {
      "type": "section",
      "fields": [
        {"type": "mrkdwn", "text": "*Target:*\\n`{address}`"},
        {"type": "mrkdwn", "text": "*Status Change:*\\n{from_status_upper} → *{to_status_upper}*"},
        {"type": "mrkdwn", "text": "*Detected At:*\\n{timestamp}"},
        {"type": "mrkdwn", "text": "*Action Required:*\\nInvestigate and request delisting"}
      ]
    },
    {
      "type": "context",
      "elements": [{"type": "mrkdwn", "text": "BlacklistTrailer Monitoring Platform"}]
    }
  ],
  "attachments": [{"color": "#e74c3c", "fallback": "ALERT: {address} is now LISTED"}]
}"""

DEFAULT_SLACK_CLEAN = """\
{
  "blocks": [
    {
      "type": "header",
      "text": {"type": "plain_text", "text": "✅ Blacklist Cleared — IP Clean", "emoji": true}
    },
    {
      "type": "section",
      "fields": [
        {"type": "mrkdwn", "text": "*Target:*\\n`{address}`"},
        {"type": "mrkdwn", "text": "*Status Change:*\\n{from_status_upper} → *{to_status_upper}*"},
        {"type": "mrkdwn", "text": "*Detected At:*\\n{timestamp}"},
        {"type": "mrkdwn", "text": "*Status:*\\nNo action required"}
      ]
    },
    {
      "type": "context",
      "elements": [{"type": "mrkdwn", "text": "BlacklistTrailer Monitoring Platform"}]
    }
  ],
  "attachments": [{"color": "#27ae60", "fallback": "RESOLVED: {address} is now CLEAN"}]
}"""

DEFAULT_EMAIL_SUBJECT_LISTED = "🚨 Blacklist Alert: {address} is LISTED"
DEFAULT_EMAIL_SUBJECT_CLEAN = "✅ Resolved: {address} is now CLEAN"

DEFAULT_EMAIL_BODY_LISTED = """\
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:4px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
  <tr><td style="background:#c0392b;padding:24px 32px;">
    <h1 style="margin:0;color:#fff;font-size:22px;letter-spacing:1px;">🚨 BLACKLIST ALERT</h1>
    <p style="margin:6px 0 0;color:#f8d7da;font-size:13px;">An IP under your monitoring has been listed on a public DNSBL</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:12px 16px;background:#fff5f5;border-left:4px solid #e74c3c;margin-bottom:16px;">
          <p style="margin:0;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Target IP / Domain</p>
          <p style="margin:4px 0 0;font-size:20px;font-weight:bold;color:#2c3e50;font-family:monospace;">{address}</p>
        </td>
      </tr>
      <tr><td style="height:16px;"></td></tr>
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:4px;">
          <tr style="background:#f8f9fa;">
            <td style="padding:10px 16px;font-size:11px;font-weight:bold;color:#666;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #eee;">Field</td>
            <td style="padding:10px 16px;font-size:11px;font-weight:bold;color:#666;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #eee;">Value</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#555;border-bottom:1px solid #eee;">Previous Status</td>
            <td style="padding:10px 16px;font-size:13px;color:#27ae60;font-weight:bold;border-bottom:1px solid #eee;">{from_status_upper}</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#555;border-bottom:1px solid #eee;">Current Status</td>
            <td style="padding:10px 16px;font-size:13px;color:#e74c3c;font-weight:bold;border-bottom:1px solid #eee;">{to_status_upper}</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#555;">Detected At</td>
            <td style="padding:10px 16px;font-size:13px;color:#333;">{timestamp}</td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="height:24px;"></td></tr>
      <tr><td style="background:#fff8e6;border:1px solid #f39c12;border-radius:4px;padding:16px;">
        <p style="margin:0;font-size:13px;color:#7d5a00;font-weight:bold;">⚠ Immediate Action Required</p>
        <p style="margin:6px 0 0;font-size:12px;color:#7d5a00;">Review your IP reputation and submit a delisting request to the relevant DNSBL provider.</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#2c3e50;padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#8ab4c8;">BlacklistTrailer Monitoring Platform</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""

DEFAULT_EMAIL_BODY_CLEAN = """\
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:4px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
  <tr><td style="background:#1a6b3c;padding:24px 32px;">
    <h1 style="margin:0;color:#fff;font-size:22px;letter-spacing:1px;">✅ BLACKLIST CLEARED</h1>
    <p style="margin:6px 0 0;color:#d4f5e2;font-size:13px;">Your monitored IP has been removed from public DNSBLs</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:12px 16px;background:#f0fff4;border-left:4px solid #27ae60;">
          <p style="margin:0;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Target IP / Domain</p>
          <p style="margin:4px 0 0;font-size:20px;font-weight:bold;color:#2c3e50;font-family:monospace;">{address}</p>
        </td>
      </tr>
      <tr><td style="height:16px;"></td></tr>
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:4px;">
          <tr style="background:#f8f9fa;">
            <td style="padding:10px 16px;font-size:11px;font-weight:bold;color:#666;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #eee;">Field</td>
            <td style="padding:10px 16px;font-size:11px;font-weight:bold;color:#666;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #eee;">Value</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#555;border-bottom:1px solid #eee;">Previous Status</td>
            <td style="padding:10px 16px;font-size:13px;color:#e74c3c;font-weight:bold;border-bottom:1px solid #eee;">{from_status_upper}</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#555;border-bottom:1px solid #eee;">Current Status</td>
            <td style="padding:10px 16px;font-size:13px;color:#27ae60;font-weight:bold;border-bottom:1px solid #eee;">{to_status_upper}</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#555;">Detected At</td>
            <td style="padding:10px 16px;font-size:13px;color:#333;">{timestamp}</td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="height:16px;"></td></tr>
      <tr><td style="background:#f0fff4;border:1px solid #27ae60;border-radius:4px;padding:16px;text-align:center;">
        <p style="margin:0;font-size:14px;color:#1a6b3c;font-weight:bold;">🎉 No action required</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#2c3e50;padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#8ab4c8;">BlacklistTrailer Monitoring Platform</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""

TEMPLATE_KEYS = {
    "slack_listed": DEFAULT_SLACK_LISTED,
    "slack_clean": DEFAULT_SLACK_CLEAN,
    "email_subject_listed": DEFAULT_EMAIL_SUBJECT_LISTED,
    "email_subject_clean": DEFAULT_EMAIL_SUBJECT_CLEAN,
    "email_body_listed": DEFAULT_EMAIL_BODY_LISTED,
    "email_body_clean": DEFAULT_EMAIL_BODY_CLEAN,
}


def _get_template(key: str, db=None) -> str:
    if db is not None:
        try:
            from . import models
            row = db.query(models.AppSetting).filter(models.AppSetting.key == f"alert_tpl_{key}").first()
            if row:
                return row.value
        except Exception:
            pass
    return TEMPLATE_KEYS.get(key, "")


def _render(template: str, address: str, from_status: str, to_status: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return template.format(
        address=address,
        from_status=from_status,
        to_status=to_status,
        from_status_upper=from_status.upper(),
        to_status_upper=to_status.upper(),
        timestamp=ts,
        emoji="🚨" if to_status == "listed" else "✅",
    )


def channels_status() -> dict:
    return {
        "slack": {"configured": bool(SLACK_WEBHOOK_URL)},
        "email": {
            "configured": bool(SMTP_SERVER and SMTP_USER and SMTP_PASSWORD and ALERT_EMAIL_TO),
            "to": ALERT_EMAIL_TO or None,
            "server": SMTP_SERVER or None,
        },
    }


def _send_slack_payload(payload_str: str) -> bool:
    try:
        try:
            payload = json.loads(payload_str)
        except Exception:
            payload = {"text": payload_str}
        r = requests.post(SLACK_WEBHOOK_URL, json=payload, timeout=10)
        return r.status_code == 200
    except Exception as e:
        logger.error("slack_alert_error", extra={"error": str(e)})
        return False


def _send_email(subject: str, html_body: str) -> bool:
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_USER
        msg["To"] = ALERT_EMAIL_TO
        msg.attach(MIMEText(html_body, "html"))
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
        return True
    except Exception as e:
        logger.error("email_alert_error", extra={"error": str(e)})
        return False


def send_alerts(target_address: str, to_status: bool, from_status: bool | None = None, db=None) -> list[str]:
    to_label = "listed" if to_status else "clean"
    from_label = "new" if from_status is None else ("listed" if from_status else "clean")
    tpl_suffix = "listed" if to_status else "clean"

    notified: list[str] = []

    if SLACK_WEBHOOK_URL:
        raw = _get_template(f"slack_{tpl_suffix}", db)
        rendered = _render(raw, target_address, from_label, to_label)
        if _send_slack_payload(rendered):
            notified.append("slack")

    if SMTP_SERVER and SMTP_USER and SMTP_PASSWORD and ALERT_EMAIL_TO:
        subj_raw = _get_template(f"email_subject_{tpl_suffix}", db)
        body_raw = _get_template(f"email_body_{tpl_suffix}", db)
        subject = _render(subj_raw, target_address, from_label, to_label)
        body = _render(body_raw, target_address, from_label, to_label)
        if _send_email(subject, body):
            notified.append("email")

    if db is not None:
        try:
            from . import models
            db.add(models.AlertLog(
                target_address=target_address,
                from_status=from_label,
                to_status=to_label,
                channels=json.dumps(notified),
            ))
            db.commit()
        except Exception as e:
            logger.error("alert_log_write_error", extra={"error": str(e)})

    return notified


# Backward-compat stubs (tasks.py still calls these)
def send_slack_alert(target_address: str, status: bool):
    pass  # handled inside send_alerts


def send_email_alert(target_address: str, status: bool):
    pass


def test_slack() -> dict:
    if not SLACK_WEBHOOK_URL:
        return {"ok": False, "error": "SLACK_WEBHOOK_URL not configured"}
    ok = _send_slack_payload(json.dumps({
        "blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": "🔔 Test Notification", "emoji": True}},
            {"type": "section", "text": {"type": "mrkdwn", "text": "This is a *test alert* from BlacklistTrailer. Your Slack integration is working correctly. ✅"}},
        ],
        "attachments": [{"color": "#336699", "fallback": "BlacklistTrailer test notification"}]
    }))
    return {"ok": ok, "error": None if ok else "Slack returned non-200. Check your webhook URL."}


def test_email() -> dict:
    if not all([SMTP_SERVER, SMTP_USER, SMTP_PASSWORD, ALERT_EMAIL_TO]):
        return {"ok": False, "error": "SMTP settings incomplete"}
    ok = _send_email(
        "🔔 BlacklistTrailer — Test Alert",
        """<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:32px;">
<table width="600" style="background:#fff;border-radius:4px;overflow:hidden;margin:0 auto;">
  <tr><td style="background:#336699;padding:24px 32px;">
    <h1 style="margin:0;color:#fff;font-size:20px;">🔔 Test Notification</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="color:#333;font-size:14px;">Your BlacklistTrailer email alert integration is working correctly.</p>
    <p style="color:#888;font-size:12px;">No action required — this is a test message.</p>
  </td></tr>
  <tr><td style="background:#2c3e50;padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#8ab4c8;">BlacklistTrailer Monitoring Platform</p>
  </td></tr>
</table></body></html>""",
    )
    return {"ok": ok, "error": None if ok else "Failed to send email. Check SMTP settings."}
