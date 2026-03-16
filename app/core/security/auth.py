from typing import Optional
from fastapi import Header, HTTPException, Request, status

async def api_key_required(request: Request, x_api_key: Optional[str] = Header(None)) -> None:
    """require a valid X-API-Key header after setup."""

    redis = request.app.state.redis
    expected = await redis.get("waf:api_key")
    if not expected:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="setup required")

    if isinstance(expected, (bytes, bytearray)):
        expected = expected.decode()

    query_key = request.query_params.get("api_key")
    if x_api_key != expected and query_key != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid api key")

    return
