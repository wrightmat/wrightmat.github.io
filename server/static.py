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


# Names that must never leave the machine: server code, the database, credentials and VCS data.
_BLOCKED_TOP_LEVEL = {"server", "data"}
_BLOCKED_SUFFIXES = (".py", ".pyc", ".sqlite", ".sqlite-wal", ".sqlite-shm", ".db", ".log", ".bat", ".sh")


def _is_blocked(relative_path: str) -> bool:
    parts = [part for part in relative_path.replace("\\", "/").split("/") if part]
    if not parts:
        return False
    if parts[0].lower() in _BLOCKED_TOP_LEVEL:
        return True
    # Library content lives in per-kind folders under common/data and is served by the API
    # (with its owner and sharing rules); only the flat reference files beside them are static.
    if len(parts) > 4 and [p.lower() for p in parts[:3]] == ["undercroft", "common", "data"]:
        return True
    if "__pycache__" in parts:
        return True
    for part in parts:
        lowered = part.lower()
        if lowered.startswith("."):
            return True
    name = parts[-1].lower()
    if name in {"server.config.json", "secret.local.json"} or name.endswith(".local.json"):
        return True
    return name.endswith(_BLOCKED_SUFFIXES) or ".bak" in name


def _serve_from_base(
    base: Path,
    relative_path: str,
    *,
    directory_listing: bool,
    directory_extensions: list[str] | None = None,
    if_none_match: str | None = None,
) -> Response:
    base = base.resolve()
    cleaned = _normalise_path(unquote(relative_path))
    target = base if not cleaned else (base / cleaned)
    target = target.resolve()
    if _is_blocked(str(target.relative_to(base)) if target != base and base in target.parents else cleaned):
        raise FileNotFoundError(relative_path)

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

    return _file_response(target, if_none_match)


def _file_response(target: Path, if_none_match: str | None) -> Response:
    content_type, _ = mimetypes.guess_type(str(target))
    if not content_type:
        content_type = "application/octet-stream"
    data = target.read_bytes()
    # no-cache plus an ETag: the browser revalidates every time but only re-downloads a changed file.
    stat = target.stat()
    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
    headers = {"Content-Type": content_type, "Cache-Control": "no-cache", "ETag": etag}
    if if_none_match and etag in [tag.strip() for tag in if_none_match.split(",")]:
        return Response(status=HTTPStatus.NOT_MODIFIED, body=None, headers=headers)
    return Response(status=HTTPStatus.OK, body=data, headers=headers)


def serve_from_root(state: ServerState, relative_path: str, if_none_match: str | None = None) -> Response:
    cleaned = _normalise_path(unquote(relative_path)).replace("\\", "/")
    if cleaned.split("/", 1)[0] not in state.config.options.static_roots:
        raise FileNotFoundError(relative_path)
    # With a separate data directory, the few files the server writes next to the shipped ones are served from there.
    parts = [part for part in cleaned.split("/") if part]
    if state.config.options.data_dir and ".." not in parts and len(parts) == 4 and parts[0] == "undercroft":
        logical = parts[1:]
        overlay_dirs = (["common", "data"], ["press", "data"], ["loom", "mappings"])
        if logical[:2] in overlay_dirs and not _is_blocked(cleaned):
            candidate = state.write_path(*logical)
            if candidate.is_file():
                return _file_response(candidate, if_none_match)
    return _serve_from_base(
        state.root_dir,
        relative_path,
        directory_listing=False,
        if_none_match=if_none_match,
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
