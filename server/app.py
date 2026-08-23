from __future__ import annotations

import http.server
import json
import logging
import sys
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from pathlib import Path
from typing import Any, Callable, Dict, Optional

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
    admin_create_user,
    admin_update_user_email,
    admin_set_user_status,
    update_email_address,
    update_password,
    upgrade_own_tier,
    get_user_settings,
    update_user_settings,
)
from .builtins import builtin_catalog
from .config import ConfigLoader
from .ddb_auth_status import build_ddb_request_headers, check_ddb_auth_status, get_ddb_auth_status, record_ddb_auth_check
from .integrations import (
    EncryptionUnavailable,
    clear_deployment_secret,
    clear_ha_connection,
    get_ha_connection,
    is_deployment_secret_configured,
    list_deployment_secrets,
    resolve_anthropic_api_key,
    resolve_ddb_session_cookie,
    resolve_deployment_secret,
    resolve_ha_credentials,
    save_bare_deployment_secret,
    save_deployment_secret,
    save_ha_connection,
    update_ha_connection_url,
)
from .roles import role_rank
from .router import Request, Response, Router
from .shares import (
    create_share_link,
    get_share_link,
    list_shareable_targets,
    list_shares,
    revoke_group_share,
    revoke_share,
    revoke_share_link,
    share_with_group,
    share_with_user,
)
from .state import ServerState, configure_logging
from .static import serve_from_root, serve_local_file
from .kinds import normalize_kind
from .storage import (
    AuthError as StorageAuthError,
    delete_item,
    flush_pending_touches,
    get_item,
    get_items_bulk,
    init_storage_db,
    is_owner,
    list_bucket,
    list_owned_content,
    rename_item,
    save_item,
    search_content,
    update_owner,
)
TOUCH_FLUSH_INTERVAL_SECONDS = 30
# A credential that changes on the order of weeks (a D&D Beyond session
# cookie) doesn't need anything tighter than a daily check — this exists so
# staleness is caught (and visible in Loom's Auth tab, plus the proactive
# toast) even on a long-running deployment nobody happens to trigger a real
# DDB fetch or an explicit Check Now on for a while.
DDB_AUTH_CHECK_INTERVAL_SECONDS = 24 * 60 * 60

# One connection per subscriber (ThreadingHTTPServer spawns a thread per
# connection, daemon_threads=True — see SheetsHTTPServer below), held open
# for at most LIVE_STREAM_SECONDS before the handler returns normally and
# closes it; EventSource's own built-in auto-reconnect (see
# undercroft/common/js/lib/live.js) opens a fresh one immediately. Capping
# stream lifetime this way — rather than looping forever — bounds how many
# stale threads a browser tab left open in a background window could ever
# accumulate.
LIVE_STREAM_SECONDS = 55
LIVE_POLL_INTERVAL_SECONDS = 1.0


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
        self._start_touch_flush_thread()
        self._start_ddb_auth_check_thread()
        super().serve_forever(poll_interval=poll_interval)

    # Unlike the config watcher above (opt-in, behind config_watch), this
    # runs unconditionally — every deployment does reads, and reads are
    # exactly what queue up pending_touches (see get_item in storage.py).
    # Same daemon-thread/stop-event shape as ConfigLoader.watch().
    def _start_touch_flush_thread(self) -> None:
        def _loop():
            while not self._shutdown_event.is_set():
                self._shutdown_event.wait(TOUCH_FLUSH_INTERVAL_SECONDS)
                if self._shutdown_event.is_set():
                    return
                try:
                    flush_pending_touches(self.state)
                except Exception:  # pragma: no cover - best-effort background flush
                    logging.exception("Failed to flush pending last_accessed_at touches")

        threading.Thread(target=_loop, name="touch-flush", daemon=True).start()

    # Same shape as _start_touch_flush_thread above — Event.wait (not
    # sleep) so shutdown is responsive instead of blocking for the full
    # interval, re-checked after the wait returns, broad except so one bad
    # check (a network blip, DDB briefly down) never kills the daemon
    # thread. Deliberately unconditional, same reasoning as the touch-flush
    # thread — a fresh deployment with no DDB cookie configured yet just
    # gets a harmless "not configured" result every day until one is set.
    def _start_ddb_auth_check_thread(self) -> None:
        def _loop():
            while not self._shutdown_event.is_set():
                self._shutdown_event.wait(DDB_AUTH_CHECK_INTERVAL_SECONDS)
                if self._shutdown_event.is_set():
                    return
                try:
                    check_ddb_auth_status(self.state)
                except Exception:  # pragma: no cover - best-effort background check
                    logging.exception("Failed to run periodic D&D Beyond auth check")

        threading.Thread(target=_loop, name="ddb-auth-check", daemon=True).start()

    def shutdown(self) -> None:
        self._shutdown_event.set()
        try:
            flush_pending_touches(self.state)
        except Exception:  # pragma: no cover - best-effort final flush
            logging.exception("Failed to flush pending last_accessed_at touches on shutdown")
        super().shutdown()

    # A client (browser tab close/reload, a dropped long-poll) tearing down
    # its TCP connection mid-request is routine, not a bug — but the default
    # socketserver.BaseServer.handle_error prints a full traceback for every
    # one of these regardless. Suppress only the specific "connection went
    # away" exceptions so real handler bugs still get their traceback.
    def handle_error(self, request, client_address) -> None:
        exc_type = sys.exc_info()[0]
        if exc_type is not None and issubclass(
            exc_type, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)
        ):
            return
        super().handle_error(request, client_address)


