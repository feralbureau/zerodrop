<div align="center">

![Banner](./assets/banner.png)

# ZeroDrop

### your self-hosted web application firewall.

[![Python Version](https://img.shields.io/badge/python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org/)
[![Django](https://img.shields.io/badge/Django-5.x-092E20?style=for-the-badge&logo=django&logoColor=white)](https://www.djangoproject.com/)
[![License](https://img.shields.io/github/license/feralbureau/zerodrop?style=for-the-badge&color=yellow)](LICENSE)

---

</div>

## What is ZeroDrop?

ZeroDrop is a self-hosted Web Application Firewall that sits in front of your applications and filters malicious traffic in real time.

It uses Caddy `forward_auth` to validate every request through a multi-layer security pipeline and either:

- allows the request (`200`)
- blocks the request (`403`)

The backend is now Django ASGI + Channels, with Redis used for high-frequency/realtime workloads.

## Tech Stack

- Backend: Django, Channels, Daphne
- Data (persistent): Django ORM (SQLite by default)
- Data (ephemeral/realtime): Redis
- Edge proxy: Caddy
- Dashboard: React + TypeScript
- Infra: Docker Compose

## Project Structure

```
.
├─ config/                  # Django settings, ASGI/WSGI, routing, middleware
├─ apps/
│  ├─ core/                 # REST API, models, caddy sync
│  ├─ security/             # WAF engine, auth helpers
│  └─ monitoring/           # WS consumers, uptime/anomaly loops
├─ dashboard/               # React SPA
├─ caddy/                   # Caddy config and image
├─ Dockerfile               # Backend image (Django)
├─ docker-compose.yml
└─ manage.py
```

## Environment

Create `.env` in repository root:

```env
REDIS_URL=redis://localhost:6379/0
DASHBOARD_HOST=localhost
```

## Run with Docker

```bash
docker compose up --build
```

Services:

- `api`: Django ASGI on `:8000`
- `worker`: background loops (`runloops`)
- `redis`
- `caddy`: public entrypoint on `:80`

Open:

- `http://localhost`

## Local Development (without Docker)

1. Start Redis:

```bash
redis-server
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Apply migrations:

```bash
python manage.py migrate
```

4. Run API:

```bash
python manage.py runserver
```

5. Run background loops in another terminal:

```bash
python manage.py runloops
```

## API & WebSocket

REST prefix: `/api/*`

- setup, key validation/regeneration, settings/profile
- domains, allowlist, denylist, blacklist
- logs, rpm, anomalies
- uptime monitors
- `/api/check` for Caddy `forward_auth`

WebSocket:

- `/api/ws/ping`
- `/api/ws/logs`
- `/api/ws/uptime`

## Testing

Run backend tests:

```bash
python manage.py test
```

## Notes

- Persistent business data is stored in ORM models.
- Redis remains for rate counters, EWMA, anomaly windows, and realtime streams.
- Caddy config is generated and hot-loaded from backend on onboarding/domain changes.
