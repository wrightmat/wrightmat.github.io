from __future__ import annotations

import http.server
import json
import logging
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from pathlib import Path
from typing import Any, Dict, Optional

from . import groups as group_store

from .auth import (
    AuthError,
    User,
    cleanup_sessions,
    ensure_default_admin,
    ensure_default_test_users,
    get_user_by_session,
    get_user_by_username,
    init_auth_db,
    login_user,
    logout_user,
    register_user,
    list_users,
    verify_registration,
    upgrade_user,
    delete_user,
    update_email_address,
    update_password,
)
from .builtins import builtin_catalog
from .config import ConfigLoader
from .importer import run_importer
from .roles import role_rank
from .router import Request, Response, Router
from .shares import (
    create_share_link,
    get_share_link,
    list_shareable_users,
    list_shares,
    revoke_share,
    revoke_share_link,
    share_with_user,
)
from .state import ServerState, configure_logging
from .static import serve_from_root
from .kinds import normalize_kind
from .storage import (
    AuthError as StorageAuthError,
    delete_item,
    get_item,
    init_storage_db,
    is_owner,
    list_bucket,
    list_owned_content,
    save_item,
    update_owner,
)
class SheetsHTTPServer(http.server.ThreadingHTTPServer):
    def __init__(self, server_address, RequestHandlerClass, state: ServerState):
        super().__init__(server_address, RequestHandlerClass)
        self.state = state
        self._shutdown_event = threading.Event()

    def serve_forever(self, poll_interval: float = 0.5) -> None:
        loader = self.state.config_loader
        config = loader.get()
        if config.options.config_watch:
            loader.watch(lambda cfg: self.state.reload(cfg), stop_event=self._shutdown_event)
        super().serve_forever(poll_interval=poll_interval)

    def shutdown(self) -> None:
        self._shutdown_event.set()
        super().shutdown()


class RequestHandler(http.server.BaseHTTPRequestHandler):
    router = Router()

    def log_message(self, fmt: str, *args) -> None:  # pragma: no cover - uses logging
        logging.info("%s - - %s", self.client_address[0], fmt % args)

    # Utility methods
    def _send_response(self, response: Response) -> None:
        self.send_response(response.status)
        self.send_header("Access-Control-Allow-Origin", self.server.state.config.options.cors_origin)
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        for key, value in response.headers.items():
            self.send_header(key, value)
        if response.body is None:
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_header("Content-Length", str(len(response.body)))
        self.end_headers()
        self.wfile.write(response.body)

    def do_OPTIONS(self) -> None:
        response = Response(status=HTTPStatus.NO_CONTENT)
        self._send_response(response)

    def _request(self) -> Request:
        return Request(self)

    # Authentication helpers
    def current_user(self) -> Optional[User]:
        token = None
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
        return get_user_by_session(self.server.state, token)

    def respond(self, response: Response) -> None:
        self._send_response(response)

    def do_GET(self) -> None:
        request = self._request()
        match = self.router.match("GET", request.handler.path.split("?")[0])
        if match:
            route, params = match
            request.params = params  # type: ignore[attr-defined]
            try:
                # ThreadingHTTPServer runs each request on its own thread, but
                # every route shares one sqlite3.Connection (check_same_thread
                # =False only disables Python's same-thread check — it does
                # not make concurrent statement execution on that connection
                # safe). Every Library-kind read now touches the DB too (the
                # last_accessed_at stamp in get_item), so a page firing several
                # concurrent GETs (e.g. Press loading "all backgrounds") could
                # crash with a sqlite threading error. This lock serializes
                # request handling — coarse-grained, but this is a small dev
                # server, not something needing real read concurrency.
                with self.server.state.lock:
                    result = route.handler(request)
                self.respond(result)
                return
            except AuthError as exc:
                self.respond(Response.json({"error": str(exc)}, status=HTTPStatus.UNAUTHORIZED))
                return
            except StorageAuthError as exc:
                self.respond(Response.json({"error": str(exc)}, status=HTTPStatus.FORBIDDEN))
                return
            except FileNotFoundError:
                self.respond(Response.json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND))
                return
            except Exception as exc:  # pragma: no cover - fallback
                logging.exception("GET handler error")
                self.respond(Response.json({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR))
                return
        # static fallback: serve any file relative to the repository root
        path_only = request.handler.path.split("?")[0]
        relative_path = path_only.lstrip("/")
        try:
            response = serve_from_root(self.server.state, relative_path)
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        self.respond(response)

    def do_POST(self) -> None:
        request = self._request()
        match = self.router.match("POST", request.handler.path.split("?")[0])
        if match:
            route, params = match
            request.params = params  # type: ignore[attr-defined]
            try:
                # See do_GET's comment — same shared-connection concurrency
                # concern applies to writes.
                with self.server.state.lock:
                    result = route.handler(request)
                self.respond(result)
                return
            except AuthError as exc:
                self.respond(Response.json({"error": str(exc)}, status=HTTPStatus.UNAUTHORIZED))
                return
            except StorageAuthError as exc:
                self.respond(Response.json({"error": str(exc)}, status=HTTPStatus.FORBIDDEN))
                return
            except FileNotFoundError:
                self.respond(Response.json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND))
                return
            except Exception as exc:  # pragma: no cover
                logging.exception("POST handler error")
                self.respond(Response.json({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR))
                return
        self.respond(Response.json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND))


