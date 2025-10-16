from __future__ import annotations

import mimetypes
from http import HTTPStatus

from .router import Response
from .state import ServerState


def serve_static(state: ServerState, bucket: str, relative_path: str) -> Response:
    mount = state.get_mount(bucket)
    base = mount.root
    target = (base / relative_path).resolve()
    if not str(target).startswith(str(base.resolve())):
        return Response.json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
    if not target.exists():
        index_file = target / "index.html"
        if index_file.exists():
            target = index_file
        else:
            return Response.json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
    if target.is_dir():
        index_file = target / "index.html"
        if index_file.exists():
            target = index_file
        elif not mount.directory_listing:
            return Response.json({"error": "Directory listing disabled"}, status=HTTPStatus.FORBIDDEN)
        else:
            entries = sorted(p.name + ("/" if p.is_dir() else "") for p in target.iterdir())
            return Response.json({"entries": entries})
    content_type, _ = mimetypes.guess_type(str(target))
    if not content_type:
        content_type = "application/octet-stream"
    data = target.read_bytes()
    return Response(status=HTTPStatus.OK, body=data, headers={"Content-Type": content_type})
