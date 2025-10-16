from __future__ import annotations

import mimetypes
from http import HTTPStatus
from pathlib import Path

from urllib.parse import unquote

from .router import Response
from .state import ServerState


def _normalise_path(relative_path: str) -> str:
    cleaned = relative_path.strip()
    # Keep trailing slash so directories resolve to their index if present.
    if cleaned and cleaned.startswith("/"):
        cleaned = cleaned.lstrip("/")
    return cleaned


def _serve_from_base(
    base: Path,
    relative_path: str,
    *,
    directory_listing: bool,
    directory_extensions: list[str] | None = None,
) -> Response:
    base = base.resolve()
    cleaned = _normalise_path(unquote(relative_path))
    target = base if not cleaned else (base / cleaned)
    target = target.resolve()

    try:
        target.relative_to(base)
    except ValueError:
        raise FileNotFoundError(relative_path)

    if target.is_dir():
        index_file = (target / "index.html").resolve()
        if index_file.exists():
            target = index_file
        elif directory_listing:
            entries = []
            extensions = [ext.lower() for ext in (directory_extensions or [])]
            for path in sorted(target.iterdir()):
                if extensions and path.is_file() and path.suffix.lower() not in extensions:
                    continue
                entries.append(path.name + ("/" if path.is_dir() else ""))
            return Response.json({"entries": entries})
        else:
            raise FileNotFoundError(relative_path)

    if not target.exists():
        raise FileNotFoundError(relative_path)

    content_type, _ = mimetypes.guess_type(str(target))
    if not content_type:
        content_type = "application/octet-stream"
    data = target.read_bytes()
    return Response(status=HTTPStatus.OK, body=data, headers={"Content-Type": content_type})


def serve_from_root(state: ServerState, relative_path: str) -> Response:
    return _serve_from_base(
        state.root_dir,
        relative_path,
        directory_listing=False,
    )
