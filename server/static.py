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
    # No Cache-Control here at all meant every static asset (every JS module,
    # every CSS file) was left to the browser's own heuristic caching, which
    # can silently serve a stale cached copy on an ordinary navigation (e.g.
    # journal-encounter.js's own location.search-driven reload) while a
    # manual hard refresh happens to force revalidation and picks up the
    # current file — confirmed as the actual cause of a "works after
    # refresh, not right after" symptom that had nothing to do with the
    # widget/render code itself. This is a local dev server with no build
    # step or filename versioning, so there's no upside to letting the
    # browser cache these at all.
    return Response(
        status=HTTPStatus.OK,
        body=data,
        headers={"Content-Type": content_type, "Cache-Control": "no-cache"},
    )


def serve_from_root(state: ServerState, relative_path: str) -> Response:
    return _serve_from_base(
        state.root_dir,
        relative_path,
        directory_listing=False,
    )


# Deliberately has NO base-root restriction like _serve_from_base above —
# this exists specifically to serve an ARBITRARY absolute path anywhere on
# disk (see undercroft/common/js/lib/widgets/browser.js's own header for
# why: a GM's local file, embedded via this server instead of a bare
# file:// URL, since browsers refuse to load file: as an iframe/img
# subresource at all). Safety here comes entirely from WHO is allowed to
# call this at all — the loopback-only + GM-tier check in app.py's own
# handle_local_file, the one and only caller — not from validating the path
# itself, since there's no "allowed root" to validate it against in the
# first place. Do not call this from anywhere that hasn't done that check.
def serve_local_file(path: str) -> Response:
    if not path:
        raise FileNotFoundError(path)
    try:
        target = Path(path).resolve()
    except OSError:
        raise FileNotFoundError(path)
    if not target.is_file():
        raise FileNotFoundError(path)
    content_type, _ = mimetypes.guess_type(str(target))
    if not content_type:
        content_type = "application/octet-stream"
    return Response(
        status=HTTPStatus.OK,
        body=target.read_bytes(),
        headers={"Content-Type": content_type, "Cache-Control": "no-cache"},
    )
