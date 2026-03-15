from typing import Optional

from pydantic import BaseModel


class WafCheckResponse(BaseModel):
    allowed: bool
    reason: Optional[str] = None
    count: Optional[int] = None


__all__ = ["WafCheckResponse"]
