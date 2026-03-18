# ZeroDrop WAF

High-performance Web Application Firewall.
Designed to protect web applications from DDoS attacks and malicious traffic in real-time.

## Stack
- Python 3.11+
- FastAPI
- Redis
- Nginx

## Features
- Real-time traffic monitoring via WebSockets
- Dynamic rate limiting using Redis
- Integration with Nginx auth_request
- Automated IP blacklisting
- High-throughput asynchronous backend

## Quick Start
1. Clone the repo
2. Start Redis
3. Run `uvicorn app.main:app --reload`

## Hosting (internal-only API)
The dashboard expects the API to be reachable through the same host at `/api`.

Required environment:
- `DASHBOARD_HOST` (example: `dash.example.com` or `localhost`)

Optional environment:
- `VITE_API_BASE_URL` for the dashboard build. It can be either:
  - a plain origin like `https://dash.example.com`
  - or a full API root like `https://dash.example.com/api`

Local Docker example:
1. Set `DASHBOARD_HOST=localhost` (host only, no scheme)
2. Run `docker compose up --build`
3. Open `http://localhost`
