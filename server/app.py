from __future__ import annotations

import http.server
import logging
import threading
from http import HTTPStatus
from pathlib import Path
from typing import Any, Dict, Optional

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

    def bucket_from_content_type(content_type: str) -> str:
        mapping = {"character": "characters", "template": "templates", "system": "systems", "schema": "systems"}
        if content_type not in mapping:
            raise AuthError("Invalid content type")
        return mapping[content_type]

    # GET /healthz
    def handle_healthz(request: Request) -> Response:
        return json_response({"ok": True})

    router.add("GET", r"^/healthz$", handle_healthz)

    # GET /list/{bucket}
    def handle_list(request: Request) -> Response:
        params = getattr(request, "params")
        bucket = params["bucket"]
        user = request.handler.current_user()
        payload = list_bucket(request.state, bucket, user)
        return json_response(payload)

    router.add("GET", r"^/list/(?P<bucket>[^/]+)$", handle_list)

    # GET /content/{bucket}/{id}
    def handle_get_content(request: Request) -> Response:
        params = getattr(request, "params")
        bucket = params["bucket"]
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

    # GET /content/owned
    def handle_owned_content(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        query = request.handler.path.split("?", 1)
        target = user
        if len(query) > 1 and query[1]:
            from urllib.parse import parse_qs

            params = parse_qs(query[1])
            username = params.get("username", [""])[0]
            if username and username != user.username:
                if user.tier != "admin":
                    raise AuthError("Admin only")
                target_user = get_user_by_username(request.state, username)
                if not target_user:
                    raise AuthError("User not found")
                target = target_user
        payload = list_owned_content(request.state, target)
        return json_response(payload)

    router.add("GET", r"^/content/owned$", handle_owned_content)

    # GET /shares/{content_type}/{content_id}
    def handle_list_shares(request: Request) -> Response:
        params = getattr(request, "params")
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        bucket = params["bucket"]
        content_id = params["content_id"]
        bucket_name = bucket_from_content_type(bucket)
        if user.tier != "admin" and not is_owner(request.state, bucket_name, f"{content_id}.json", user):
            raise AuthError("Only owner or admin can view shares")
        shares = list_shares(request.state, bucket, content_id, user)
        link = get_share_link(request.state, bucket, content_id)
        return json_response({"shares": shares, "link": link})

    router.add("GET", r"^/shares/(?P<bucket>[^/]+)/(?P<content_id>[^/]+)$", handle_list_shares)

    # GET /shares/eligible
    def handle_share_eligible(request: Request) -> Response:
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        query = {}
        if "?" in request.handler.path:
            from urllib.parse import parse_qs

            query_string = request.handler.path.split("?", 1)[1]
            query = parse_qs(query_string)
        content_type = query.get("content_type", [""])[0]
        content_id = query.get("content_id", [""])[0]
        if not content_type or not content_id:
            raise AuthError("Missing fields")
        bucket_name = bucket_from_content_type(content_type)
        if user.tier != "admin" and not is_owner(request.state, bucket_name, f"{content_id}.json", user):
            raise AuthError("Only owner or admin can manage shares")
        users = list_shareable_users(request.state, content_type)
        return json_response({"users": users})

    router.add("GET", r"^/shares/eligible$", handle_share_eligible)

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
        bucket = params["bucket"]
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
        bucket = params["bucket"]
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
        bucket = params["bucket"]
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
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        content_type = data.get("content_type")
        content_id = data.get("content_id")
        username = data.get("username")
        permissions = data.get("permissions", "view")
        if not content_type or not content_id or not username:
            raise AuthError("Missing fields")
        bucket_name = bucket_from_content_type(content_type)
        if permissions not in {"view", "edit"}:
            raise AuthError("Invalid permissions")
        if user.tier != "admin" and not is_owner(request.state, bucket_name, f"{content_id}.json", user):
            raise AuthError("Only owner or admin can share")
        result = share_with_user(request.state, content_type, content_id, username, permissions)
        return json_response(result)

    router.add("POST", r"^/shares$", handle_share)

    # POST /shares/revoke
    def handle_revoke_share(request: Request) -> Response:
        data = require_json(request)
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        content_type = data.get("content_type")
        content_id = data.get("content_id")
        username = data.get("username")
        if not content_type or not content_id or not username:
            raise AuthError("Missing fields")
        bucket_name = bucket_from_content_type(content_type)
        if user.tier != "admin" and not is_owner(request.state, bucket_name, f"{content_id}.json", user):
            raise AuthError("Only owner or admin can revoke shares")
        revoke_share(request.state, content_type, content_id, username)
        return json_response({"ok": True})

    router.add("POST", r"^/shares/revoke$", handle_revoke_share)

    # POST /shares/link
    def handle_share_link(request: Request) -> Response:
        data = require_json(request)
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        content_type = data.get("content_type")
        content_id = data.get("content_id")
        permissions = data.get("permissions", "view")
        if not content_type or not content_id:
            raise AuthError("Missing fields")
        bucket_name = bucket_from_content_type(content_type)
        if user.tier != "admin" and not is_owner(request.state, bucket_name, f"{content_id}.json", user):
            raise AuthError("Only owner or admin can create links")
        link = create_share_link(request.state, content_type, content_id, permissions)
        return json_response({"link": link})

    router.add("POST", r"^/shares/link$", handle_share_link)

    # POST /shares/link/revoke
    def handle_share_link_revoke(request: Request) -> Response:
        data = require_json(request)
        user = request.handler.current_user()
        if not user:
            raise AuthError("Authentication required")
        content_type = data.get("content_type")
        content_id = data.get("content_id")
        if not content_type or not content_id:
            raise AuthError("Missing fields")
        bucket_name = bucket_from_content_type(content_type)
        if user.tier != "admin" and not is_owner(request.state, bucket_name, f"{content_id}.json", user):
            raise AuthError("Only owner or admin can revoke links")
        revoke_share_link(request.state, content_type, content_id)
        return json_response({"ok": True})

    router.add("POST", r"^/shares/link/revoke$", handle_share_link_revoke)

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
    init_storage_db(state.db)
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
