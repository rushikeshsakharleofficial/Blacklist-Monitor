# Blacklist Monitor Design

## Overview
A scalable monitoring dashboard for IP and Domain blacklisting with real-time alerting via Email, Slack, and Webhooks.

## Architecture (Approach 1: FastAPI + Celery + React)
- **Backend:** FastAPI (Python) for async API endpoints.
- **Task Queue:** Celery with Redis for background blacklist checks (DNSBL & Security APIs).
- **Database:** PostgreSQL for persistent storage of targets, history, and alert configurations.
- **Frontend:** React + Tailwind CSS, designed using Stitch API for a professional UI.
- **Alerting:** Dedicated service modules for Email (SMTP), Slack (Webhooks), and Custom Webhooks.

## Components
### 1. Dashboard UI (Stitch)
- **Overview Cards:** Summary stats (Total, Listed, Pending, Alerts).
- **Target Table:** List of IPs/Domains with status badges and check history.
- **Add Target Form:** Input field to add new monitoring targets.
- **Alerts Feed:** Recent notifications and scan logs.

### 2. Monitoring Engine
- **DNSBL Checker:** Performs direct DNS queries to major blacklists (Spamhaus, Barracuda, etc.).
- **API Aggregator:** Integrates with external security APIs (VirusTotal, AbuseIPDB) for enhanced data.
- **Scheduler:** Triggers background monitoring tasks periodically.

### 3. Alerting System
- **Event Dispatcher:** Routes blacklist hits to configured alert channels.
- **Template Engine:** Formats alert messages for different platforms.

## Data Flow
1. User adds IP/Domain via React Dashboard.
2. FastAPI stores target in PostgreSQL and triggers an initial check via Celery.
3. Celery worker performs "Hybrid" check (DNS + APIs).
4. Worker updates PostgreSQL with status.
5. If blacklisted, Event Dispatcher sends alerts to Slack/Email.
6. React Frontend updates status in real-time (via polling or WebSockets).

## Error Handling
- Retries for failed API/DNS queries with exponential backoff.
- Logging of alerting failures to the dashboard for user visibility.

## Testing Strategy
- **Unit Tests:** For checker logic and data models.
- **Integration Tests:** For Celery tasks and database interactions.
- **End-to-End Tests:** For the dashboard UI flows.