class RequestHandler(http.server.BaseHTTPRequestHandler):
    # BaseHTTPRequestHandler defaults to HTTP/1.0, which never reuses a
    # connection — every single request (every JS module import, every CSS
    # file, every API call) pays a full new TCP connection setup. A HAR
    # capture confirmed this directly: 36 of 38 requests for one page load
    # each needed a brand-new connection, consistently costing ~300ms to
    # establish (while the server's own response time was 3-9ms) — that's
    # the dominant cost in the "several seconds before most of the UI
    # appears" symptom, not anything server-side logic was doing. HTTP/1.1
    # here enables keep-alive, so the browser can reuse one connection for
    # many requests instead of opening a new one each time. This is safe
    # with the existing response code: _send_response always sets
    # Content-Length (required for the stdlib to manage keep-alive
    # correctly), for both API and static-file responses.
    protocol_version = "HTTP/1.1"

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

    # GET /live/{groupId}?kinds=encounter,character&token=...&watermarks=...
    #
    # A Server-Sent-Events stream: combat-tracker.js/game-log.js/now-showing.js
    # subscribe to whichever kinds they already poll and just get told
    # {"kind": ..., "id": ...} when one of that kind's records changes, then
    # re-fetch it through the exact same dataManager.get() path they already
    # use — no business logic duplicated here, this only tails
    # library_items.modified_at and reports what moved.
    #
    # EventSource (the browser API this feeds) cannot set a custom
    # Authorization header, so auth here is a `token` query param instead,
    # checked through the same session lookup every other endpoint's Bearer
    # token goes through — not a separate, weaker auth path, just a
    # different place the same token has to travel from.
    #
    # The one hard constraint: server.state.lock (see do_GET's own comment
    # on it) still serializes every write and every not-yet-audited GET route
    # this server handles — a loop that blocked while holding it would freeze
    # all of those for every user, not just this connection. So the lock is
    # only ever held for the brief "check what changed" query each tick,
    # released before writing to the socket or sleeping.
    def _handle_live_stream(self, group_id: str, query: Dict[str, list]) -> None:
        token = (query.get("token", [""])[0] or "").strip()
        # Every other DB touch in this class (do_GET/do_POST's own handler
        # dispatch, and this same method's polling loop further below) holds
        # state.lock while it runs — this call is a session lookup, which
        # both reads AND writes (last_accessed_at/expires_at refresh) the one
        # shared sqlite3.Connection every thread uses. Left unlocked, it can
        # race a concurrent request's own execute()/commit() on that same
        # connection object — confirmed directly: this produced a real
        # "cannot commit - no transaction is active" OperationalError, since
        # a live-stream connection stays open (and threads keep firing
        # ordinary API requests) for the whole LIVE_STREAM_SECONDS window.
        with self.server.state.lock:
            user = get_user_by_session(self.server.state, token) if token else None
        share_token = (query.get("share", [""])[0] or "").strip()
        if not user and not share_token:
            self.send_response(HTTPStatus.UNAUTHORIZED)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        kinds_param = (query.get("kinds", [""])[0] or "").strip()
        kinds = [k.strip() for k in kinds_param.split(",") if k.strip()]
        if not kinds:
            self.send_response(HTTPStatus.BAD_REQUEST)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        try:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", self.server.state.config.options.cors_origin)
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

        shutdown_event = getattr(self.server, "_shutdown_event", None)
        # "group_log" is the one special kind: the human-readable campaign
        # log (group_logs table, spotlight/game-log's own backbone) has its
        # own monotonic int id, a different watermark shape from every other
        # kind's library_items.modified_at string — handled as its own case
        # in the loop below rather than folded into that same query.
        last_seen: Dict[str, Any] = {}
        # The first tick only establishes each kind's current watermark —
        # without this, every record that already existed before the client
        # connected would look "new" against an empty last_seen and get
        # reported all at once.
        first_tick = True
        deadline = time.monotonic() + LIVE_STREAM_SECONDS
        while time.monotonic() < deadline:
            if shutdown_event is not None and shutdown_event.is_set():
                return
            changed = []
            with self.server.state.lock:
                for kind in kinds:
                    if kind == "group_log":
                        rows = self.server.state.db.execute(
                            "SELECT id FROM group_logs WHERE group_id = ? ORDER BY id DESC LIMIT 25",
                            (group_id,),
                        ).fetchall()
                        watermark = last_seen.get(kind, 0)
                        newest = watermark
                        for row in rows:
                            row_id = row["id"]
                            if not first_tick and row_id > watermark:
                                changed.append({"kind": "group_log", "id": row_id})
                            if row_id > newest:
                                newest = row_id
                        if newest:
                            last_seen[kind] = newest
                        continue
                    if kind == "ping":
                        # Ephemeral — see ServerState.pending_pings' own
                        # comment. Same int-seq watermark shape as group_log
                        # above (no library_items row/modified_at string to
                        # watch), but read from the in-memory bucket instead
                        # of a DB query.
                        watermark = last_seen.get(kind, 0)
                        newest = watermark
                        for entry in self.server.state.get_ping_bucket(group_id):
                            if not first_tick and entry["seq"] > watermark:
                                changed.append({"kind": "ping", "position": entry.get("position"), "by": entry.get("by")})
                            if entry["seq"] > newest:
                                newest = entry["seq"]
                        if newest:
                            last_seen[kind] = newest
                        continue
                    if kind == "diceRoll":
                        # Ephemeral — see ServerState.pending_dice_roll_broadcasts'
                        # own comment. Identical shape to "ping" above, just a
                        # separate bucket/seq counter so a burst of pings and a
                        # burst of dice broadcasts never share (and reset) each
                        # other's watermark.
                        watermark = last_seen.get(kind, 0)
                        newest = watermark
                        for entry in self.server.state.get_dice_roll_broadcast_bucket(group_id):
                            if not first_tick and entry["seq"] > watermark:
                                changed.append(
                                    {
                                        "kind": "diceRoll",
                                        "label": entry.get("label"),
                                        "total": entry.get("total"),
                                        "dieResults": entry.get("dieResults"),
                                        "by": entry.get("by"),
                                    }
                                )
                            if entry["seq"] > newest:
                                newest = entry["seq"]
                        if newest:
                            last_seen[kind] = newest
                        continue
                    if kind == "cardDraw":
                        # Ephemeral — see ServerState.pending_card_broadcasts'
                        # own comment. Identical shape to "diceRoll" above.
                        watermark = last_seen.get(kind, 0)
                        newest = watermark
                        for entry in self.server.state.get_card_broadcast_bucket(group_id):
                            if not first_tick and entry["seq"] > watermark:
                                changed.append(
                                    {
                                        "kind": "cardDraw",
                                        "deckLabel": entry.get("deckLabel"),
                                        "backImage": entry.get("backImage"),
                                        "cards": entry.get("cards"),
                                        "by": entry.get("by"),
                                    }
                                )
                            if entry["seq"] > newest:
                                newest = entry["seq"]
                        if newest:
                            last_seen[kind] = newest
                        continue
                    if kind == "effectTrigger":
                        # Ephemeral — see ServerState.pending_effect_broadcasts'
                        # own comment. Identical shape to "cardDraw" above.
                        watermark = last_seen.get(kind, 0)
                        newest = watermark
                        for entry in self.server.state.get_effect_broadcast_bucket(group_id):
                            if not first_tick and entry["seq"] > watermark:
                                changed.append(
                                    {
                                        "kind": "effectTrigger",
                                        "mapId": entry.get("mapId"),
                                        "elementId": entry.get("elementId"),
                                        "by": entry.get("by"),
                                    }
                                )
                            if entry["seq"] > newest:
                                newest = entry["seq"]
                        if newest:
                            last_seen[kind] = newest
                        continue
                    rows = self.server.state.db.execute(
                        "SELECT id, modified_at FROM library_items WHERE kind = ? ORDER BY modified_at DESC LIMIT 25",
                        (kind,),
                    ).fetchall()
                    watermark = last_seen.get(kind, "")
                    newest = watermark
                    for row in rows:
                        modified_at = row["modified_at"] or ""
                        if not first_tick and modified_at > watermark:
                            changed.append({"kind": kind, "id": row["id"]})
                        if modified_at > newest:
                            newest = modified_at
                    if newest:
                        last_seen[kind] = newest
            first_tick = False
            try:
                for event in changed:
                    self.wfile.write(f"data: {json.dumps(event)}\n\n".encode("utf-8"))
                self.wfile.write(b": ping\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                return
            time.sleep(LIVE_POLL_INTERVAL_SECONDS)

    def do_GET(self) -> None:
        path_only = self.path.split("?")[0]
        if path_only.startswith("/live/"):
            from urllib.parse import parse_qs, urlsplit

            group_id = path_only[len("/live/") :]
            query = parse_qs(urlsplit(self.path).query)
            try:
                self._handle_live_stream(group_id, query)
            except Exception:  # pragma: no cover - best-effort stream, never crash the server
                logging.exception("Live stream error")
            return
        request = self._request()
        match = self.router.match("GET", request.handler.path.split("?")[0])
        if match:
            route, params = match
            request.params = params  # type: ignore[attr-defined]
            try:
                # ThreadingHTTPServer runs each request on its own thread, but
                # every route used to share one sqlite3.Connection
                # (check_same_thread=False only disables Python's same-thread
                # check — it does not make concurrent statement execution on
                # that connection safe), so this lock used to serialize EVERY
                # request, unconditionally — confirmed as a real page-load
                # bottleneck: a page firing a dozen-plus concurrent GETs (e.g.
                # Workbench populating its character/template/system
                # catalogs) had them all queue up and execute one at a time,
                # each waiting on the last one's full round trip, even though
                # none of them actually needed to.
                #
                # route.unlocked (see router.py's Route) marks a handler
                # specifically audited to route every read through
                # ServerState.read_db (safe for concurrent, lock-free access
                # — see that connection's own comment) and every write
                # through ServerState.lock/db itself, so it no longer needs
                # this blanket lock at all. Every other route is unaudited —
                # it keeps the exact original behavior, unchanged.
                if route.unlocked:
                    result = route.handler(request)
                else:
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

    # unlocked=True — see router.py's Route.unlocked and do_GET's own comment.
    # list_bucket (storage.py) and everything it calls (is_owner/is_shared/
    # is_public, accessible_group_ids, _sync_library_kind_directory) has been
    # audited to read via state.read_db and write via state.lock/db itself.
    router.add("GET", r"^/list/(?P<bucket>[^/]+)$", handle_list, unlocked=True)

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

    # unlocked=True — see handle_list's own comment just above; get_item
    # (storage.py) and everything it calls (is_owner/is_shared/is_public,
    # resolve_share_token, user_can_access_group, get_active_spotlights,
    # _sync_library_kind_directory) has been audited the same way.
    router.add("GET", r"^/content/(?P<bucket>[^/]+)/(?P<id>[^/]+)$", handle_get_content, unlocked=True)

    # POST /content/{bucket}/bulk — {ids?: string[], systemIds?: string[]}
    # in, {"items": [{"id", "body"}, ...]} out (get_items_bulk's own comment
    # on why id/body are paired explicitly, not a bare list of bodies).
    # Replaces the old "one GET per record" pattern (common/js/lib/
    # content-fetch.js's own fetchKindEntriesWithIds) with a single request;
    # POST (not GET) purely because a large `ids` list doesn't belong in a
    # query string, not because this writes anything. Neither filter is
    # required — omitting both returns every body this user can access for
    # the kind, same access rules as GET /content/{bucket}/{id} and GET
    # /list/{bucket}, just batched.
    def handle_get_content_bulk(request: Request) -> Response:
        params = getattr(request, "params")
        bucket = normalize_kind(params["bucket"])
        user = request.handler.current_user()
        payload = require_json(request)
        ids = payload.get("ids")
        system_ids = payload.get("systemIds")
        bodies = get_items_bulk(
            request.state,
            bucket,
            user,
            ids=ids if isinstance(ids, list) else None,
            system_ids=system_ids if isinstance(system_ids, list) else None,
        )
        return json_response({"items": bodies})

    # unlocked=True — see handle_get_content's own comment just above;
    # get_items_bulk calls list_bucket (already audited) and load_json
    # (plain file read, no locking concerns for a read path).
    router.add("POST", r"^/content/(?P<bucket>[^/]+)/bulk$", handle_get_content_bulk, unlocked=True)

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

    # POST /custom-fonts — a shared, server-persisted font library, not a
    # Press-specific concept (Workbench's own Font field reads/writes the
    # same list; see common/js/lib/font-library.js), same pattern as
    # /soundboard/clips below.
    def resolve_custom_fonts_path(state: ServerState) -> Path:
        return state.root_dir / "undercroft" / "common" / "data" / "custom-fonts.json"

    def handle_custom_font_save(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        if role_rank(user.tier) < role_rank("creator"):
            raise AuthError("Creator tier or higher required to add fonts")
        payload = require_json(request)
        font = payload.get("font", payload)
        if not font or not isinstance(font, dict) or not font.get("id"):
            return json_response({"error": "Invalid custom font payload"}, status=HTTPStatus.BAD_REQUEST)
        path = resolve_custom_fonts_path(request.state)
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

    router.add("POST", r"^/custom-fonts$", handle_custom_font_save)

    # POST /custom-fonts/delete — this server has no do_DELETE at all
    # (only do_GET/do_POST are wired up), so every deletion in this codebase
    # goes through a POST .../delete route instead of a true HTTP DELETE
    # (see /auth/users/delete, /content/{bucket}/{id}/delete).
    def handle_custom_font_delete(request: Request) -> Response:
        user = request.handler.current_user()
        if not user or user.tier != "admin":
            raise AuthError("Admin only")
        payload = require_json(request)
        font_id = payload.get("id")
        if not font_id:
            return json_response({"error": "font id required"}, status=HTTPStatus.BAD_REQUEST)
        path = resolve_custom_fonts_path(request.state)
        try:
            existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except (json.JSONDecodeError, OSError):
            existing = {}
        fonts = existing.get("fonts") if isinstance(existing.get("fonts"), list) else []
        fonts = [entry for entry in fonts if entry.get("id") != font_id]
        serialized = json.dumps({"fonts": fonts}, indent=2, sort_keys=False)
        path.write_text(f"{serialized}\n", encoding="utf-8")
        return json_response({"ok": True, "fonts": fonts})

    router.add("POST", r"^/custom-fonts/delete$", handle_custom_font_delete)

    # POST /soundboard/clips — a shared, GM-buildable audio clip library for
    # the Dashboard's own Soundboard widget, same pattern as custom-fonts.json
    # above (a flat, server-persisted JSON list anyone gm+ can add to,
    # upserted by id) rather than a Library kind — there's no per-clip
    # ownership/sharing to model, just one shared catalog.
    def resolve_soundboard_clips_path(state: ServerState) -> Path:
        return state.root_dir / "undercroft" / "common" / "data" / "audio-clips.json"

    def handle_soundboard_clip_save(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        if role_rank(user.tier) < role_rank("gm"):
            raise AuthError("GM tier or higher required to add clips")
        payload = require_json(request)
        clip = payload.get("clip", payload)
        if not clip or not isinstance(clip, dict) or not clip.get("id") or not clip.get("url"):
            return json_response({"error": "Invalid clip payload"}, status=HTTPStatus.BAD_REQUEST)
        path = resolve_soundboard_clips_path(request.state)
        try:
            existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except (json.JSONDecodeError, OSError):
            existing = {}
        clips = existing.get("clips") if isinstance(existing.get("clips"), list) else []
        clips = [entry for entry in clips if entry.get("id") != clip.get("id")]
        clips.append(clip)
        serialized = json.dumps({"clips": clips}, indent=2, sort_keys=False)
        path.write_text(f"{serialized}\n", encoding="utf-8")
        return json_response({"ok": True, "clips": clips})

    router.add("POST", r"^/soundboard/clips$", handle_soundboard_clip_save)

    # POST /soundboard/clips/delete — same "no true HTTP DELETE" reasoning as
    # /press/custom-fonts/delete above.
    def handle_soundboard_clip_delete(request: Request) -> Response:
        user = request.handler.current_user()
        if not user or user.tier != "admin":
            raise AuthError("Admin only")
        payload = require_json(request)
        clip_id = payload.get("id")
        if not clip_id:
            return json_response({"error": "clip id required"}, status=HTTPStatus.BAD_REQUEST)
        path = resolve_soundboard_clips_path(request.state)
        try:
            existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except (json.JSONDecodeError, OSError):
            existing = {}
        clips = existing.get("clips") if isinstance(existing.get("clips"), list) else []
        clips = [entry for entry in clips if entry.get("id") != clip_id]
        serialized = json.dumps({"clips": clips}, indent=2, sort_keys=False)
        path.write_text(f"{serialized}\n", encoding="utf-8")
        return json_response({"ok": True, "clips": clips})

    router.add("POST", r"^/soundboard/clips/delete$", handle_soundboard_clip_delete)

    # POST /token-library — a shared, GM-buildable library of map-token image
    # links (Orrery marker tokens, Forge NPC/Crucible Monster portraits),
    # same pattern as audio-clips.json/custom-fonts.json above: a flat,
    # server-persisted JSON list anyone gm+ can add to, upserted by id,
    # rather than a Library kind — there's no per-token ownership/sharing to
    # model, just one shared catalog of externally-hosted image links (no
    # upload, no file hosting by this app).
    def resolve_token_library_path(state: ServerState) -> Path:
        return state.root_dir / "undercroft" / "common" / "data" / "token-library.json"

    def handle_token_library_save(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        if role_rank(user.tier) < role_rank("gm"):
            raise AuthError("GM tier or higher required to add tokens")
        payload = require_json(request)
        token = payload.get("token", payload)
        if not token or not isinstance(token, dict) or not token.get("id") or not token.get("url"):
            return json_response({"error": "Invalid token payload"}, status=HTTPStatus.BAD_REQUEST)
        path = resolve_token_library_path(request.state)
        try:
            existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except (json.JSONDecodeError, OSError):
            existing = {}
        tokens = existing.get("tokens") if isinstance(existing.get("tokens"), list) else []
        tokens = [entry for entry in tokens if entry.get("id") != token.get("id")]
        tokens.append(token)
        serialized = json.dumps({"tokens": tokens}, indent=2, sort_keys=False)
        path.write_text(f"{serialized}\n", encoding="utf-8")
        return json_response({"ok": True, "tokens": tokens})

    router.add("POST", r"^/token-library$", handle_token_library_save)

    # POST /token-library/delete — same "no true HTTP DELETE" reasoning as
    # /soundboard/clips/delete above.
    def handle_token_library_delete(request: Request) -> Response:
        user = request.handler.current_user()
        if not user or user.tier != "admin":
            raise AuthError("Admin only")
        payload = require_json(request)
        token_id = payload.get("id")
        if not token_id:
            return json_response({"error": "token id required"}, status=HTTPStatus.BAD_REQUEST)
        path = resolve_token_library_path(request.state)
        try:
            existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except (json.JSONDecodeError, OSError):
            existing = {}
        tokens = existing.get("tokens") if isinstance(existing.get("tokens"), list) else []
        tokens = [entry for entry in tokens if entry.get("id") != token_id]
        serialized = json.dumps({"tokens": tokens}, indent=2, sort_keys=False)
        path.write_text(f"{serialized}\n", encoding="utf-8")
        return json_response({"ok": True, "tokens": tokens})

    router.add("POST", r"^/token-library/delete$", handle_token_library_delete)

    # GET /google-fonts-metadata — shared by both Press's and Workbench's
    # Font pickers (common/js/lib/font-library.js), not Press-specific.
    #
    # Proxies Google's font-picker metadata endpoint server-side. That
    # endpoint is Google's internal API (not published for third-party use)
    # and doesn't send CORS headers permitting a browser fetch() read from
    # this origin — a public CORS proxy (corsproxy.io, used elsewhere for
    # D&D Beyond) was tried first but its free tier now rejects non-localhost
    # callers outright. Fetching it here instead sidesteps CORS entirely,
    # same reasoning as /ddb-proxy above, just with a fixed target and no
    # session cookie needed.
    def handle_google_fonts_metadata(request: Request) -> Response:
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

    router.add("GET", r"^/google-fonts-metadata$", handle_google_fonts_metadata)

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
    # handle_google_fonts_metadata/handle_ddb_proxy above (urllib
    # only), reading the API key via integrations.py's own
    # resolve_anthropic_api_key (the encrypted deployment_secrets store,
    # managed through Loom's Auth tab — falls back to a one-time migration
    # from the legacy server/anthropic.local.json file if that's all a
    # given deployment has).
    FORGE_NOTE_SYSTEM_PROMPT = (
        "You write a single, tightly-formatted NPC character note for a tabletop RPG GM.\n"
        "Respond with EXACTLY this format and nothing else — no preamble, no markdown, no extra commentary:\n\n"
        "Name (Alignment Gender Species Archetype). [2-3 sentences weaving the given Description, Demeanor, "
        "Drive, and Direction traits into a vivid but concise character note.]\n\n"
        "Use the exact Name, Alignment, Gender, Species, and Archetype values given verbatim. Do not invent "
        "new attributes, do not restate these instructions, and do not add anything before or after the "
        "single formatted line."
    )

    def _format_note_only(raw_text: str, name: str) -> Dict[str, Any]:
        return {"note": raw_text}

    def _format_name_and_note(raw_text: str, name: str) -> Dict[str, Any]:
        # First line is the (possibly Claude-suggested) name; everything after
        # is the note itself. Falls back to the original name/full text if
        # the model doesn't follow the two-line format exactly.
        first_line, _, rest = raw_text.partition("\n")
        suggested_name = first_line.strip() or name
        note = rest.strip() or raw_text
        return {"name": suggested_name, "note": note}

    # Shared by the four *_generate-note routes below (Forge/Crucible/Vault/
    # Sanctum): each optional LLM synthesis step (CLAUDE.md: "entirely
    # optional... rolled/generated values stand on their own") proxies
    # Anthropic's Messages API the same no-extra-dependency way as
    # handle_google_fonts_metadata/handle_ddb_proxy above (urllib only),
    # reading the API key via integrations.py's own
    # resolve_anthropic_api_key (see the comment on the route above for the
    # full storage story). The four routes differ
    # only in system prompt and how the request payload becomes user_content —
    # `build_user_content` returns (user_content, fallback_name) and may raise
    # ValueError for a 400 (Forge's required identity.name); `format_result`
    # shapes the final response (Forge returns just {note}, the other three
    # also return a possibly-Claude-suggested {name}).
    def _handle_generate_note(
        request: Request,
        *,
        system_prompt: str,
        build_user_content: Callable[[Dict[str, Any]], tuple[str, str]],
        format_result: Callable[[str, str], Dict[str, Any]],
    ) -> Response:
        import urllib.error
        import urllib.request

        api_key = resolve_anthropic_api_key(request.state)
        if not api_key:
            return json_response(
                {
                    "error": (
                        "Missing Anthropic API key — set one in Loom's Auth tab (admin only), or copy "
                        "server/anthropic.local.json.example to server/anthropic.local.json and fill in api_key."
                    )
                },
                status=HTTPStatus.BAD_REQUEST,
            )
        payload = require_json(request)
        try:
            user_content, fallback_name = build_user_content(payload)
        except ValueError as exc:
            return json_response({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
        request_body = json.dumps(
            {
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 300,
                "system": system_prompt,
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
        return json_response(format_result(raw_text, fallback_name))

    def _build_forge_note_content(payload: Dict[str, Any]) -> tuple[str, str]:
        identity = payload.get("identity") or {}
        four_d = payload.get("fourD") or {}
        name = str(identity.get("name") or "").strip()
        if not name:
            raise ValueError("identity.name is required")
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
        return user_content, name

    def handle_forge_generate_note(request: Request) -> Response:
        return _handle_generate_note(
            request,
            system_prompt=FORGE_NOTE_SYSTEM_PROMPT,
            build_user_content=_build_forge_note_content,
            format_result=_format_note_only,
        )

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

    def _build_crucible_note_content(payload: Dict[str, Any]) -> tuple[str, str]:
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
        return user_content, name

    def handle_crucible_generate_note(request: Request) -> Response:
        return _handle_generate_note(
            request,
            system_prompt=CRUCIBLE_NOTE_SYSTEM_PROMPT,
            build_user_content=_build_crucible_note_content,
            format_result=_format_name_and_note,
        )

    router.add("POST", r"^/crucible/generate-note$", handle_crucible_generate_note)

    # POST /vault/generate-note
    #
    # Same optional LLM synthesis step as Crucible's monster note, applied to
    # a generated spell/item wonder instead — Vault's own structured output
    # (properties + selected features) stands on its own with no LLM
    # involvement; this just turns it into a short flavor note for a GM who
    # wants one. Reuses resolve_anthropic_api_key above.
    VAULT_NOTE_SYSTEM_PROMPT = (
        "You suggest a name (when one isn't already given) and write a single, "
        "tightly-formatted magic wonder note for a tabletop RPG GM.\n"
        "Respond with EXACTLY two lines and nothing else — no preamble, no markdown, "
        "no extra commentary:\n\n"
        "Line 1: just the wonder's name, nothing else. If a Name is already given "
        "below, repeat it verbatim. If Name is blank, invent one that fits the given "
        "Properties and Signature Feature.\n"
        "Line 2: Name (comma-separated Properties). [2-3 sentences describing what "
        "this wonder does and how it feels to use, weaving in its Signature Feature "
        "and its other features into a vivid but concise flavor note.]\n\n"
        "Use the exact Properties and Signature Feature values given verbatim, and "
        "use the same name on both lines. Do not invent new features or mechanics, do "
        "not restate these instructions, and do not add anything before, between, or "
        "after these two lines."
    )

    def _build_vault_note_content(payload: Dict[str, Any]) -> tuple[str, str]:
        wonder = payload.get("wonder") or {}
        # Name is optional now — Vault's Name field is blank by default, and
        # this endpoint is the one place that can fill it in, so an empty name
        # is a normal request, not an error: the prompt asks Claude to invent
        # one fitting the Properties/Signature Feature when it's blank.
        name = str(wonder.get("name") or "").strip()
        properties = wonder.get("properties") or {}
        property_lines = ", ".join(f"{label}: {value}" for label, value in properties.items() if value)
        features = wonder.get("features") or []
        feature_lines = "\n".join(
            f"- {feature.get('name', '')}: {feature.get('description', '')}"
            for feature in features
            if isinstance(feature, dict)
        )
        user_content = (
            f"Name: {name}\n"
            f"Properties: {property_lines}\n"
            f"Signature Feature: {wonder.get('signatureFeature', '')}\n"
            f"Features:\n{feature_lines}\n"
        )
        return user_content, name

    def handle_vault_generate_note(request: Request) -> Response:
        return _handle_generate_note(
            request,
            system_prompt=VAULT_NOTE_SYSTEM_PROMPT,
            build_user_content=_build_vault_note_content,
            format_result=_format_name_and_note,
        )

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

    def _build_sanctum_note_content(payload: Dict[str, Any]) -> tuple[str, str]:
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
        return user_content, name

    def handle_sanctum_generate_note(request: Request) -> Response:
        return _handle_generate_note(
            request,
            system_prompt=SANCTUM_NOTE_SYSTEM_PROMPT,
            build_user_content=_build_sanctum_note_content,
            format_result=_format_name_and_note,
        )

    router.add("POST", r"^/sanctum/generate-note$", handle_sanctum_generate_note)

    # --- Home Assistant integration -----------------------------------------
    #
    # A GM's own connection to their Home Assistant instance (base_url + a
    # long-lived access token), proxied server-side rather than called
    # directly from the browser the way the Lighting widget's WLED devices
    # are — HA doesn't send CORS headers by default, and keeping the token
    # here means it's stored encrypted (integrations.py) and never handed
    # back to the client after the save that set it. gm+ tier gated, same bar
    # as WLED devices/soundboard clips/token library — this is GM-run-the-
    # table infrastructure. Every proxy call below is urllib-only, matching
    # every other external-fetch route in this file (google-fonts-metadata,
    # ddb-proxy, the *_generate-note routes above) — no HTTP client
    # dependency.
    def require_gm(request: Request) -> User:
        user = require_user(request)
        if role_rank(user.tier) < role_rank("gm"):
            raise AuthError("GM tier or higher required")
        return user

    def normalize_ha_base_url(raw: str) -> str:
        trimmed = (raw or "").strip()
        if not trimmed:
            return ""
        if not trimmed.lower().startswith(("http://", "https://")):
            trimmed = f"http://{trimmed}"
        return trimmed.rstrip("/")

    # Best-effort — HA's own error responses are usually a small JSON body
    # ({"message": "Unauthorized"} for a bad token, say) far more useful for
    # debugging than the bare status code alone. Logged server-side only
    # (see each call site below) — never included in the response sent to
    # the client, which only ever gets the generic "Home Assistant returned
    # N" (DataManager's own 5xx sanitization would strip more detail than
    # this anyway; see home-assistant.js's own comment on that).
    def _read_ha_error_body(exc) -> str:
        try:
            return exc.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            return ""

    # GET /home-assistant/connection — {configured, baseUrl} only, never the
    # token (see integrations.py's own header comment on why).
    def handle_get_ha_connection(request: Request) -> Response:
        user = require_gm(request)
        return json_response(get_ha_connection(request.state, user.id))

    router.add("GET", r"^/home-assistant/connection$", handle_get_ha_connection)

    # POST /home-assistant/connection — the ONE time the plaintext token
    # crosses the wire; encrypted immediately and never echoed back.
    def handle_save_ha_connection(request: Request) -> Response:
        user = require_gm(request)
        payload = require_json(request)
        base_url = normalize_ha_base_url(payload.get("baseUrl", ""))
        token = str(payload.get("token") or "").strip()
        if not base_url:
            return json_response({"error": "Base URL is required"}, status=HTTPStatus.BAD_REQUEST)
        existing = get_ha_connection(request.state, user.id)
        # A blank token on an edit means "keep the one already saved," not
        # "clear it" — re-pasting a long-lived access token just to fix a
        # typo'd URL is real friction this avoids. Only valid when a
        # connection already exists; a brand-new one still needs a real
        # token, same as before.
        if not token:
            if not existing.get("configured"):
                return json_response({"error": "Base URL and token are both required"}, status=HTTPStatus.BAD_REQUEST)
            update_ha_connection_url(request.state, user.id, base_url)
            return json_response(get_ha_connection(request.state, user.id))
        try:
            save_ha_connection(request.state, user.id, base_url, token)
        except EncryptionUnavailable as exc:
            return json_response({"error": str(exc)}, status=HTTPStatus.SERVICE_UNAVAILABLE)
        return json_response(get_ha_connection(request.state, user.id))

    router.add("POST", r"^/home-assistant/connection$", handle_save_ha_connection)

    # POST /home-assistant/connection/clear — this server has no do_DELETE at
    # all (see /custom-fonts/delete's own comment), same reasoning here.
    def handle_clear_ha_connection(request: Request) -> Response:
        user = require_gm(request)
        clear_ha_connection(request.state, user.id)
        return json_response({"ok": True})

    router.add("POST", r"^/home-assistant/connection/clear$", handle_clear_ha_connection)

    # Shared by the two live-proxy routes below — a Response to return
    # immediately covers both "not connected yet" (expected, most accounts)
    # and "cryptography isn't installed" (a deploy-time gap, not a user
    # mistake) with the status code each actually deserves, rather than
    # forcing both through one generic exception type.
    def resolve_ha_credentials_or_response(request: Request, user: User):
        try:
            credentials = resolve_ha_credentials(request.state, user.id)
        except EncryptionUnavailable as exc:
            return None, json_response({"error": str(exc)}, status=HTTPStatus.SERVICE_UNAVAILABLE)
        if not credentials:
            return None, json_response(
                {"error": "Home Assistant isn't connected yet — set it up first."}, status=HTTPStatus.BAD_REQUEST
            )
        return credentials, None

    # GET /home-assistant/entities — proxies HA's own /api/states, trimmed
    # down to {entityId, domain, friendlyName} per entry (never the full
    # state/attributes payload — sensor readings etc. have no reason to
    # leave HA just to populate a device picker). Backs the populated
    # entity selects in both the Lighting widget's "Add an HA light" flow
    # and the Macro action editor (Loom).
    def handle_ha_entities(request: Request) -> Response:
        import urllib.error
        import urllib.request

        user = require_gm(request)
        credentials, error = resolve_ha_credentials_or_response(request, user)
        if error:
            return error
        proxy_request = urllib.request.Request(
            f"{credentials['baseUrl']}/api/states",
            headers={"Authorization": f"Bearer {credentials['token']}", "Accept": "application/json"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(proxy_request, timeout=15) as upstream:
                body = json.loads(upstream.read())
        except urllib.error.HTTPError as exc:
            detail = _read_ha_error_body(exc)
            logging.warning("Home Assistant /api/states call failed: %s %s", exc.code, detail)
            return json_response({"error": f"Home Assistant returned {exc.code}"}, status=HTTPStatus.BAD_GATEWAY)
        except urllib.error.URLError as exc:
            logging.warning("Unable to reach Home Assistant at %s: %s", credentials["baseUrl"], exc.reason)
            return json_response({"error": f"Unable to reach Home Assistant ({exc.reason})"}, status=HTTPStatus.BAD_GATEWAY)
        except (json.JSONDecodeError, TypeError):
            return json_response({"error": "Home Assistant returned an unexpected response"}, status=HTTPStatus.BAD_GATEWAY)

        entities = []
        for state in body if isinstance(body, list) else []:
            entity_id = state.get("entity_id") if isinstance(state, dict) else None
            if not entity_id:
                continue
            friendly_name = (state.get("attributes") or {}).get("friendly_name") or entity_id
            entities.append({"entityId": entity_id, "domain": entity_id.split(".", 1)[0], "friendlyName": friendly_name})
        return json_response({"entities": entities})

    router.add("GET", r"^/home-assistant/entities$", handle_ha_entities)

    # GET /home-assistant/entity-state?entityId=... — unlike /entities above
    # (trimmed to just what a picker needs), this proxies ONE entity's real
    # /api/states/{entity_id} and returns the light-relevant fields a live
    # control surface needs (on/off, brightness, color, which color modes it
    # actually supports) — still curated, not a raw passthrough of HA's own
    # attributes blob, just curated for a different consumer (ha-light.js's
    # own render, not a dropdown).
    def handle_ha_entity_state(request: Request) -> Response:
        import urllib.error
        import urllib.parse
        import urllib.request

        user = require_gm(request)
        credentials, error = resolve_ha_credentials_or_response(request, user)
        if error:
            return error
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.handler.path).query)
        entity_id = (query.get("entityId", [""])[0] or "").strip()
        if not entity_id:
            return json_response({"error": "entityId is required"}, status=HTTPStatus.BAD_REQUEST)
        proxy_request = urllib.request.Request(
            f"{credentials['baseUrl']}/api/states/{urllib.parse.quote(entity_id, safe='.')}",
            headers={"Authorization": f"Bearer {credentials['token']}", "Accept": "application/json"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(proxy_request, timeout=15) as upstream:
                state = json.loads(upstream.read())
        except urllib.error.HTTPError as exc:
            detail = _read_ha_error_body(exc)
            if exc.code == 404:
                return json_response({"error": f'No entity "{entity_id}" on this Home Assistant instance.'}, status=HTTPStatus.NOT_FOUND)
            logging.warning("Home Assistant /api/states/%s call failed: %s %s", entity_id, exc.code, detail)
            return json_response({"error": f"Home Assistant returned {exc.code}"}, status=HTTPStatus.BAD_GATEWAY)
        except urllib.error.URLError as exc:
            logging.warning("Unable to reach Home Assistant at %s: %s", credentials["baseUrl"], exc.reason)
            return json_response({"error": f"Unable to reach Home Assistant ({exc.reason})"}, status=HTTPStatus.BAD_GATEWAY)
        except (json.JSONDecodeError, TypeError):
            return json_response({"error": "Home Assistant returned an unexpected response"}, status=HTTPStatus.BAD_GATEWAY)

        attributes = state.get("attributes") if isinstance(state, dict) else {}
        attributes = attributes if isinstance(attributes, dict) else {}
        return json_response(
            {
                "entityId": entity_id,
                "state": state.get("state") if isinstance(state, dict) else None,
                "brightness": attributes.get("brightness"),
                "rgbColor": attributes.get("rgb_color"),
                "supportedColorModes": attributes.get("supported_color_modes") or [],
                "friendlyName": attributes.get("friendly_name") or entity_id,
            }
        )

    router.add("GET", r"^/home-assistant/entity-state$", handle_ha_entity_state)

    # POST /home-assistant/call-service — the one action route, generic
    # enough to cover both "control a device" and "trigger a routine": a
    # routine is just domain="script"/"scene"/"automation". entityId is
    # merged into the body as entity_id alongside whatever extra `data` the
    # caller supplies (e.g. brightness/rgb_color for a light.turn_on).
    def handle_ha_call_service(request: Request) -> Response:
        import urllib.error
        import urllib.request

        user = require_gm(request)
        credentials, error = resolve_ha_credentials_or_response(request, user)
        if error:
            return error
        payload = require_json(request)
        domain = str(payload.get("domain") or "").strip()
        service = str(payload.get("service") or "").strip()
        entity_id = str(payload.get("entityId") or "").strip()
        if not domain or not service:
            return json_response({"error": "domain and service are both required"}, status=HTTPStatus.BAD_REQUEST)
        extra_data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        body = dict(extra_data)
        if entity_id:
            body["entity_id"] = entity_id
        proxy_request = urllib.request.Request(
            f"{credentials['baseUrl']}/api/services/{domain}/{service}",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {credentials['token']}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(proxy_request, timeout=15) as upstream:
                upstream.read()
        except urllib.error.HTTPError as exc:
            detail = _read_ha_error_body(exc)
            logging.warning("Home Assistant /api/services/%s/%s call failed: %s %s", domain, service, exc.code, detail)
            return json_response({"error": f"Home Assistant returned {exc.code}"}, status=HTTPStatus.BAD_GATEWAY)
        except urllib.error.URLError as exc:
            logging.warning("Unable to reach Home Assistant at %s: %s", credentials["baseUrl"], exc.reason)
            return json_response({"error": f"Unable to reach Home Assistant ({exc.reason})"}, status=HTTPStatus.BAD_GATEWAY)
        return json_response({"ok": True})

    router.add("POST", r"^/home-assistant/call-service$", handle_ha_call_service)

    # --- Audio transcription (optional, for the Audio Recorder widget) -----
    #
    # A GM-managed LIST of transcription servers, deployment-wide (not
    # per-account) — same reasoning deployment_secrets' own CREATE TABLE
    # comment (storage.py) and integrations.py's own header comment give.
    # Admin-tier to add/edit/delete an entry (changing the list affects every
    # account's recordings, not just the person editing it — a stricter bar
    # than the Home Assistant connection above, which only ever affects its
    # own owner); gm+ to just read the list (any GM using the Audio Recorder
    # widget needs that to populate its own server picker).
    def require_admin(request: Request) -> User:
        user = require_user(request)
        if role_rank(user.tier) < role_rank("admin"):
            raise AuthError("Admin tier required")
        return user

    # GET /admin/transcription-servers — [{id, label, baseUrl, hasKey}] —
    # never the key itself (same masking as get_ha_connection above).
    def handle_list_transcription_servers(request: Request) -> Response:
        require_gm(request)
        return json_response({"servers": list_deployment_secrets(request.state, "whisper")})

    router.add("GET", r"^/admin/transcription-servers$", handle_list_transcription_servers)

    # POST /admin/transcription-servers — upsert (create or edit) one entry,
    # keyed by a client-generated id (crypto.randomUUID(), same convention
    # board.js's own randomId uses for anything with no natural unique key).
    # The one time a plaintext API key (if any) crosses the wire; encrypted
    # immediately and never echoed back. Leaving the key blank on an edit of
    # an entry that already has one clears it — unlike Home Assistant's
    # token (always required, so blank there means "keep existing"), a
    # transcription server's key is optional to begin with, so blank has an
    # unambiguous meaning of its own: no key.
    def handle_save_transcription_server(request: Request) -> Response:
        require_admin(request)
        payload = require_json(request)
        entry_id = str(payload.get("id") or "").strip()
        label = str(payload.get("label") or "").strip()
        # The FULL endpoint URL, not a base this route appends a fixed
        # suffix to — deliberately not assuming every OpenAI-API-compatible
        # server routes its transcription endpoint at the exact same path
        # OpenAI itself uses. Whatever a given server's own docs (its
        # FastAPI /docs page, typically, for a Python one) say the real
        # transcription endpoint is, that's what goes here, verbatim — see
        # handle_audio_transcribe_chunk below, which posts to this URL
        # directly with no suffix of its own.
        base_url = str(payload.get("baseUrl") or "").strip()
        # Genuinely per-server, not a suite-wide constant — see
        # deployment_secrets' own CREATE TABLE comment (storage.py) for the
        # confirmed real bug this fixes (OpenAI's own "whisper-1" hardcoded
        # into every request, 404ing against any self-hosted server that
        # doesn't have a model by that exact name loaded). Blank is valid —
        # handle_audio_transcribe_chunk falls back to "whisper-1" itself,
        # correct for OpenAI's own real API and a reasonable default
        # elsewhere too.
        model = str(payload.get("model") or "").strip()
        token = str(payload.get("token") or "").strip()
        if not entry_id or not base_url:
            return json_response({"error": "An id and a server URL are both required"}, status=HTTPStatus.BAD_REQUEST)
        try:
            save_deployment_secret(request.state, "whisper", entry_id, label, base_url, model, token)
        except EncryptionUnavailable as exc:
            return json_response({"error": str(exc)}, status=HTTPStatus.SERVICE_UNAVAILABLE)
        return json_response({"servers": list_deployment_secrets(request.state, "whisper")})

    router.add("POST", r"^/admin/transcription-servers$", handle_save_transcription_server)

    def handle_clear_transcription_server(request: Request) -> Response:
        require_admin(request)
        params = getattr(request, "params")
        clear_deployment_secret(request.state, "whisper", params["id"])
        return json_response({"servers": list_deployment_secrets(request.state, "whisper")})

    router.add("POST", r"^/admin/transcription-servers/(?P<id>[^/]+)/clear$", handle_clear_transcription_server)

    # --- Deployment-wide auth credentials (D&D Beyond session, Anthropic
    # API key) --------------------------------------------------------------
    #
    # Same gm-reads/admin-writes split as the transcription-server list
    # above, for the same reason — these affect every account's imports/
    # note-generation, not just whoever edits them. Loom's own Auth tab
    # (admin-only) is the intended caller.
    # GET /auth/credentials — never returns either secret value, only
    # whether each is configured (same masking as get_ha_connection/
    # list_deployment_secrets' own hasKey above), plus the DDB session's
    # own last-known validity (server/ddb_auth_status.py).
    def handle_get_auth_credentials(request: Request) -> Response:
        require_gm(request)
        ddb_status = get_ddb_auth_status(request.state)
        return json_response(
            {
                "ddb": {
                    "configured": is_deployment_secret_configured(request.state, "ddb-session"),
                    **ddb_status,
                },
                "anthropic": {
                    "configured": is_deployment_secret_configured(request.state, "anthropic"),
                },
            }
        )

    router.add("GET", r"^/auth/credentials$", handle_get_auth_credentials)

    def handle_save_ddb_session_cookie(request: Request) -> Response:
        require_admin(request)
        payload = require_json(request)
        cookie = str(payload.get("cookie") or "").strip()
        if not cookie:
            return json_response({"error": "A cookie value is required"}, status=HTTPStatus.BAD_REQUEST)
        # Catches the single most common copy mistake here: clicking a row
        # in DevTools' Application/Storage cookie table and hitting Ctrl+C
        # copies the WHOLE row (name, value, domain, path, expiry — tab-
        # separated), not just the Value cell. .strip() above only trims
        # the ends, so that garbage would otherwise get saved verbatim and
        # silently fail auth with no obvious cause — a real cookie value
        # never legitimately contains whitespace.
        if any(ch.isspace() for ch in cookie):
            return json_response(
                {
                    "error": (
                        "That value contains a space, tab, or line break — it looks like more than just the "
                        "CobaltSession cookie's Value cell (a whole copied row, most likely). Double-click "
                        "directly into the Value cell (or right-click the row and choose Copy value, if your "
                        "browser offers it) so only the value itself is copied, then try again."
                    )
                },
                status=HTTPStatus.BAD_REQUEST,
            )
        save_bare_deployment_secret(request.state, "ddb-session", "D&D Beyond Session", cookie)
        return json_response({"configured": True})

    router.add("POST", r"^/auth/credentials/ddb-session$", handle_save_ddb_session_cookie)

    def handle_save_anthropic_api_key(request: Request) -> Response:
        require_admin(request)
        payload = require_json(request)
        api_key = str(payload.get("apiKey") or "").strip()
        if not api_key:
            return json_response({"error": "An API key is required"}, status=HTTPStatus.BAD_REQUEST)
        save_bare_deployment_secret(request.state, "anthropic", "Anthropic API Key", api_key)
        return json_response({"configured": True})

    router.add("POST", r"^/auth/credentials/anthropic$", handle_save_anthropic_api_key)

    def handle_check_ddb_auth_status(request: Request) -> Response:
        require_gm(request)
        result = check_ddb_auth_status(request.state)
        return json_response({"ddb": {"configured": is_deployment_secret_configured(request.state, "ddb-session"), **result}})

    router.add("POST", r"^/auth/credentials/ddb-session/check$", handle_check_ddb_auth_status)

    # POST /audio/transcribe-chunk — body is the raw audio bytes for ONE
    # recording chunk (a few minutes, never the whole session — see
    # audio-recorder.js's own header comment on why recording is chunked at
    # all), Content-Type set to whatever MediaRecorder produced (audio/webm,
    # typically). Nothing server-side ever needs to PARSE multipart — the
    # client sends a plain binary body; this route builds the multipart
    # request on the way OUT, matching OpenAI's own /v1/audio/transcriptions
    # request shape (multipart form, "file" + "model" fields) — but posts it
    # to the saved server's own baseUrl EXACTLY as entered, no suffix
    # appended (see handle_save_transcription_server's own comment on why:
    # not every self-hosted "OpenAI-compatible" server actually routes that
    # exact path the same way OpenAI does). Nothing is written to disk here;
    # the chunk is received, forwarded, and discarded, same "local-only, the
    # server never persists your session audio" property the widget itself
    # promises.
    def handle_audio_transcribe_chunk(request: Request) -> Response:
        import urllib.error
        import urllib.parse
        import urllib.request
        import uuid

        require_gm(request)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.handler.path).query)
        server_id = (query.get("serverId", [""])[0] or "").strip()
        if not server_id:
            return json_response({"error": "No transcription server selected."}, status=HTTPStatus.BAD_REQUEST)
        config = resolve_deployment_secret(request.state, "whisper", server_id)
        if not config:
            return json_response(
                {"error": "That transcription server no longer exists — pick another one."},
                status=HTTPStatus.BAD_REQUEST,
            )
        audio_bytes = request.raw_body()
        if not audio_bytes:
            return json_response({"error": "No audio data received"}, status=HTTPStatus.BAD_REQUEST)
        content_type = request.headers.get("Content-Type") or "audio/webm"

        model = config.get("model") or "whisper-1"
        boundary = uuid.uuid4().hex
        body = b"".join(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="model"\r\n\r\n{model}\r\n'.encode("utf-8"),
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="file"; filename="chunk.webm"\r\n'
                f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
                audio_bytes,
                f"\r\n--{boundary}--\r\n".encode("utf-8"),
            ]
        )
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        if config.get("token"):
            headers["Authorization"] = f"Bearer {config['token']}"

        proxy_request = urllib.request.Request(config["baseUrl"], data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(proxy_request, timeout=60) as upstream:
                result = json.loads(upstream.read())
        except urllib.error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                detail = ""
            # exc.url (not config["baseUrl"]) — reflects the actual final
            # URL urllib requested, including any redirect it may have
            # followed, so a saved URL that looks right but isn't quite
            # (a stray trailing slash, http vs https, a redirect landing
            # somewhere unexpected) shows up here rather than staying
            # invisible.
            logging.warning("Transcription server call failed: %s %s (requested %s, model=%r)", exc.code, detail, getattr(exc, "url", config["baseUrl"]), model)
            return json_response({"error": f"Transcription server returned {exc.code}"}, status=HTTPStatus.BAD_GATEWAY)
        except urllib.error.URLError as exc:
            logging.warning("Unable to reach the transcription server at %s: %s", config["baseUrl"], exc.reason)
            return json_response(
                {"error": f"Unable to reach the transcription server ({exc.reason})"}, status=HTTPStatus.BAD_GATEWAY
            )
        except (json.JSONDecodeError, TypeError):
            return json_response(
                {"error": "Transcription server returned an unexpected response"}, status=HTTPStatus.BAD_GATEWAY
            )
        return json_response({"text": str(result.get("text") or "").strip()})

    router.add("POST", r"^/audio/transcribe-chunk$", handle_audio_transcribe_chunk)

    # POST /loom/suggest-feature-tags
    #
    # LLM-assisted bulk `budgetCost`/`tags` suggestion for the monster
    # `feature` Library kind (undercroft/README.md's Workstream E) — the
    # first STRUCTURED-JSON-output route in this file (every *_generate-note
    # route above returns free two-line prose, parsed by line-splitting;
    # this one asks Claude for a JSON object and validates it strictly,
    # rejecting rather than half-applying a malformed response, same
    # "never guess" posture the client-side Feature-matching pipeline
    # already holds itself to). Grounded in two real data sources instead of
    # free-floating judgment: the existing curated starter Features (real
    # budgetCost/tags already authored, read live off disk so this stays
    # accurate as that set grows) as few-shot examples, and a CR→targetBudget
    # calibration table (CALIBRATION_TABLE below) computed once, this
    # session, by cross-referencing every imported monster's own CR against
    # its actual feature count (see the plan's own Workstream E — this is a
    # small one-off analysis, not something worth recomputing live on every
    # request, the same "flat value authored once" posture the System's own
    # per-CR targetBudget/attackBonus/saveDC table already takes). Never
    # auto-commits anything — this only returns suggestions for Loom's own
    # editor UI to show inline for accept/reject, exactly the same "assisted,
    # not automatic" spirit the rest of this session's hand-review work held
    # to throughout.
    #
    # CR, targetBudget (from sys.dnd5e.json's own Combat Scaling table), and
    # the IMPLIED average budgetCost-per-Feature at that CR level
    # (targetBudget / that CR's own average feature count across all 331
    # currently-imported real monsters) — given to the model as a rough
    # per-Feature cost anchor so suggested costs trend toward summing near a
    # monster's own targetBudget rather than floating free. Not re-derived
    # per request (recomputing this from all monster files on every call
    # would be slow and these ratios are stable), but not hand-guessed
    # either — this table IS this session's own real calibration run.
    CALIBRATION_TABLE = [
        {"cr": "0", "targetBudget": 3, "impliedCostPerFeature": 1.5},
        {"cr": "1/8", "targetBudget": 4, "impliedCostPerFeature": 0.9},
        {"cr": "1/4", "targetBudget": 4, "impliedCostPerFeature": 1.6},
        {"cr": "1/2", "targetBudget": 5, "impliedCostPerFeature": 1.0},
        {"cr": "1", "targetBudget": 6, "impliedCostPerFeature": 1.3},
        {"cr": "2", "targetBudget": 8, "impliedCostPerFeature": 1.7},
        {"cr": "3", "targetBudget": 10, "impliedCostPerFeature": 2.1},
        {"cr": "4", "targetBudget": 12, "impliedCostPerFeature": 2.4},
        {"cr": "5", "targetBudget": 14, "impliedCostPerFeature": 2.5},
        {"cr": "6", "targetBudget": 16, "impliedCostPerFeature": 2.8},
        {"cr": "7", "targetBudget": 18, "impliedCostPerFeature": 3.2},
        {"cr": "8", "targetBudget": 20, "impliedCostPerFeature": 3.4},
        {"cr": "9", "targetBudget": 22, "impliedCostPerFeature": 3.2},
        {"cr": "10", "targetBudget": 24, "impliedCostPerFeature": 3.5},
        {"cr": "11", "targetBudget": 26, "impliedCostPerFeature": 3.9},
        {"cr": "12", "targetBudget": 28, "impliedCostPerFeature": 3.7},
        {"cr": "13", "targetBudget": 30, "impliedCostPerFeature": 3.9},
        {"cr": "14", "targetBudget": 32, "impliedCostPerFeature": 3.5},
        {"cr": "15", "targetBudget": 34, "impliedCostPerFeature": 3.9},
        {"cr": "16", "targetBudget": 36, "impliedCostPerFeature": 3.8},
        {"cr": "17", "targetBudget": 38, "impliedCostPerFeature": 3.6},
        {"cr": "18", "targetBudget": 40, "impliedCostPerFeature": 3.6},
        {"cr": "19", "targetBudget": 42, "impliedCostPerFeature": 3.5},
        {"cr": "20", "targetBudget": 44, "impliedCostPerFeature": 2.9},
        {"cr": "21", "targetBudget": 48, "impliedCostPerFeature": 3.8},
        {"cr": "22", "targetBudget": 50, "impliedCostPerFeature": 3.8},
        {"cr": "23", "targetBudget": 52, "impliedCostPerFeature": 3.8},
        {"cr": "24", "targetBudget": 54, "impliedCostPerFeature": 3.9},
        {"cr": "25", "targetBudget": 56, "impliedCostPerFeature": 4.0},
        {"cr": "26", "targetBudget": 56, "impliedCostPerFeature": 4.0},
        {"cr": "27", "targetBudget": 58, "impliedCostPerFeature": 4.0},
        {"cr": "28", "targetBudget": 60, "impliedCostPerFeature": 4.0},
        {"cr": "29", "targetBudget": 62, "impliedCostPerFeature": 4.0},
        {"cr": "30", "targetBudget": 64, "impliedCostPerFeature": 4.5},
    ]

    FEATURE_TAG_SUGGESTION_SYSTEM_PROMPT = (
        "You assign a budgetCost and tags to D&D 5e monster Features for a tabletop "
        "monster generator tool. Respond with ONLY a single JSON object and nothing "
        "else — no markdown code fences, no preamble, no commentary before or after.\n\n"
        "The JSON object's top-level keys are EXACTLY the Feature ids given under "
        '"Features to tag" below, one per key, no more and no fewer. Each value is an '
        'object of this exact shape: {"budgetCost": <integer, usually 1-6>, '
        '"behaviors": [<string>, ...], "recipeSlots": [<string>, ...], '
        '"roles": [<string>, ...], "creatureTypes": [<string>, ...]}.\n\n'
        "Follow the worked examples given under \"Reference: already-tagged Features\" "
        "closely — most Features get exactly ONE behaviors tag and ONE recipeSlots tag; "
        "roles and creatureTypes are usually empty arrays (meaning universally "
        "compatible) unless the Feature is CLEARLY narrow to a specific role or "
        "creature type. Reuse an existing tag word from the examples whenever one "
        "fits — do not invent a new tag vocabulary word unless truly nothing fits.\n\n"
        "Use the \"Reference: CR budget calibration\" table to gauge budgetCost: if a "
        "Monster context (CR/targetBudget) is given below, the tagged Features' own "
        "costs should sum roughly toward that CR's targetBudget, weighted so a bigger "
        "ability (recharge-limited, legendary, wide area damage, save-or-lose) costs "
        "more of that budget than a minor passive. If no Monster context is given, use "
        "that CR's own implied average cost-per-Feature as a rough anchor instead.\n\n"
        "A Feature already flagged mechanics.scope \"unique\" is still tagged normally "
        "(that flag only affects Crucible's own native generation, not cost/tags)."
    )

    def _load_feature_tag_examples(state: ServerState, limit: int = 60) -> list:
        feature_dir = state.root_dir / "undercroft" / "common" / "data" / "feature"
        examples = []
        if not feature_dir.is_dir():
            return examples
        for path in sorted(feature_dir.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            tags = data.get("tags") or {}
            budget_cost = data.get("budgetCost")
            recipe_slots = tags.get("recipeSlots") or []
            if not budget_cost or not recipe_slots:
                continue
            examples.append(
                {
                    "name": data.get("name", ""),
                    "description": data.get("description", ""),
                    "budgetCost": budget_cost,
                    "behaviors": tags.get("behaviors") or [],
                    "recipeSlots": recipe_slots,
                    "roles": tags.get("roles") or [],
                    "creatureTypes": tags.get("creatureTypes") or [],
                }
            )
            if len(examples) >= limit:
                break
        return examples

    ALLOWED_SUGGESTION_TAG_KEYS = {"behaviors", "recipeSlots", "roles", "creatureTypes"}

    def _build_feature_tag_suggestion_content(state: ServerState, payload: Dict[str, Any]) -> str:
        features = payload.get("features") or []
        if not isinstance(features, list) or not features:
            raise ValueError("features (a non-empty array) is required")
        feature_lines = []
        for entry in features:
            if not isinstance(entry, dict) or not entry.get("id"):
                raise ValueError("each entry in features must be an object with an id")
            feature_lines.append(
                f"- id: {entry['id']}\n"
                f"  name: {entry.get('name', '')}\n"
                f"  mechanicsType: {entry.get('mechanicsType', 'passive')}\n"
                f"  description: {entry.get('description', '')}"
            )

        monster = payload.get("monster") or {}
        monster_context = ""
        if monster.get("challengeRating") or monster.get("targetBudget"):
            monster_context = (
                f"\nMonster context — Name: {monster.get('name', '')}, "
                f"CR: {monster.get('challengeRating', '')}, "
                f"targetBudget: {monster.get('targetBudget', '')}\n"
            )

        examples = _load_feature_tag_examples(state)
        example_lines = "\n".join(
            f"- {ex['name']} (cost {ex['budgetCost']}): behaviors={ex['behaviors']}, "
            f"recipeSlots={ex['recipeSlots']}, roles={ex['roles']}, "
            f"creatureTypes={ex['creatureTypes']} — {ex['description']}"
            for ex in examples
        )
        calibration_lines = "\n".join(
            f"- CR {row['cr']}: targetBudget={row['targetBudget']}, "
            f"impliedCostPerFeature≈{row['impliedCostPerFeature']}"
            for row in CALIBRATION_TABLE
        )

        return (
            "Reference: already-tagged Features\n"
            f"{example_lines}\n\n"
            "Reference: CR budget calibration\n"
            f"{calibration_lines}\n"
            f"{monster_context}\n"
            "Features to tag:\n"
            f"{chr(10).join(feature_lines)}\n"
        )

    def handle_loom_suggest_feature_tags(request: Request) -> Response:
        import urllib.error
        import urllib.request

        api_key = resolve_anthropic_api_key(request.state)
        if not api_key:
            return json_response(
                {
                    "error": (
                        "Missing Anthropic API key — set one in Loom's Auth tab (admin only), or copy "
                        "server/anthropic.local.json.example to server/anthropic.local.json and fill in api_key."
                    )
                },
                status=HTTPStatus.BAD_REQUEST,
            )
        payload = require_json(request)
        try:
            user_content = _build_feature_tag_suggestion_content(request.state, payload)
        except ValueError as exc:
            return json_response({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
        requested_ids = {entry["id"] for entry in payload.get("features") or [] if isinstance(entry, dict) and entry.get("id")}

        request_body = json.dumps(
            {
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 4096,
                "system": FEATURE_TAG_SUGGESTION_SYSTEM_PROMPT,
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
            with urllib.request.urlopen(proxy_request, timeout=60) as upstream:
                response_body = json.loads(upstream.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            return json_response(
                {"error": f"Anthropic API request failed ({exc.code}): {detail}"},
                status=HTTPStatus.BAD_GATEWAY,
            )
        except urllib.error.URLError as exc:
            return json_response({"error": f"Anthropic API request failed ({exc.reason})"}, status=HTTPStatus.BAD_GATEWAY)

        content_blocks = response_body.get("content") or []
        raw_text = "".join(block.get("text", "") for block in content_blocks if isinstance(block, dict)).strip()
        if not raw_text:
            return json_response({"error": "Anthropic API returned an empty response"}, status=HTTPStatus.BAD_GATEWAY)

        # Strict validation — reject and report rather than half-apply, same
        # "never guess" posture the client-side Feature-matching pipeline
        # already holds itself to. A stray markdown code fence around the
        # JSON (models do this despite instructions not to) is stripped
        # first since that's a cosmetic wrapper, not a content problem.
        cleaned_text = raw_text.strip()
        if cleaned_text.startswith("```"):
            cleaned_text = cleaned_text.split("\n", 1)[1] if "\n" in cleaned_text else ""
            if cleaned_text.rstrip().endswith("```"):
                cleaned_text = cleaned_text.rstrip()[:-3]
        try:
            parsed = json.loads(cleaned_text)
        except json.JSONDecodeError:
            return json_response(
                {"error": "Anthropic API did not return valid JSON", "raw": raw_text},
                status=HTTPStatus.BAD_GATEWAY,
            )
        if not isinstance(parsed, dict):
            return json_response({"error": "Expected a JSON object of featureId -> suggestion"}, status=HTTPStatus.BAD_GATEWAY)

        suggestions: Dict[str, Any] = {}
        for feature_id, suggestion in parsed.items():
            if feature_id not in requested_ids or not isinstance(suggestion, dict):
                continue
            budget_cost = suggestion.get("budgetCost")
            if not isinstance(budget_cost, (int, float)) or budget_cost < 0:
                continue
            clean_suggestion: Dict[str, Any] = {"budgetCost": int(round(budget_cost))}
            for key in ALLOWED_SUGGESTION_TAG_KEYS:
                value = suggestion.get(key)
                clean_suggestion[key] = [str(v) for v in value] if isinstance(value, list) else []
            suggestions[feature_id] = clean_suggestion

        missing_ids = sorted(requested_ids - suggestions.keys())
        return json_response({"suggestions": suggestions, "missingIds": missing_ids})

    router.add("POST", r"^/loom/suggest-feature-tags$", handle_loom_suggest_feature_tags)

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
    # server-side and attaches a session cookie resolved via integrations.py's
    # own resolve_ddb_session_cookie (the encrypted deployment_secrets store,
    # managed through Loom's Auth tab) — never from the request, never
    # from a third party. This exists because some D&D Beyond content (e.g.
    # non-free subclasses, or non-SRD monsters via monster-service) is only
    # served in full to a logged-in session; routing that session cookie
    # through a public third-party CORS proxy would hand full account access
    # to that proxy, which this deliberately avoids by keeping the cookie
    # server-side and talking directly to dndbeyond.com. Response body is
    # passed through byte-for-byte regardless of host — works for both
    # scraped HTML pages and monster-service's JSON. Allowed hosts come from
    # server.config.json (server.ddb_proxy_allowed_hosts), not a hardcoded
    # constant — see config.py's ServerOptions.

    def handle_ddb_proxy(request: Request) -> Response:
        import urllib.error
        import urllib.request
        from urllib.parse import parse_qs, urlsplit

        query = parse_qs(urlsplit(request.handler.path).query)
        target = query.get("url", [""])[0]
        if not target:
            return json_response({"error": "Missing url parameter"}, status=HTTPStatus.BAD_REQUEST)
        parsed_target = urlsplit(target)
        allowed_hosts = set(request.state.config.options.ddb_proxy_allowed_hosts)
        if parsed_target.hostname not in allowed_hosts:
            return json_response({"error": "Only dndbeyond.com URLs are allowed"}, status=HTTPStatus.BAD_REQUEST)

        cookie = resolve_ddb_session_cookie(request.state)
        proxy_request = urllib.request.Request(target, headers=build_ddb_request_headers(cookie), method="GET")
        try:
            with urllib.request.urlopen(proxy_request, timeout=15) as upstream:
                body = upstream.read()
                content_type = upstream.headers.get_content_type() or "text/html"
        except urllib.error.HTTPError as exc:
            return json_response({"error": f"D&D Beyond fetch failed ({exc.code})"}, status=HTTPStatus.BAD_GATEWAY)
        except urllib.error.URLError as exc:
            return json_response({"error": f"D&D Beyond fetch failed ({exc.reason})"}, status=HTTPStatus.BAD_GATEWAY)

        # Opportunistic staleness check — every real page fetch already has
        # the HTML in hand, so recording whether it shows a signed-in
        # account (server/ddb_auth_status.py) costs nothing extra here, and
        # is the one check that would have caught a stale session the
        # moment the first real import silently truncated, instead of only
        # ever surfacing via the periodic background check or an explicit
        # Check Now click. Only when a cookie was actually sent (nothing
        # useful to record about "staleness" when there was never a session
        # to go stale) and only for actual HTML responses (this route also
        # proxies monster-service's own JSON, which never has the marker).
        if cookie and content_type == "text/html":
            try:
                record_ddb_auth_check(request.state, body.decode("utf-8", errors="replace"))
            except Exception:
                logging.exception("Failed to record opportunistic D&D Beyond auth check")

        return Response(status=200, body=body, headers={"Content-Type": f"{content_type}; charset=utf-8"})

    router.add("GET", r"^/ddb-proxy$", handle_ddb_proxy)

    # GET /local-file?path=<absolute path>&token=<session token>
    #
    # Lets the Browser widget actually embed a file straight off the GM's
    # own machine (see undercroft/common/js/lib/widgets/browser.js's own
    # header) — routed through this server instead of a bare file:// URL,
    # since browsers categorically refuse to load file: as an iframe/img
    # subresource (a hardcoded scheme restriction, not a CORS check, so no
    # sandbox attribute or client-side workaround fixes it). This is also
    # the ONLY way a local file can ever show up on the second-screen
    # mirror: that window reads this same widget instance's own contentRef
    # directly (dashboard.js's renderScreenView mounts straight from
    # layout.widgets, not through the spotlight/follower network path a
    # genuinely remote player's dashboard uses) — same-origin, same
    # machine, so it can reach this endpoint exactly like the GM's own tab
    # can.
    #
    # Deliberately loopback-only, in addition to the GM-tier check below:
    # this hands back the contents of ANY file this server process can
    # read, given nothing but a path string — an acceptable trust boundary
    # ONLY because "local file" here means the same physical machine the
    # server itself runs on. A request that didn't arrive over the loopback
    # interface can't possibly be that machine, so it's refused outright —
    # this is what keeps "a GM's own quick file access" from silently
    # becoming "any signed-in GM can read arbitrary files off the server
    # host" the moment this server is ever reachable from anywhere else (a
    # LAN, or the VPS this app is expected to eventually move to). A
    # genuinely remote follower who received this same file:// URL in a
    # spotlight's own data (harmless — it's just a path string, not
    # filesystem access) just gets a failed embed here, not a security
    # hole.
    #
    # img/iframe src can't set a custom Authorization header (same
    # limitation _handle_live_stream's own comment documents for
    # EventSource) — token travels as a query param instead, checked
    # through the same session lookup every other endpoint's Bearer token
    # goes through.
    LOCAL_FILE_ALLOWED_CLIENT_IPS = {"127.0.0.1", "::1"}

    def handle_local_file(request: Request) -> Response:
        from urllib.parse import parse_qs, urlsplit

        client_ip = request.handler.client_address[0]
        if client_ip not in LOCAL_FILE_ALLOWED_CLIENT_IPS:
            raise AuthError("Local file access is only available from this machine")
        query = parse_qs(urlsplit(request.handler.path).query)
        token = (query.get("token", [""])[0] or "").strip()
        user = get_user_by_session(request.state, token) if token else None
        if not user:
            raise AuthError("Authentication required")
        if role_rank(user.tier) < role_rank("gm"):
            raise AuthError("GM tier or higher required")
        path = (query.get("path", [""])[0] or "").strip()
        return serve_local_file(path)

    router.add("GET", r"^/local-file$", handle_local_file)

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

    # GET /content/search?q=<term> — the suite-wide header search
    # (common/js/lib/suite-search.js). Anonymous users get an empty result
    # here (nothing server-side is theirs); the client falls back to
    # searching its own local-only saved content in that case instead.
    def handle_content_search(request: Request) -> Response:
        user = request.handler.current_user()
        query = request.handler.path.split("?", 1)
        term = ""
        if len(query) > 1 and query[1]:
            from urllib.parse import parse_qs

            term = parse_qs(query[1]).get("q", [""])[0]
        results = search_content(request.state, user, term) if user else []
        return json_response({"results": results})

    router.add("GET", r"^/content/search$", handle_content_search)

    def ensure_share_permission(
        request: Request,
        content_type: str,
        content_id: str,
        action: str,
    ) -> tuple[User, str]:
        if not content_type or not content_id:
            raise AuthError("Missing fields")
        user = require_user(request)
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
        user, bucket_name = ensure_share_permission(request, content_type, content_id, "manage shares")
        targets = list_shareable_targets(request.state, bucket_name, user)
        return json_response({"targets": targets})

    router.add("GET", r"^/shares/eligible$", handle_share_eligible)

    # GET /shares/{content_type}/{content_id}/eligible
    def handle_share_eligible_path(request: Request) -> Response:
        params = getattr(request, "params")
        content_type = params["bucket"]
        content_id = params["content_id"]
        user, bucket_name = ensure_share_permission(request, content_type, content_id, "manage shares")
        targets = list_shareable_targets(request.state, bucket_name, user)
        return json_response({"targets": targets})

    router.add(
        "GET",
        r"^/shares/(?P<bucket>[^/]+)/(?P<content_id>[^/]+)/eligible$",
        handle_share_eligible_path,
    )

    # Groups management

    def handle_list_groups(request: Request) -> Response:
        user = require_user(request)
        from urllib.parse import parse_qs, urlsplit

        query = parse_qs(urlsplit(request.handler.path).query)
        scope = query.get("scope", ["owned"])[0]
        payload = group_store.list_groups(request.state, user, scope=scope)
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
        system_id = data.get("system_id")
        setting_id = data.get("setting_id")
        template_id = data.get("template_id")
        properties = data.get("properties")
        campaign_day_index = data.get("campaign_day_index")
        campaign_minutes_of_day = data.get("campaign_minutes_of_day")
        group = group_store.update_group(
            request.state,
            user,
            group_id,
            name=name,
            system_id=system_id,
            setting_id=setting_id,
            template_id=template_id,
            properties=properties,
            campaign_day_index=campaign_day_index,
            campaign_minutes_of_day=campaign_minutes_of_day,
        )
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

    # A Group Property VALUE write (e.g. a player adding a party inventory
    # item) — deliberately NOT the generic /content/group/{id} route Loom's
    # own document edits use, since that route's owner-or-edit-share gate
    # can't express "this one player, for this one property the GM marked
    # public" (see group_store.update_group_property_value's own comment).
    def handle_update_group_property(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        key = params["key"]
        data = require_json(request)
        result = group_store.update_group_property_value(request.state, user, group_id, key, data.get("value"))
        return json_response(result)

    router.add("POST", r"^/groups/(?P<group_id>[^/]+)/properties/(?P<key>[^/]+)$", handle_update_group_property)

    # A Group's Property schema+values, read-side counterpart to the write
    # above — same reason it isn't the generic /content/group/{id} route: a
    # mere member has no owner/share access to that document at all (see
    # group_store.get_group_properties's own comment). Filters to public-
    # only properties for a non-owner; the owner/admin gets everything.
    def handle_get_group_properties(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        result = group_store.get_group_properties(request.state, user, group_id)
        return json_response(result)

    router.add("GET", r"^/groups/(?P<group_id>[^/]+)/properties$", handle_get_group_properties)

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
        types_raw = query.get("types", [None])[0]
        entry_types = [t for t in types_raw.split(",") if t] if types_raw else None
        payload = group_store.list_group_log(request.state, group_id, user, limit=limit, entry_types=entry_types)
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
        recipient_ids = data.get("recipientIds") or data.get("recipient_ids")
        in_character = bool(data.get("inCharacter") or data.get("in_character"))
        entry = group_store.create_group_log_entry(
            request.state,
            group_id,
            user,
            entry_type=entry_type,
            message=message,
            payload=payload,
            recipient_ids=recipient_ids,
            in_character=in_character,
        )
        return json_response(entry, status=HTTPStatus.CREATED)

    router.add("POST", r"^/groups/(?P<group_id>[^/]+)/log$", handle_group_log_post)

    # A transient pointer-broadcast (Orrery's click-to-ping map tool) — see
    # ServerState.pending_pings' own comment for why this never touches the
    # database. Delivered to viewers through the existing /live/{groupId}
    # SSE stream's "ping" kind, not a poll+re-fetch like every other kind.
    def handle_group_ping_post(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        data = require_json(request)
        group_store.record_group_ping(request.state, group_id, user, position=data.get("position"))
        return json_response({"ok": True}, status=HTTPStatus.CREATED)

    router.add("POST", r"^/groups/(?P<group_id>[^/]+)/ping$", handle_group_ping_post)

    # Same transient-broadcast shape as the ping route above, but GM-only —
    # "roll this dice notation on your own screen right now" (Cards/Decks
    # plan, Part 2). Delivered via the same /live/{groupId} SSE stream's own
    # "diceRoll" kind, never touching group_logs (the roll's own log entry
    # is posted separately, through the normal /log route, and already
    # carries the authoritative result).
    def handle_group_dice_roll_broadcast_post(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        data = require_json(request)
        group_store.record_dice_roll_broadcast(
            request.state,
            group_id,
            user,
            label=data.get("label") or "",
            total=data.get("total"),
            die_results=data.get("dieResults"),
        )
        return json_response({"ok": True}, status=HTTPStatus.CREATED)

    router.add("POST", r"^/groups/(?P<group_id>[^/]+)/dice-roll-broadcast$", handle_group_dice_roll_broadcast_post)

    # Same transient-broadcast shape as dice-roll-broadcast just above, for a
    # Broadcast-mode card draw (Cards/Decks plan, Part 5 revised — replaces
    # the original spotlight-based design, which wrongly kept a card
    # "active" until explicitly cleared, both replaying on every later page
    # load and cluttering the "what's shown to the table" icon tray with
    # nothing to actually toggle). Delivered via the SSE stream's own
    # "cardDraw" kind, never touching group_logs (the draw's own log entry
    # is posted separately, through the normal /log route).
    def handle_group_card_broadcast_post(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        data = require_json(request)
        group_store.record_card_broadcast(
            request.state,
            group_id,
            user,
            deck_label=data.get("deckLabel") or "",
            back_image=data.get("backImage") or "",
            cards=data.get("cards"),
        )
        return json_response({"ok": True}, status=HTTPStatus.CREATED)

    router.add("POST", r"^/groups/(?P<group_id>[^/]+)/card-broadcast$", handle_group_card_broadcast_post)

    # Same transient-broadcast shape as card-broadcast just above, for
    # replaying a placed, non-looping Shape/Effect element (Shapes & Effects
    # plan, Part 5). Simpler payload than dice/cards — every viewer with the
    # map open already has the full element (preset, color, everything) from
    # the map itself, so this only needs to say *which* element to replay.
    # Delivered via the SSE stream's own "effectTrigger" kind, never
    # touching group_logs.
    def handle_group_effect_broadcast_post(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        group_id = params["group_id"]
        data = require_json(request)
        group_store.record_effect_broadcast(
            request.state,
            group_id,
            user,
            map_id=data.get("mapId") or "",
            element_id=data.get("elementId") or "",
        )
        return json_response({"ok": True}, status=HTTPStatus.CREATED)

    router.add("POST", r"^/groups/(?P<group_id>[^/]+)/effect-broadcast$", handle_group_effect_broadcast_post)

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
        types_raw = query.get("types", [None])[0]
        entry_types = [t for t in types_raw.split(",") if t] if types_raw else None
        payload = group_store.list_group_log(
            request.state,
            None,
            None,
            share_token=token,
            limit=limit,
            entry_types=entry_types,
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
        recipient_ids = data.get("recipientIds") or data.get("recipient_ids")
        in_character = bool(data.get("inCharacter") or data.get("in_character"))
        entry = group_store.create_group_log_entry(
            request.state,
            None,
            user,
            share_token=token,
            entry_type=entry_type,
            message=message,
            payload=payload,
            recipient_ids=recipient_ids,
            in_character=in_character,
        )
        return json_response(entry, status=HTTPStatus.CREATED)

    router.add("POST", r"^/groups/share/(?P<token>[^/]+)/log$", handle_group_share_log_post)

    def handle_group_share_ping_post(request: Request) -> Response:
        user = require_user(request)
        params = getattr(request, "params")
        token = params["token"]
        data = require_json(request)
        group_store.record_group_ping(request.state, None, user, share_token=token, position=data.get("position"))
        return json_response({"ok": True}, status=HTTPStatus.CREATED)

    router.add("POST", r"^/groups/share/(?P<token>[^/]+)/ping$", handle_group_share_ping_post)

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

    # POST /auth/users/create — admin creating a user directly (already
    # active, no verification code), distinct from self-service /auth/register.
    def handle_admin_create_user(request: Request) -> Response:
        admin = request.handler.current_user()
        if not admin or admin.tier != "admin":
            raise AuthError("Admin only")
        data = require_json(request)
        username = data.get("username")
        email = data.get("email")
        password = data.get("password")
        tier = data.get("tier", "free")
        if not username or not email or not password:
            raise AuthError("username, email, and password required")
        result = admin_create_user(request.state, username, email, password, tier)
        return json_response(result, status=HTTPStatus.CREATED)

    router.add("POST", r"^/auth/users/create$", handle_admin_create_user)

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

    # POST /auth/users/email — admin editing ANOTHER user's email directly
    # (distinct from /auth/profile/email, which is self-service and requires
    # the acting user's own password).
    def handle_admin_update_user_email(request: Request) -> Response:
        admin = request.handler.current_user()
        if not admin or admin.tier != "admin":
            raise AuthError("Admin only")
        data = require_json(request)
        username = data.get("username")
        email = data.get("email")
        if not username or not email:
            raise AuthError("username and email required")
        result = admin_update_user_email(request.state, username, email)
        return json_response(result)

    router.add("POST", r"^/auth/users/email$", handle_admin_update_user_email)

    # POST /auth/users/status — admin activating/deactivating a user.
    def handle_admin_set_user_status(request: Request) -> Response:
        admin = request.handler.current_user()
        if not admin or admin.tier != "admin":
            raise AuthError("Admin only")
        data = require_json(request)
        username = data.get("username")
        is_active = data.get("is_active")
        if not username or is_active is None:
            raise AuthError("username and is_active required")
        result = admin_set_user_status(request.state, username, bool(is_active))
        return json_response(result)

    router.add("POST", r"^/auth/users/status$", handle_admin_set_user_status)

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

    # POST /auth/profile/upgrade — self-service tier change (distinct from
    # /auth/upgrade, which is admin-only and targets another user by
    # username). "admin" is rejected server-side in upgrade_own_tier — it can
    # only ever be granted through /auth/upgrade by an existing admin. No
    # payment integration exists yet, so this applies immediately for free;
    # a future payment-token check would slot in before upgrade_own_tier is
    # called, without changing this route's shape.
    def handle_upgrade_own_tier(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        data = require_json(request)
        tier = data.get("tier")
        if not tier:
            raise AuthError("tier required")
        result = upgrade_own_tier(request.state, user, tier)
        return json_response(result)

    router.add("POST", r"^/auth/profile/upgrade$", handle_upgrade_own_tier)

    # GET /auth/profile/settings — a small per-user JSON blob (today: just
    # the Dashboard's widget layout) stored directly on the users row (see
    # auth.py's _migrate_users_table_for_settings), not a new Library kind —
    # this is account-level preference, not shareable/owned content.
    def handle_get_settings(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        return json_response(get_user_settings(request.state, user))

    router.add("GET", r"^/auth/profile/settings$", handle_get_settings)

    # POST /auth/profile/settings — merge-patch: only the keys provided are
    # updated, so one feature's write (e.g. the Dashboard's layout) can't
    # clobber another feature's settings stored in the same blob.
    def handle_update_settings(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        data = require_json(request)
        result = update_user_settings(request.state, user, data)
        return json_response(result)

    router.add("POST", r"^/auth/profile/settings$", handle_update_settings)

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

    # POST /content/{bucket}/{id}/rename — admin-only (rename_item's own
    # gate), so nothing extra to enforce here beyond authentication; Loom's
    # own Rename action calls this twice — once with dryRun:true to build a
    # confirmation prompt showing every OTHER record that will be touched,
    # once with dryRun:false (after the GM confirms) to actually perform it.
    def handle_rename_content(request: Request) -> Response:
        params = getattr(request, "params")
        bucket = normalize_kind(params["bucket"])
        id_ = params["id"]
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        body = require_json(request)
        new_id = (body.get("newId") or "").strip()
        dry_run = bool(body.get("dryRun"))
        result = rename_item(request.state, bucket, id_, new_id, user, dry_run=dry_run)
        return json_response(result)

    router.add("POST", r"^/content/(?P<bucket>[^/]+)/(?P<id>[^/]+)/rename$", handle_rename_content)

    # POST /shares
    def handle_share(request: Request) -> Response:
        data = require_json(request)
        content_type = data.get("content_type")
        content_id = data.get("content_id")
        username = data.get("username")
        group_id = data.get("group_id")
        permissions = data.get("permissions", "view")
        if not username and not group_id:
            raise AuthError("Missing fields")
        if permissions not in {"view", "edit"}:
            raise AuthError("Invalid permissions")
        user, bucket_name = ensure_share_permission(request, content_type, content_id, "share content")
        if group_id:
            result = share_with_group(request.state, bucket_name, content_id, group_id, permissions, user)
        else:
            result = share_with_user(request.state, bucket_name, content_id, username, permissions)
        return json_response(result)

    router.add("POST", r"^/shares$", handle_share)

    # POST /shares/revoke
    def handle_revoke_share(request: Request) -> Response:
        data = require_json(request)
        content_type = data.get("content_type")
        content_id = data.get("content_id")
        username = data.get("username")
        group_id = data.get("group_id")
        if not username and not group_id:
            raise AuthError("Missing fields")
        _, bucket_name = ensure_share_permission(request, content_type, content_id, "revoke shares")
        if group_id:
            revoke_group_share(request.state, bucket_name, content_id, group_id)
        else:
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
