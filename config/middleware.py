from __future__ import annotations

from django.http import HttpResponse


class SimpleCorsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self.allowed_origins = {
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "https://localhost:5173",
            "https://127.0.0.1:5173",
        }
        self.allowed_headers = "Content-Type, X-API-Key, Authorization"
        self.allowed_methods = "GET, POST, PUT, DELETE, OPTIONS, HEAD"

    def __call__(self, request):
        if request.method == "OPTIONS" and request.path.startswith("/api/"):
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)

        origin = request.headers.get("Origin")
        if origin in self.allowed_origins:
            response["Access-Control-Allow-Origin"] = origin
            response["Vary"] = "Origin"
            response["Access-Control-Allow-Credentials"] = "true"
            response["Access-Control-Allow-Headers"] = self.allowed_headers
            response["Access-Control-Allow-Methods"] = self.allowed_methods
            response["Access-Control-Max-Age"] = "86400"

        return response