def register_routes():
    router = RequestHandler.router

    def json_response(data: Any, status: int = 200) -> Response:
        return Response.json(data, status=status)

    def require_json(request: Request) -> Dict[str, Any]:
        body = request.json()
        return body or {}

    def require_user(request: Request) -> User:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        return user

    def bucket_from_content_type(content_type: str) -> str:
        # content_type and Library `kind` are the same string now — every kind
        # is DB-backed via library_items, so there's no fixed allowlist to
        # check, just the legacy plural-bucket-name normalization every other
        # route also applies (see normalize_kind).
        if not content_type:
            raise AuthError("Invalid content type")
        return normalize_kind(content_type)

    # GET /healthz
    def handle_healthz(request: Request) -> Response:
        return json_response({"ok": True})

    router.add("GET", r"^/healthz$", handle_healthz)

    # GET /list/{bucket}
    def handle_list(request: Request) -> Response:
        params = getattr(request, "params")
        bucket = normalize_kind(params["bucket"])
        user = request.handler.current_user()
        payload = list_bucket(request.state, bucket, user)
        return json_response(payload)

    router.add("GET", r"^/list/(?P<bucket>[^/]+)$", handle_list)

    # GET /content/{bucket}/{id}
    def handle_get_content(request: Request) -> Response:
        params = getattr(request, "params")
        bucket = normalize_kind(params["bucket"])
        id_ = params["id"]
        user = request.handler.current_user()
        share_token = ""
        if "?" in request.handler.path:
            from urllib.parse import parse_qs, urlsplit

            query = urlsplit(request.handler.path).query
            if query:
                parsed = parse_qs(query)
                share_token = parsed.get("share", [""])[0]
        payload = get_item(request.state, bucket, id_, user, share_token=share_token or None)
        return json_response(payload)

    router.add("GET", r"^/content/(?P<bucket>[^/]+)/(?P<id>[^/]+)$", handle_get_content)

    # GET /content/builtins
    def handle_content_builtins(request: Request) -> Response:
        catalog = builtin_catalog(request.state)
        return json_response(catalog)

    router.add("GET", r"^/content/builtins$", handle_content_builtins)

    # POST /press/custom-sizes
    def resolve_press_custom_sizes_path(state: ServerState) -> Path:
        return state.root_dir / "undercroft" / "press" / "data" / "custom-page-sizes.json"

    def handle_press_custom_size_save(request: Request) -> Response:
        payload = require_json(request)
        size = payload.get("size", payload)
        if not size or not isinstance(size, dict) or not size.get("id"):
            return json_response({"error": "Invalid custom page size payload"}, status=HTTPStatus.BAD_REQUEST)
        path = resolve_press_custom_sizes_path(request.state)
        try:
            existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except (json.JSONDecodeError, OSError):
            existing = {}
        sizes = existing.get("sizes") if isinstance(existing.get("sizes"), list) else []
        sizes = [entry for entry in sizes if entry.get("id") != size.get("id")]
        sizes.append(size)
        serialized = json.dumps({"sizes": sizes}, indent=2, sort_keys=False)
        path.write_text(f"{serialized}\n", encoding="utf-8")
        return json_response({"ok": True, "sizes": sizes})

    router.add("POST", r"^/press/custom-sizes$", handle_press_custom_size_save)

    # POST /press/custom-fonts
    def resolve_press_custom_fonts_path(state: ServerState) -> Path:
        return state.root_dir / "undercroft" / "press" / "data" / "custom-fonts.json"

    def handle_press_custom_font_save(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        if role_rank(user.tier) < role_rank("creator"):
            raise AuthError("Creator tier or higher required to add fonts")
        payload = require_json(request)
        font = payload.get("font", payload)
        if not font or not isinstance(font, dict) or not font.get("id"):
            return json_response({"error": "Invalid custom font payload"}, status=HTTPStatus.BAD_REQUEST)
        path = resolve_press_custom_fonts_path(request.state)
        try:
            existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except (json.JSONDecodeError, OSError):
            existing = {}
        fonts = existing.get("fonts") if isinstance(existing.get("fonts"), list) else []
        fonts = [entry for entry in fonts if entry.get("id") != font.get("id")]
        fonts.append(font)
        serialized = json.dumps({"fonts": fonts}, indent=2, sort_keys=False)
        path.write_text(f"{serialized}\n", encoding="utf-8")
        return json_response({"ok": True, "fonts": fonts})

    router.add("POST", r"^/press/custom-fonts$", handle_press_custom_font_save)

    # POST /press/custom-fonts/delete — this server has no do_DELETE at all
    # (only do_GET/do_POST are wired up), so every deletion in this codebase
    # goes through a POST .../delete route instead of a true HTTP DELETE
    # (see /auth/users/delete, /content/{bucket}/{id}/delete).
    def handle_press_custom_font_delete(request: Request) -> Response:
        user = request.handler.current_user()
        if not user or user.tier != "admin":
            raise AuthError("Admin only")
        payload = require_json(request)
        font_id = payload.get("id")
        if not font_id:
            return json_response({"error": "font id required"}, status=HTTPStatus.BAD_REQUEST)
        path = resolve_press_custom_fonts_path(request.state)
        try:
            existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except (json.JSONDecodeError, OSError):
            existing = {}
        fonts = existing.get("fonts") if isinstance(existing.get("fonts"), list) else []
        fonts = [entry for entry in fonts if entry.get("id") != font_id]
        serialized = json.dumps({"fonts": fonts}, indent=2, sort_keys=False)
        path.write_text(f"{serialized}\n", encoding="utf-8")
        return json_response({"ok": True, "fonts": fonts})

    router.add("POST", r"^/press/custom-fonts/delete$", handle_press_custom_font_delete)

    # GET /press/google-fonts-metadata
    #
    # Proxies Google's font-picker metadata endpoint server-side. That
    # endpoint is Google's internal API (not published for third-party use)
    # and doesn't send CORS headers permitting a browser fetch() read from
    # this origin — a public CORS proxy (corsproxy.io, used elsewhere for
    # D&D Beyond) was tried first but its free tier now rejects non-localhost
    # callers outright. Fetching it here instead sidesteps CORS entirely,
    # same reasoning as /ddb-proxy above, just with a fixed target and no
    # session cookie needed.
    def handle_press_google_fonts_metadata(request: Request) -> Response:
        import urllib.error
        import urllib.request

        proxy_request = urllib.request.Request(
            "https://fonts.google.com/metadata/fonts",
            headers={"Accept": "application/json"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(proxy_request, timeout=15) as upstream:
                body = upstream.read()
        except urllib.error.HTTPError as exc:
            return json_response({"error": f"Google Fonts metadata fetch failed ({exc.code})"}, status=HTTPStatus.BAD_GATEWAY)
        except urllib.error.URLError as exc:
            return json_response({"error": f"Google Fonts metadata fetch failed ({exc.reason})"}, status=HTTPStatus.BAD_GATEWAY)

        return Response(status=200, body=body, headers={"Content-Type": "application/json; charset=utf-8"})

    router.add("GET", r"^/press/google-fonts-metadata$", handle_press_google_fonts_metadata)

    # POST /loom/mappings/{id}
    def resolve_loom_mapping_path(state: ServerState, mapping_id: str) -> Path:
        base_dir = state.root_dir / "undercroft" / "loom" / "mappings"
        candidate = (base_dir / f"{mapping_id}.json").resolve()
        if not str(candidate).startswith(str(base_dir.resolve())):
            raise AuthError("Invalid mapping path")
        return candidate

    def handle_loom_mapping_save(request: Request) -> Response:
        params = getattr(request, "params")
        mapping_id = params["id"]
        payload = require_json(request)
        definition = payload.get("definition", payload)
        if not definition or not isinstance(definition, dict):
            return json_response({"error": "Invalid mapping payload"}, status=HTTPStatus.BAD_REQUEST)
        path = resolve_loom_mapping_path(request.state, mapping_id)
        serialized = json.dumps(definition, indent=2, sort_keys=False)
        path.write_text(f"{serialized}\n", encoding="utf-8")
        return json_response({"ok": True, "path": str(path.relative_to(request.state.root_dir))})

    router.add("POST", r"^/loom/mappings/(?P<id>[^/]+)$", handle_loom_mapping_save)

    # POST /loom/mappings/{id}/rename
    def handle_loom_mapping_rename(request: Request) -> Response:
        params = getattr(request, "params")
        mapping_id = params["id"]
        payload = require_json(request)
        new_id = str(payload.get("newId") or "").strip()
        if not new_id:
            return json_response({"error": "Missing newId"}, status=HTTPStatus.BAD_REQUEST)
        old_path = resolve_loom_mapping_path(request.state, mapping_id)
        new_path = resolve_loom_mapping_path(request.state, new_id)
        if not old_path.exists():
            return json_response({"error": "Mapping not found"}, status=HTTPStatus.NOT_FOUND)
        if new_path.exists():
            return json_response({"error": "A mapping with that id already exists"}, status=HTTPStatus.CONFLICT)
        old_path.rename(new_path)
        return json_response({"ok": True, "path": str(new_path.relative_to(request.state.root_dir))})

    router.add("POST", r"^/loom/mappings/(?P<id>[^/]+)/rename$", handle_loom_mapping_rename)

    # Locations and Species Name Profiles used to be Forge-only flat files
    # here (POST /forge/locations/{id}, POST /forge/species/{id}) — both are
    # now managed in Loom as generic Library kinds ("location"/"setting", and
    # a `names` section merged into the shared "species" kind) via the
    # generic POST /content/{kind}/{id} route, so these Forge-specific routes
    # are retired.

    # POST /forge/generate-note
    #
    # Optional LLM synthesis step (CLAUDE.md: "entirely optional... all
    # rolled values stand on their own as the character record"). Proxies
    # Anthropic's Messages API the same no-extra-dependency way as
    # handle_press_google_fonts_metadata/handle_ddb_proxy above (urllib
    # only), reading the API key from a local, gitignored file mirroring
    # server/ddb-session.local.json's own convention.
    FORGE_NOTE_SYSTEM_PROMPT = (
        "You write a single, tightly-formatted NPC character note for a tabletop RPG GM.\n"
        "Respond with EXACTLY this format and nothing else — no preamble, no markdown, no extra commentary:\n\n"
        "Name (Alignment Gender Species Archetype). [2-3 sentences weaving the given Description, Demeanor, "
        "Drive, and Direction traits into a vivid but concise character note.]\n\n"
        "Use the exact Name, Alignment, Gender, Species, and Archetype values given verbatim. Do not invent "
        "new attributes, do not restate these instructions, and do not add anything before or after the "
        "single formatted line."
    )

    def resolve_anthropic_api_key(state: ServerState) -> str:
        path = state.root_dir / "server" / "anthropic.local.json"
        if not path.exists():
            return ""
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return ""
        return str(data.get("api_key") or "").strip()

    def handle_forge_generate_note(request: Request) -> Response:
        import urllib.error
        import urllib.request

        api_key = resolve_anthropic_api_key(request.state)
        if not api_key:
            return json_response(
                {
                    "error": (
                        "Missing Anthropic API key — copy server/anthropic.local.json.example to "
                        "server/anthropic.local.json and fill in api_key."
                    )
                },
                status=HTTPStatus.BAD_REQUEST,
            )
        payload = require_json(request)
        identity = payload.get("identity") or {}
        four_d = payload.get("fourD") or {}
        name = str(identity.get("name") or "").strip()
        if not name:
            return json_response({"error": "identity.name is required"}, status=HTTPStatus.BAD_REQUEST)
        user_content = (
            f"Name: {name}\n"
            f"Alignment: {identity.get('alignment', '')}\n"
            f"Gender: {identity.get('gender', '')}\n"
            f"Species: {identity.get('species', '')}\n"
            f"Archetype: {identity.get('archetype', '')}\n"
            f"Age: {identity.get('age', '')}\n"
            f"Relationship: {identity.get('relationship', '')}\n"
            f"Attitude: {identity.get('attitude', '')}\n"
            f"Description: {four_d.get('description', '')}\n"
            f"Demeanor: {four_d.get('demeanor', '')}\n"
            f"Drive: {four_d.get('drive', '')}\n"
            f"Direction: {four_d.get('direction', '')}\n"
        )
        request_body = json.dumps(
            {
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 300,
                "system": FORGE_NOTE_SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": user_content}],
            }
        ).encode("utf-8")
        proxy_request = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=request_body,
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(proxy_request, timeout=30) as upstream:
                response_body = json.loads(upstream.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            return json_response(
                {"error": f"Anthropic API request failed ({exc.code}): {detail}"},
                status=HTTPStatus.BAD_GATEWAY,
            )
        except urllib.error.URLError as exc:
            return json_response(
                {"error": f"Anthropic API request failed ({exc.reason})"},
                status=HTTPStatus.BAD_GATEWAY,
            )

        content_blocks = response_body.get("content") or []
        note = "".join(
            block.get("text", "") for block in content_blocks if isinstance(block, dict)
        ).strip()
        if not note:
            return json_response({"error": "Anthropic API returned an empty response"}, status=HTTPStatus.BAD_GATEWAY)
        return json_response({"note": note})

    router.add("POST", r"^/forge/generate-note$", handle_forge_generate_note)

    # POST /crucible/generate-note
    #
    # Same optional LLM synthesis step as Forge's NPC note, applied to a
    # generated monster concept instead of a rolled NPC — Crucible's own
    # structured output (Creature Type/Archetype/Role/features) stands on its
    # own with no LLM involvement; this just turns it into a short prose
    # sketch for a GM who wants one. Reuses resolve_anthropic_api_key above.
    CRUCIBLE_NOTE_SYSTEM_PROMPT = (
        "You suggest a name (when one isn't already given) and write a single, "
        "tightly-formatted monster concept note for a tabletop RPG GM.\n"
        "Respond with EXACTLY two lines and nothing else — no preamble, no markdown, "
        "no extra commentary:\n\n"
        "Line 1: just the creature's name, nothing else. If a Name is already given "
        "below, repeat it verbatim. If Name is blank, invent one that fits the given "
        "Creature Type, Archetype, and Role.\n"
        "Line 2: Name (Creature Type, Archetype, Role). [2-3 sentences describing how "
        "this creature behaves in and around a fight, weaving in its Signature Feature "
        "and its other features into a vivid but concise tactical sketch.]\n\n"
        "Use the exact Creature Type, Archetype, and Role values given verbatim, and "
        "use the same name on both lines. Do not invent new features or mechanics, do "
        "not restate these instructions, and do not add anything before, between, or "
        "after these two lines."
    )

    def handle_crucible_generate_note(request: Request) -> Response:
        import urllib.error
        import urllib.request

        api_key = resolve_anthropic_api_key(request.state)
        if not api_key:
            return json_response(
                {
                    "error": (
                        "Missing Anthropic API key — copy server/anthropic.local.json.example to "
                        "server/anthropic.local.json and fill in api_key."
                    )
                },
                status=HTTPStatus.BAD_REQUEST,
            )
        payload = require_json(request)
        monster = payload.get("monster") or {}
        # Name is optional now — Crucible's Name field is blank by default, and
        # this endpoint is the one place that can fill it in, so an empty name
        # is a normal request, not an error: the prompt asks Claude to invent
        # one fitting the Creature Type/Archetype/Role when it's blank.
        name = str(monster.get("name") or "").strip()
        features = monster.get("features") or []
        feature_lines = "\n".join(
            f"- {feature.get('name', '')}: {feature.get('description', '')}"
            for feature in features
            if isinstance(feature, dict)
        )
        user_content = (
            f"Name: {name}\n"
            f"Creature Type: {monster.get('creatureType', '')}\n"
            f"Archetype: {monster.get('archetype', '')}\n"
            f"Role: {monster.get('role', '')}\n"
            f"Signature Feature: {monster.get('signatureFeature', '')}\n"
            f"Features:\n{feature_lines}\n"
        )
        request_body = json.dumps(
            {
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 300,
                "system": CRUCIBLE_NOTE_SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": user_content}],
            }
        ).encode("utf-8")
        proxy_request = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=request_body,
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(proxy_request, timeout=30) as upstream:
                response_body = json.loads(upstream.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            return json_response(
                {"error": f"Anthropic API request failed ({exc.code}): {detail}"},
                status=HTTPStatus.BAD_GATEWAY,
            )
        except urllib.error.URLError as exc:
            return json_response(
                {"error": f"Anthropic API request failed ({exc.reason})"},
                status=HTTPStatus.BAD_GATEWAY,
            )

        content_blocks = response_body.get("content") or []
        raw_text = "".join(
            block.get("text", "") for block in content_blocks if isinstance(block, dict)
        ).strip()
        if not raw_text:
            return json_response({"error": "Anthropic API returned an empty response"}, status=HTTPStatus.BAD_GATEWAY)
        # First line is the (possibly Claude-suggested) name; everything after
        # is the tactical note. Falls back to the original name/full text if
        # the model doesn't follow the two-line format exactly.
        first_line, _, rest = raw_text.partition("\n")
        suggested_name = first_line.strip() or name
        note = rest.strip() or raw_text
        return json_response({"name": suggested_name, "note": note})

    router.add("POST", r"^/crucible/generate-note$", handle_crucible_generate_note)

    # POST /vault/generate-note
    #
    # Same optional LLM synthesis step as Crucible's monster note, applied to
    # a generated spell/item effect instead — Vault's own structured output
    # (properties + selected features) stands on its own with no LLM
    # involvement; this just turns it into a short flavor note for a GM who
    # wants one. Reuses resolve_anthropic_api_key above.
    VAULT_NOTE_SYSTEM_PROMPT = (
        "You suggest a name (when one isn't already given) and write a single, "
        "tightly-formatted magic effect note for a tabletop RPG GM.\n"
        "Respond with EXACTLY two lines and nothing else — no preamble, no markdown, "
        "no extra commentary:\n\n"
        "Line 1: just the effect's name, nothing else. If a Name is already given "
        "below, repeat it verbatim. If Name is blank, invent one that fits the given "
        "Properties and Signature Effect.\n"
        "Line 2: Name (comma-separated Properties). [2-3 sentences describing what "
        "this effect does and how it feels to use, weaving in its Signature Effect "
        "and its other features into a vivid but concise flavor note.]\n\n"
        "Use the exact Properties and Signature Effect values given verbatim, and "
        "use the same name on both lines. Do not invent new features or mechanics, do "
        "not restate these instructions, and do not add anything before, between, or "
        "after these two lines."
    )

    def handle_vault_generate_note(request: Request) -> Response:
        import urllib.error
        import urllib.request

        api_key = resolve_anthropic_api_key(request.state)
        if not api_key:
            return json_response(
                {
                    "error": (
                        "Missing Anthropic API key — copy server/anthropic.local.json.example to "
                        "server/anthropic.local.json and fill in api_key."
                    )
                },
                status=HTTPStatus.BAD_REQUEST,
            )
        payload = require_json(request)
        effect = payload.get("effect") or {}
        # Name is optional now — Vault's Name field is blank by default, and
        # this endpoint is the one place that can fill it in, so an empty name
        # is a normal request, not an error: the prompt asks Claude to invent
        # one fitting the Properties/Signature Effect when it's blank.
        name = str(effect.get("name") or "").strip()
        properties = effect.get("properties") or {}
        property_lines = ", ".join(f"{label}: {value}" for label, value in properties.items() if value)
        features = effect.get("features") or []
        feature_lines = "\n".join(
            f"- {feature.get('name', '')}: {feature.get('description', '')}"
            for feature in features
            if isinstance(feature, dict)
        )
        user_content = (
            f"Name: {name}\n"
            f"Properties: {property_lines}\n"
            f"Signature Effect: {effect.get('signatureFeature', '')}\n"
            f"Features:\n{feature_lines}\n"
        )
        request_body = json.dumps(
            {
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 300,
                "system": VAULT_NOTE_SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": user_content}],
            }
        ).encode("utf-8")
        proxy_request = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=request_body,
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(proxy_request, timeout=30) as upstream:
                response_body = json.loads(upstream.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            return json_response(
                {"error": f"Anthropic API request failed ({exc.code}): {detail}"},
                status=HTTPStatus.BAD_GATEWAY,
            )
        except urllib.error.URLError as exc:
            return json_response(
                {"error": f"Anthropic API request failed ({exc.reason})"},
                status=HTTPStatus.BAD_GATEWAY,
            )

        content_blocks = response_body.get("content") or []
        raw_text = "".join(
            block.get("text", "") for block in content_blocks if isinstance(block, dict)
        ).strip()
        if not raw_text:
            return json_response({"error": "Anthropic API returned an empty response"}, status=HTTPStatus.BAD_GATEWAY)
        # First line is the (possibly Claude-suggested) name; everything after
        # is the flavor note. Falls back to the original name/full text if the
        # model doesn't follow the two-line format exactly.
        first_line, _, rest = raw_text.partition("\n")
        suggested_name = first_line.strip() or name
        note = rest.strip() or raw_text
        return json_response({"name": suggested_name, "note": note})

    router.add("POST", r"^/vault/generate-note$", handle_vault_generate_note)

    # POST /sanctum/generate-note
    #
    # Same optional LLM synthesis step as Crucible's/Vault's notes, applied to a
    # generated Location instead — Sanctum's own structured output (Type/Purpose/
    # Environment/Features/Assets/Needs) stands on its own with no LLM involvement;
    # this just turns it into a short flavor note for a GM who wants one. Reuses
    # resolve_anthropic_api_key above.
    SANCTUM_NOTE_SYSTEM_PROMPT = (
        "You suggest a name (when one isn't already given) and write a single, "
        "tightly-formatted location note for a tabletop RPG GM.\n"
        "Respond with EXACTLY two lines and nothing else — no preamble, no markdown, "
        "no extra commentary:\n\n"
        "Line 1: just the location's name, nothing else. If a Name is already given "
        "below, repeat it verbatim. If Name is blank, invent one that fits the given "
        "Type, Purpose, and Environment.\n"
        "Line 2: Name (Type, Purpose, Environment). [2-3 sentences describing what "
        "this place is like and why it matters, weaving in its Features and any "
        "notable Assets/Needs into a vivid but concise sketch.]\n\n"
        "Use the exact Type, Purpose, and Environment values given verbatim, and use "
        "the same name on both lines. Do not invent new features or mechanics, do "
        "not restate these instructions, and do not add anything before, between, or "
        "after these two lines."
    )

    def handle_sanctum_generate_note(request: Request) -> Response:
        import urllib.error
        import urllib.request

        api_key = resolve_anthropic_api_key(request.state)
        if not api_key:
            return json_response(
                {
                    "error": (
                        "Missing Anthropic API key — copy server/anthropic.local.json.example to "
                        "server/anthropic.local.json and fill in api_key."
                    )
                },
                status=HTTPStatus.BAD_REQUEST,
            )
        payload = require_json(request)
        location = payload.get("location") or {}
        # Name is optional now — Sanctum's Name field is blank by default, and this
        # endpoint is the one place that can fill it in, so an empty name is a
        # normal request, not an error: the prompt asks Claude to invent one fitting
        # the Type/Purpose/Environment when it's blank.
        name = str(location.get("name") or "").strip()
        features = location.get("features") or []
        feature_lines = "\n".join(
            f"- {feature.get('name', '')}: {feature.get('description', '')}"
            for feature in features
            if isinstance(feature, dict)
        )
        assets = location.get("assets") or []
        needs = location.get("needs") or []
        user_content = (
            f"Name: {name}\n"
            f"Type: {location.get('typeLabel', '')}\n"
            f"Purpose: {location.get('purposeLabel', '')}\n"
            f"Environment: {location.get('environmentLabel', '')}\n"
            f"Features:\n{feature_lines}\n"
            f"Assets: {', '.join(str(a) for a in assets)}\n"
            f"Needs: {', '.join(str(n) for n in needs)}\n"
        )
        request_body = json.dumps(
            {
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 300,
                "system": SANCTUM_NOTE_SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": user_content}],
            }
        ).encode("utf-8")
        proxy_request = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=request_body,
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(proxy_request, timeout=30) as upstream:
                response_body = json.loads(upstream.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            return json_response(
                {"error": f"Anthropic API request failed ({exc.code}): {detail}"},
                status=HTTPStatus.BAD_GATEWAY,
            )
        except urllib.error.URLError as exc:
            return json_response(
                {"error": f"Anthropic API request failed ({exc.reason})"},
                status=HTTPStatus.BAD_GATEWAY,
            )

        content_blocks = response_body.get("content") or []
        raw_text = "".join(
            block.get("text", "") for block in content_blocks if isinstance(block, dict)
        ).strip()
        if not raw_text:
            return json_response({"error": "Anthropic API returned an empty response"}, status=HTTPStatus.BAD_GATEWAY)
        first_line, _, rest = raw_text.partition("\n")
        suggested_name = first_line.strip() or name
        note = rest.strip() or raw_text
        return json_response({"name": suggested_name, "note": note})

    router.add("POST", r"^/sanctum/generate-note$", handle_sanctum_generate_note)

    # /library/{kind}/... (POST save/delete, GET list) is retired — every
    # Library kind (including the 9 that used to be plain, unauthenticated
    # flat files under this route) is now served by the same DB-backed
    # /content/{bucket}/{id} and /list/{bucket} routes above, keyed by `kind`
    # instead of a fixed 3-bucket set. See server/storage.py's library_items
    # table and load_kind_policy() for how ownership/tier policy now works
    # for every kind uniformly.

    # GET /ddb-proxy?url=...
    #
    # Fetches a dndbeyond.com (or monster-service.dndbeyond.com) resource
    # server-side and attaches a session cookie read from a LOCAL, gitignored
    # file (server/ddb-session.local.json) — never from the request, never
    # from a third party. This exists because some D&D Beyond content (e.g.
    # non-free subclasses, or non-SRD monsters via monster-service) is only
    # served in full to a logged-in session; routing that session cookie
    # through a public third-party CORS proxy would hand full account access
    # to that proxy, which this deliberately avoids by keeping the cookie
    # server-side and talking directly to dndbeyond.com. Response body is
    # passed through byte-for-byte regardless of host — works for both
    # scraped HTML pages and monster-service's JSON.
    DDB_PROXY_ALLOWED_HOSTS = {"www.dndbeyond.com", "dndbeyond.com", "monster-service.dndbeyond.com"}

    def load_ddb_session_cookie(state: ServerState) -> str:
        path = state.root_dir / "server" / "ddb-session.local.json"
        if not path.exists():
            return ""
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return ""
        cookie = str(data.get("cookie") or "").strip()
        if cookie and "=" not in cookie:
            # Tolerate pasting just the cookie's value (as shown in DevTools'
            # "Value" column) instead of a full name=value pair — a bare value
            # is otherwise silently ignored by the Cookie header entirely.
            cookie = f"CobaltSession={cookie}"
        return cookie

    def handle_ddb_proxy(request: Request) -> Response:
        import urllib.error
        import urllib.request
        from urllib.parse import parse_qs, urlsplit

        query = parse_qs(urlsplit(request.handler.path).query)
        target = query.get("url", [""])[0]
        if not target:
            return json_response({"error": "Missing url parameter"}, status=HTTPStatus.BAD_REQUEST)
        parsed_target = urlsplit(target)
        if parsed_target.hostname not in DDB_PROXY_ALLOWED_HOSTS:
            return json_response({"error": "Only dndbeyond.com URLs are allowed"}, status=HTTPStatus.BAD_REQUEST)

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        cookie = load_ddb_session_cookie(request.state)
        if cookie:
            headers["Cookie"] = cookie

        proxy_request = urllib.request.Request(target, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(proxy_request, timeout=15) as upstream:
                body = upstream.read()
                content_type = upstream.headers.get_content_type() or "text/html"
        except urllib.error.HTTPError as exc:
            return json_response({"error": f"D&D Beyond fetch failed ({exc.code})"}, status=HTTPStatus.BAD_GATEWAY)
        except urllib.error.URLError as exc:
            return json_response({"error": f"D&D Beyond fetch failed ({exc.reason})"}, status=HTTPStatus.BAD_GATEWAY)

        return Response(status=200, body=body, headers={"Content-Type": f"{content_type}; charset=utf-8"})

    router.add("GET", r"^/ddb-proxy$", handle_ddb_proxy)

    # GET /content/owned
    def handle_owned_content(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        query = request.handler.path.split("?", 1)
        target = user
        scope = "user"
        if len(query) > 1 and query[1]:
            from urllib.parse import parse_qs

            params = parse_qs(query[1])
            scope_param = params.get("scope", [""])[0]
            if scope_param == "all":
                if user.tier != "admin":
                    raise AuthError("Admin only")
                scope = "all"
            else:
                username = params.get("username", [""])[0]
                if username and username != user.username:
                    if user.tier != "admin":
                        raise AuthError("Admin only")
                    target_user = get_user_by_username(request.state, username)
                    if not target_user:
                        raise AuthError("User not found")
                    target = target_user
        payload = list_owned_content(request.state, target if scope != "all" else None, scope=scope)
        return json_response(payload)

    router.add("GET", r"^/content/owned$", handle_owned_content)

    def require_authenticated_user(request: Request) -> User:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        return user

    def ensure_share_permission(
        request: Request,
        content_type: str,
        content_id: str,
        action: str,
    ) -> tuple[User, str]:
        if not content_type or not content_id:
            raise AuthError("Missing fields")
        user = require_authenticated_user(request)
        bucket_name = bucket_from_content_type(content_type)
        if user.tier != "admin" and not is_owner(request.state, bucket_name, f"{content_id}.json", user):
            raise AuthError(f"Only owner or admin can {action}")
        return user, bucket_name

    # GET /shares/{content_type}/{content_id}
    def handle_list_shares(request: Request) -> Response:
        params = getattr(request, "params")
        content_type = params["bucket"]
        content_id = params["content_id"]
        user, bucket_name = ensure_share_permission(request, content_type, content_id, "view shares")
        shares = list_shares(request.state, bucket_name, content_id, user)
        link = get_share_link(request.state, bucket_name, content_id)
        return json_response({"shares": shares, "link": link})

    router.add("GET", r"^/shares/(?P<bucket>[^/]+)/(?P<content_id>[^/]+)$", handle_list_shares)

    # GET /shares/eligible
    def handle_share_eligible(request: Request) -> Response:
        from urllib.parse import parse_qs, urlsplit

        query = parse_qs(urlsplit(request.handler.path).query)
        content_type = query.get("content_type", [""])[0]
        content_id = query.get("content_id", [""])[0]
        _, bucket_name = ensure_share_permission(request, content_type, content_id, "manage shares")
        users = list_shareable_users(request.state, bucket_name)
        return json_response({"users": users})

    router.add("GET", r"^/shares/eligible$", handle_share_eligible)

    # GET /shares/{content_type}/{content_id}/eligible
    def handle_share_eligible_path(request: Request) -> Response:
        params = getattr(request, "params")
        content_type = params["bucket"]
        content_id = params["content_id"]
        _, bucket_name = ensure_share_permission(request, content_type, content_id, "manage shares")
        users = list_shareable_users(request.state, bucket_name)
        return json_response({"users": users})

    router.add(
        "GET",
        r"^/shares/(?P<bucket>[^/]+)/(?P<content_id>[^/]+)/eligible$",
        handle_share_eligible_path,
    )

    # Groups management

    def handle_list_groups(request: Request) -> Response:
        user = require_user(request)
        payload = group_store.list_groups(request.state, user)
        return json_response(payload)

    router.add("GET", r"^/groups$", handle_list_groups)

    def handle_create_group(request: Request) -> Response:
        user = require_user(request)
        data = require_json(request)
        name = data.get("name", "")
        type_ = data.get("type", "")
        group = group_store.create_group(request.state, user, name, type_)
        return json_response(group, status=HTTPStatus.CREATED)

    router.add("POST", r"^/groups$", handle_create_group)

    def handle_update_group(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        data = require_json(request)
        name = data.get("name")
        group = group_store.update_group(request.state, user, group_id, name=name)
        return json_response(group)

    router.add("POST", r"^/groups/(?P<group_id>[^/]+)$", handle_update_group)

    def handle_delete_group(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        group_store.delete_group(request.state, user, group_id)
        return json_response({"ok": True})

    router.add("POST", r"^/groups/(?P<group_id>[^/]+)/delete$", handle_delete_group)

    def handle_update_group_members(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        data = require_json(request)
        members = data.get("character_ids")
        if members is None:
            members = data.get("members")
        if members is None:
            members = data.get("characters")
        if not isinstance(members, list):
            members = []
        group = group_store.update_group_members(request.state, user, group_id, members)
        return json_response(group)

    router.add("POST", r"^/groups/(?P<group_id>[^/]+)/members$", handle_update_group_members)

    def handle_character_groups(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        character_id = params["character_id"]
        payload = group_store.list_character_groups(request.state, user, character_id)
        return json_response(payload)

    router.add("GET", r"^/groups/character/(?P<character_id>[^/]+)$", handle_character_groups)

    def handle_group_log(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        from urllib.parse import parse_qs, urlsplit

        query = parse_qs(urlsplit(request.handler.path).query)
        limit = query.get("limit", [None])[0]
        payload = group_store.list_group_log(request.state, group_id, user, limit=limit)
        return json_response(payload)

    router.add("GET", r"^/groups/(?P<group_id>[^/]+)/log$", handle_group_log)

    def handle_group_log_post(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        data = require_json(request)
        entry_type = data.get("type") or data.get("entry_type") or "message"
        message = data.get("message") or ""
        payload = data.get("payload")
        entry = group_store.create_group_log_entry(
            request.state,
            group_id,
            user,
            entry_type=entry_type,
            message=message,
            payload=payload,
        )
        return json_response(entry, status=HTTPStatus.CREATED)

    router.add("POST", r"^/groups/(?P<group_id>[^/]+)/log$", handle_group_log_post)

    def handle_group_share_link(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        link = group_store.get_group_share_link(request.state, user, group_id)
        return json_response({"link": link})

    router.add("GET", r"^/groups/(?P<group_id>[^/]+)/share-link$", handle_group_share_link)

    def handle_group_share_link_create(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        link = group_store.ensure_group_share_link(request.state, user, group_id)
        return json_response(link, status=HTTPStatus.CREATED)

    router.add("POST", r"^/groups/(?P<group_id>[^/]+)/share-link$", handle_group_share_link_create)

    def handle_group_share_link_revoke(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        group_store.revoke_group_share_link(request.state, user, group_id)
        return json_response({"ok": True})

    router.add(
        "POST",
        r"^/groups/(?P<group_id>[^/]+)/share-link/revoke$",
        handle_group_share_link_revoke,
    )

    def handle_group_share_log(request: Request) -> Response:
        params = getattr(request, "params")
        token = params["token"]
        from urllib.parse import parse_qs, urlsplit

        query = parse_qs(urlsplit(request.handler.path).query)
        limit = query.get("limit", [None])[0]
        payload = group_store.list_group_log(
            request.state,
            None,
            None,
            share_token=token,
            limit=limit,
        )
        return json_response(payload)

    router.add("GET", r"^/groups/share/(?P<token>[^/]+)/log$", handle_group_share_log)

    def handle_group_share_log_post(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        token = params["token"]
        data = require_json(request)
        entry_type = data.get("type") or data.get("entry_type") or "message"
        message = data.get("message") or ""
        payload = data.get("payload")
        entry = group_store.create_group_log_entry(
            request.state,
            None,
            user,
            share_token=token,
            entry_type=entry_type,
            message=message,
            payload=payload,
        )
        return json_response(entry, status=HTTPStatus.CREATED)

    router.add("POST", r"^/groups/share/(?P<token>[^/]+)/log$", handle_group_share_log_post)

    def handle_group_share_details(request: Request) -> Response:
        params = getattr(request, "params")
        token = params["token"]
        payload = group_store.get_group_share_details(request.state, token)
        return json_response(payload)

    router.add("GET", r"^/groups/share/(?P<token>[^/]+)$", handle_group_share_details)

    def handle_group_share_claim(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        token = params["token"]
        data = require_json(request)
        character_id = data.get("character_id") or data.get("id")
        if not character_id:
            raise AuthError("Character id is required")
        payload = group_store.claim_group_character(request.state, token, character_id, user)
        return json_response(payload)

    router.add("POST", r"^/groups/share/(?P<token>[^/]+)/claim$", handle_group_share_claim)

    # POST /auth/register
    def handle_register(request: Request) -> Response:
        data = require_json(request)
        data["ip"] = request.handler.client_address[0]
        data["user_agent"] = request.handler.headers.get("User-Agent", "")
        result = register_user(request.state, data)
        return json_response(result, status=HTTPStatus.CREATED)

    router.add("POST", r"^/auth/register$", handle_register)

    # POST /auth/verify
    def handle_verify(request: Request) -> Response:
        data = require_json(request)
        data["ip"] = request.handler.client_address[0]
        data["user_agent"] = request.handler.headers.get("User-Agent", "")
        result = verify_registration(request.state, data)
        return json_response(result)

    router.add("POST", r"^/auth/verify$", handle_verify)

    # POST /auth/login
    def handle_login(request: Request) -> Response:
        data = require_json(request)
        session = login_user(
            request.state,
            data,
            request.handler.client_address[0],
            request.handler.headers.get("User-Agent", ""),
        )
        return json_response(session)

    router.add("POST", r"^/auth/login$", handle_login)

    # POST /auth/logout
    def handle_logout(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        auth_header = request.handler.headers.get("Authorization", "")
        token = auth_header[7:] if auth_header.startswith("Bearer ") else None
        logout_user(request.state, token)
        return json_response({"ok": True})

    router.add("POST", r"^/auth/logout$", handle_logout)

    # POST /auth/upgrade
    def handle_upgrade(request: Request) -> Response:
        admin = request.handler.current_user()
        if not admin or admin.tier != "admin":
            raise AuthError("Admin only")
        data = require_json(request)
        username = data.get("username")
        tier = data.get("tier")
        if not username or not tier:
            raise AuthError("username and tier required")
        result = upgrade_user(request.state, username, tier)
        return json_response(result)

    router.add("POST", r"^/auth/upgrade$", handle_upgrade)

    # GET /auth/users
    def handle_list_users(request: Request) -> Response:
        admin = request.handler.current_user()
        if not admin or admin.tier != "admin":
            raise AuthError("Admin only")
        payload = list_users(request.state)
        return json_response(payload)

    router.add("GET", r"^/auth/users$", handle_list_users)

    # POST /auth/users/delete
    def handle_delete_user(request: Request) -> Response:
        admin = request.handler.current_user()
        if not admin or admin.tier != "admin":
            raise AuthError("Admin only")
        data = require_json(request)
        username = data.get("username")
        if not username:
            raise AuthError("username required")
        result = delete_user(request.state, username)
        return json_response(result)

    router.add("POST", r"^/auth/users/delete$", handle_delete_user)

    # POST /auth/profile/email
    def handle_update_email(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        data = require_json(request)
        result = update_email_address(request.state, user, data.get("email", ""), data.get("password", ""))
        return json_response(result)

    router.add("POST", r"^/auth/profile/email$", handle_update_email)

    # POST /auth/profile/password
    def handle_update_password(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        data = require_json(request)
        result = update_password(
            request.state,
            user,
            data.get("current_password", ""),
            data.get("new_password", ""),
        )
        return json_response(result)

    router.add("POST", r"^/auth/profile/password$", handle_update_password)

    # POST /content/{bucket}/{id}
    def handle_save_content(request: Request) -> Response:
        params = getattr(request, "params")
        bucket = normalize_kind(params["bucket"])
        id_ = params["id"]
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        data = require_json(request)
        result = save_item(request.state, bucket, id_, data, user)
        return json_response(result)

    router.add("POST", r"^/content/(?P<bucket>[^/]+)/(?P<id>[^/]+)$", handle_save_content)

    # POST /content/{bucket}/{id}/delete
    def handle_delete_content(request: Request) -> Response:
        params = getattr(request, "params")
        bucket = normalize_kind(params["bucket"])
        id_ = params["id"]
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        delete_item(request.state, bucket, id_, user)
        return json_response({"ok": True})

    router.add("POST", r"^/content/(?P<bucket>[^/]+)/(?P<id>[^/]+)/delete$", handle_delete_content)

    # POST /content/{bucket}/{id}/owner
    def handle_owner_update(request: Request) -> Response:
        params = getattr(request, "params")
        bucket = normalize_kind(params["bucket"])
        id_ = params["id"]
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        body = require_json(request)
        username = (body.get("username") or "").strip()
        if not username:
            raise AuthError("Username required")
        new_owner = get_user_by_username(request.state, username)
        if not new_owner:
            raise AuthError("User not found")
        result = update_owner(request.state, bucket, id_, user, new_owner)
        return json_response(result)

    router.add("POST", r"^/content/(?P<bucket>[^/]+)/(?P<id>[^/]+)/owner$", handle_owner_update)

    # POST /shares
    def handle_share(request: Request) -> Response:
        data = require_json(request)
        content_type = data.get("content_type")
        content_id = data.get("content_id")
        username = data.get("username")
        permissions = data.get("permissions", "view")
        if not username:
            raise AuthError("Missing fields")
        if permissions not in {"view", "edit"}:
            raise AuthError("Invalid permissions")
        _, bucket_name = ensure_share_permission(request, content_type, content_id, "share content")
        result = share_with_user(request.state, bucket_name, content_id, username, permissions)
        return json_response(result)

    router.add("POST", r"^/shares$", handle_share)

    # POST /shares/revoke
    def handle_revoke_share(request: Request) -> Response:
        data = require_json(request)
        content_type = data.get("content_type")
        content_id = data.get("content_id")
        username = data.get("username")
        if not username:
            raise AuthError("Missing fields")
        _, bucket_name = ensure_share_permission(request, content_type, content_id, "revoke shares")
        revoke_share(request.state, bucket_name, content_id, username)
        return json_response({"ok": True})

    router.add("POST", r"^/shares/revoke$", handle_revoke_share)

    # POST /shares/link
    def handle_share_link(request: Request) -> Response:
        data = require_json(request)
        content_type = data.get("content_type")
        content_id = data.get("content_id")
        permissions = data.get("permissions", "view")
        _, bucket_name = ensure_share_permission(request, content_type, content_id, "create links")
        link = create_share_link(request.state, bucket_name, content_id, permissions)
        return json_response({"link": link})

    router.add("POST", r"^/shares/link$", handle_share_link)

    # POST /shares/{content_type}/{content_id}/link
    def handle_share_link_for_content(request: Request) -> Response:
        params = getattr(request, "params")
        content_type = params["bucket"]
        content_id = params["content_id"]
        data = require_json(request) or {}
        permissions = data.get("permissions", "view")
        _, bucket_name = ensure_share_permission(request, content_type, content_id, "create links")
        link = create_share_link(request.state, bucket_name, content_id, permissions)
        return json_response({"link": link})

    router.add(
        "POST",
        r"^/shares/(?P<bucket>[^/]+)/(?P<content_id>[^/]+)/link$",
        handle_share_link_for_content,
    )

    # POST /shares/link/revoke
    def handle_share_link_revoke(request: Request) -> Response:
        data = require_json(request)
        content_type = data.get("content_type")
        content_id = data.get("content_id")
        _, bucket_name = ensure_share_permission(request, content_type, content_id, "revoke links")
        revoke_share_link(request.state, bucket_name, content_id)
        return json_response({"ok": True})

    router.add("POST", r"^/shares/link/revoke$", handle_share_link_revoke)

    # POST /shares/{content_type}/{content_id}/link/revoke
    def handle_share_link_revoke_for_content(request: Request) -> Response:
        params = getattr(request, "params")
        content_type = params["bucket"]
        content_id = params["content_id"]
        _, bucket_name = ensure_share_permission(request, content_type, content_id, "revoke links")
        revoke_share_link(request.state, bucket_name, content_id)
        return json_response({"ok": True})

    router.add(
        "POST",
        r"^/shares/(?P<bucket>[^/]+)/(?P<content_id>[^/]+)/link/revoke$",
        handle_share_link_revoke_for_content,
    )

    # POST /import/{system}/{importer}
    def handle_import(request: Request) -> Response:
        params = getattr(request, "params")
        system_id = params["system"]
        importer_id = params["importer"]
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        data = require_json(request)
        payload = data.get("payload", {})
        result = run_importer(request.state, system_id, importer_id, payload)
        return json_response({"dryRun": bool(data.get("dryRun", True)), **result})

    router.add("POST", r"^/import/(?P<system>[^/]+)/(?P<importer>[^/]+)$", handle_import)


register_routes()


def create_server(config_path: str) -> SheetsHTTPServer:
    loader = ConfigLoader(Path(config_path))
    configure_logging(loader.get().options.log_level)
    state = ServerState.from_loader(loader)
    init_auth_db(state.db)
    ensure_default_admin(state)
    ensure_default_test_users(state)
    init_storage_db(state)
    cleanup_sessions(state)
    server = SheetsHTTPServer((state.config.options.host, state.config.options.port), RequestHandler, state)
    logging.info("Server listening on %s:%s", state.config.options.host, state.config.options.port)
    return server


def main(config_path: str) -> None:
    server = create_server(config_path)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("Server shutting down")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":  # pragma: no cover
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser(description="Sheets development server")
    parser.add_argument("--config", default="server.config.json", help="Path to server configuration file")
    args = parser.parse_args()
    config_path = args.config
    if not Path(config_path).exists():
        raise SystemExit(f"Config file not found: {config_path}")
    main(config_path)
