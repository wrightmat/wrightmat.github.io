from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Pattern, Tuple

Handler = Callable[["Request"], "Response"]


@dataclass
class Route:
    method: str
    pattern: Pattern[str]
    handler: Handler


class Router:
    def __init__(self) -> None:
        self._routes: Dict[str, list[Route]] = {}

    def add(self, method: str, pattern: str, handler: Handler) -> None:
        compiled = re.compile(pattern)
        bucket = self._routes.setdefault(method.upper(), [])
        bucket.append(Route(method=method.upper(), pattern=compiled, handler=handler))

    def match(self, method: str, path: str) -> Optional[Tuple[Route, Dict[str, str]]]:
        routes = self._routes.get(method.upper(), [])
        for route in routes:
            match = route.pattern.match(path)
            if match:
                return route, match.groupdict()
        return None


class Request:
    def __init__(self, handler):
        self.handler = handler
        self.method = handler.command
        self.path = handler.path
        self.headers = handler.headers
        self.state = handler.server.state

    def json(self) -> Any:
        length = int(self.handler.headers.get("Content-Length", "0"))
        if length == 0:
            return None
        body = self.handler.rfile.read(length)
        import json

        return json.loads(body.decode("utf-8"))


class Response:
    def __init__(self, status: int = 200, body: Any | None = None, headers: Optional[Dict[str, str]] = None):
        self.status = status
        self.body = body
        self.headers = headers or {}

    @classmethod
    def json(cls, body: Any, status: int = 200) -> "Response":
        import json

        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        return cls(status=status, body=payload, headers={"Content-Type": "application/json; charset=utf-8"})

    @classmethod
    def text(cls, body: str, status: int = 200, content_type: str = "text/plain; charset=utf-8") -> "Response":
        return cls(status=status, body=body.encode("utf-8"), headers={"Content-Type": content_type})

    @classmethod
    def empty(cls, status: int = 204) -> "Response":
        return cls(status=status, body=b"")
