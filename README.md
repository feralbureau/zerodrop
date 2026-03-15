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
