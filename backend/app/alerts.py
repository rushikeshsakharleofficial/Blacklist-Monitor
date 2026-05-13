import os
import logging
import requests
import smtplib
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL")
SMTP_SERVER = os.getenv("SMTP_SERVER")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
ALERT_EMAIL_TO = os.getenv("ALERT_EMAIL_TO")

def send_slack_alert(target_address: str, status: bool):
    if not SLACK_WEBHOOK_URL:
        return
    
    message = f"🚨 *Blacklist Alert* 🚨\nTarget: `{target_address}` is now *{'LISTED' if status else 'CLEAN'}*."
    try:
        requests.post(SLACK_WEBHOOK_URL, json={"text": message})
    except Exception as e:
        logger.error("slack_alert_error", extra={"error": str(e)})

def send_email_alert(target_address: str, status: bool):
    if not all([SMTP_SERVER, SMTP_USER, SMTP_PASSWORD, ALERT_EMAIL_TO]):
        return
    
    subject = f"Blacklist Alert: {target_address} is {'LISTED' if status else 'CLEAN'}"
    body = f"The target {target_address} was found to be {'blacklisted' if status else 'clean'} during the latest check."
    
    msg = MIMEText(body)
    msg['Subject'] = subject
    msg['From'] = SMTP_USER
    msg['To'] = ALERT_EMAIL_TO
    
    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
    except Exception as e:
        logger.error("email_alert_error", extra={"error": str(e)})
