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
    # False (default) preserves every existing route's behavior exactly:
    # do_GET/do_POST wrap the handler in ServerState.lock, the one shared
    # mutex serializing all DB access. True marks a route whose handler (and
    # everything it calls) has been specifically audited to route reads
    # through ServerState.read_db and writes through ServerState.lock/db
    # itself — see app.py's do_GET and ServerState.read_db's own comment.
    unlocked: bool = False


class Router:
    def __init__(self) -> None:
        self._routes: Dict[str, list[Route]] = {}

    def add(self, method: str, pattern: str, handler: Handler, unlocked: bool = False) -> None:
        compiled = re.compile(pattern)
        bucket = self._routes.setdefault(method.upper(), [])
        bucket.append(Route(method=method.upper(), pattern=compiled, handler=handler, unlocked=unlocked))

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
        # Drained here, unconditionally, for every request regardless of
        # method or whether the route handler ever calls .json() — a
        # handler that doesn't need a body (e.g. .../delete, which only
        # needs the URL's own {id}) previously left the client's declared
        # Content-Length bytes unread on the socket. On this server's
        # keep-alive (HTTP/1.1) connections, those leftover bytes sit at the
        # front of the stream and get read as part of the *next* request's
        # own request-line instead of a real "METHOD /path HTTP/1.1" —
        # confirmed directly: a POST .../delete with body "{}" corrupted the
        # following GET into the literal method "{}GET", a 501 the client
        # then saw as a failed /list call. Reading (and discarding, if
        # unused) the full declared body here, once, up front, guarantees
        # the socket is always left at a clean request boundary for
        # whatever comes next — independent of which handler runs or
        # whether it happens to read the body itself.
        length = int(handler.headers.get("Content-Length", "0") or "0")
        self._body_bytes = handler.rfile.read(length) if length else b""

    def json(self) -> Any:
        if not self._body_bytes:
            return None
        import json

        return json.loads(self._body_bytes.decode("utf-8"))

    # The pre-drained body as-is, for a route whose body isn't JSON at all
    # (audio/transcribe-chunk's raw audio bytes) — no separate read from the
    # socket, same already-buffered bytes .json() itself decodes from.
    def raw_body(self) -> bytes:
        return self._body_bytes


class Response:
    def __init__(self, status: int = 200, body: Any | None = None, headers: Optional[Dict[str, str]] = None):
        self.status = status
        self.body = body
        self.headers = headers or {}

    @classmethod
    def json(cls, body: Any, status: int = 200) -> "Response":
        import json

        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        # no-store — every API response is dynamic (an encounter's current
        # round, a clock's current fill, ...); none of it should ever be
        # served from the browser's own HTTP cache on a repeat GET. Static
        # files get their own equivalent header in static.py; this is the
        # same reasoning applied to the other kind of response this server
        # sends.
        return cls(
            status=status,
            body=payload,
            headers={"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"},
        )

    @classmethod
    def text(cls, body: str, status: int = 200, content_type: str = "text/plain; charset=utf-8") -> "Response":
        return cls(status=status, body=body.encode("utf-8"), headers={"Content-Type": content_type})

    @classmethod
    def empty(cls, status: int = 204) -> "Response":
        return cls(status=status, body=b"")
