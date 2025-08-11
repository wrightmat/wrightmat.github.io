#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Basic JSON server with:
- Bucket mappings to folders
- Auth (register/login/logout/refresh) using PBKDF2-HMAC (stdlib only)
- Roles/tiers (free, player, master, creator, admin) with RBAC gates
- CRUD endpoints for JSON content with ACL (owner/public/shares)
- Shares API (user-to-user view/edit)
- Public toggle API
- Importer endpoint that applies schema-embedded mappings
- CORS + OPTIONS
- SQLite metadata (users/sessions/content/shares)

Run: python3 web-server.py
"""

import http.server
import socketserver
import urllib.parse
import os
import json
import re
import sqlite3
import time
import contextlib
import uuid
import platform
import secrets
import hashlib
import hmac
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

# ---------- Config ----------
PORT = 8000

MOUNTS: Dict[str, str] = {
    "characters": "sheets/data/characters",
    "templates": "sheets/data/templates",
    "systems": "sheets/data/systems",
    "codex_data": "codex/data",
    "codex_templates": "codex/templates",
}
DB_PATH = "sheet/data/database.sqlite"
SCHEMA_ROOT = "sheets/data"

for p in MOUNTS.values():
    os.makedirs(p, exist_ok=True)

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

SESSION_TTL_DAYS = 7
CORS_ORIGIN = "*"  # keep permissive in dev, tighten later

# ---------- Cross-platform file lock (best-effort) ----------
if platform.system() != "Windows":
    import fcntl

    @contextlib.contextmanager
    def file_lock(path: str, mode: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if ("w" in mode or "a" in mode or "+" in mode) and not os.path.exists(path):
            with open(path, "w", encoding="utf-8") as _seed:
                _seed.write("{}")
        f = open(path, mode, encoding="utf-8")
        try:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            yield f
        finally:
            try:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            finally:
                f.close()
else:
    # Windows fallback without advisory locking
    @contextlib.contextmanager
    def file_lock(path: str, mode: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if ("w" in mode or "a" in mode or "+" in mode) and not os.path.exists(path):
            with open(path, "w", encoding="utf-8") as _seed:
                _seed.write("{}")
        f = open(path, mode, encoding="utf-8")
        try:
            yield f
        finally:
            f.close()

def bucket_path(bucket: str, id_: str) -> str:
    base = MOUNTS.get(bucket)
    if not base:
        raise ValueError(f"Unknown bucket '{bucket}'. Valid: {list(MOUNTS.keys())}")
    filename = id_ if id_.endswith(".json") else f"{id_}.json"
    return os.path.join(base, filename)

def read_json(path: str) -> Any:
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    with file_lock(path, "r") as f:
        return json.load(f)

def write_json(path: str, data: Any):
    tmp = f"{path}.tmp"
    with file_lock(tmp, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    if os.path.exists(path):
        os.replace(tmp, path)
    else:
        os.rename(tmp, path)

def delete_path(path: str):
    if os.path.exists(path):
        os.remove(path)

# ---------- Password hashing (stdlib PBKDF2-HMAC) ----------
PBKDF2_ITERATIONS = 240_000
PBKDF2_ALGO = "sha256"
SALT_BYTES = 16

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    dk = hashlib.pbkdf2_hmac(PBKDF2_ALGO, password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ALGO}${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"

def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, algo, iters_s, salt_hex, hash_hex = stored.split("$")
        if scheme != "pbkdf2": return False
        iters = int(iters_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        dk = hashlib.pbkdf2_hmac(algo, password.encode("utf-8"), salt, iters)
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False

# ---------- DB ----------
conn = sqlite3.connect(DB_PATH, check_same_thread=False)
conn.row_factory = sqlite3.Row

def db_exec(sql: str, params: tuple = ()):
    cur = conn.execute(sql, params)
    conn.commit()
    return cur

def init_db():
    db_exec("""
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      tier TEXT DEFAULT 'free',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME,
      is_active INTEGER DEFAULT 1
    )""")
    db_exec("""
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_token TEXT UNIQUE NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )""")
    db_exec("""
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      owner_id INTEGER,
      name TEXT,
      system TEXT,
      template TEXT,
      filename TEXT,
      is_public INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
    )""")
    db_exec("""
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      owner_id INTEGER,
      title TEXT,
      schema TEXT,
      filename TEXT,
      is_public INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
    )""")
    db_exec("""
    CREATE TABLE IF NOT EXISTS systems (
      id TEXT PRIMARY KEY,
      owner_id INTEGER,
      title TEXT,
      "index" TEXT,
      filename TEXT,
      is_public INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
    )""")
    db_exec("""
    CREATE TABLE IF NOT EXISTS shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_type TEXT NOT NULL,
      content_id TEXT NOT NULL,
      shared_with_user_id INTEGER NOT NULL,
      permissions TEXT DEFAULT 'view',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(content_type, content_id, shared_with_user_id),
      FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE
    )""")
    db_exec("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token)")
    db_exec("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
    db_exec("CREATE INDEX IF NOT EXISTS idx_shares_content ON shares(content_type, content_id)")
    db_exec("CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(shared_with_user_id)")
init_db()

# ---------- RBAC ----------
ROLE_ORDER = ["free","player","master","creator","admin"]
def role_rank(tier: str) -> int:
    return ROLE_ORDER.index(tier) if tier in ROLE_ORDER else 0

def now() -> datetime:
    return datetime.now()

def make_session(user_id: int, ip: str, ua: str) -> str:
    token = secrets.token_hex(24)
    expires_at = now() + timedelta(days=SESSION_TTL_DAYS)
    db_exec("""INSERT INTO sessions (user_id, session_token, ip_address, user_agent, expires_at)
               VALUES (?,?,?,?,?)""", (user_id, token, ip or "", ua or "", expires_at))
    return token

def get_user_from_token(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    row = db_exec("""
      SELECT u.* FROM users u
      JOIN sessions s ON s.user_id = u.id
      WHERE s.session_token = ? AND s.expires_at > CURRENT_TIMESTAMP AND s.is_active = 1
    """, (token,)).fetchone()
    if not row:
        return None
    db_exec("UPDATE sessions SET last_accessed_at=CURRENT_TIMESTAMP, expires_at=? WHERE session_token=?",
            (now() + timedelta(days=SESSION_TTL_DAYS), token))
    return dict(row)

def require_role(user: dict, min_role: str):
    if not user:
        raise PermissionError("Unauthorized")
    if role_rank(user.get("tier","free")) < role_rank(min_role):
        raise PermissionError("Insufficient role")

# ---------- Importer helpers (tiny JSONPath subset) ----------
JSONPATH_SEG = re.compile(r"\$\.(.+)")

def jsonpath_extract(doc: Any, path: str):
    """
    Supports:
      $.a.b.c
      $.arr[*].name
    """
    m = JSONPATH_SEG.match(path.strip())
    if not m: return None
    segs = m.group(1).split(".")
    def walk(node, i):
        if i >= len(segs): return node
        seg = segs[i]
        if seg.endswith("[*]"):
            key = seg[:-3]
            arr = (node or {}).get(key, [])
            out = []
            if isinstance(arr, list):
                for item in arr:
                    out.append(walk(item, i+1))
            flat = []
            for r in out:
                if isinstance(r, list): flat.extend(r)
                else: flat.append(r)
            return flat
        else:
            if isinstance(node, dict):
                return walk(node.get(seg), i+1)
            return None
    return walk(doc, 0)

def transform_value(val, name: Optional[str]):
    if not name: return val
    try:
        if name == "int": return int(val)
        if name == "float": return float(val)
        if name == "lower": return str(val).lower()
        if name == "upper": return str(val).upper()
        if name == "asList": return val if isinstance(val, list) else ([val] if val is not None else [])
    except Exception:
        return val
    return val

# ---------- HTTP Handler ----------
class JSONHandler(http.server.SimpleHTTPRequestHandler):
    server_version = "TTRPGSheetServer/0.1"

    # --- Utilities ---
    def json_body(self) -> Any:
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length == 0: return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None

    def auth_user(self) -> Optional[dict]:
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
            return get_user_from_token(token)
        return None

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def respond(self, status: int, obj: Any):
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(obj).encode("utf-8"))

    def not_found(self, msg="Not found"):
        self.respond(404, {"error": msg})

    def bad_request(self, msg="Bad request"):
        self.respond(400, {"error": msg})

    def forbidden(self, msg="Forbidden"):
        self.respond(403, {"error": msg})

    def unauthorized(self, msg="Unauthorized"):
        self.respond(401, {"error": msg})

    # --- Routing helpers ---
    def parse_path(self):
        parsed = urllib.parse.urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]
        qs = urllib.parse.parse_qs(parsed.query)
        return parts, qs

    def do_OPTIONS(self):
        self.send_response(200)
        self.cors()
        self.end_headers()

    # --- GET ---
    def do_GET(self):
        user = self.auth_user()
        parts, qs = self.parse_path()

        # /healthz
        if parts == ["healthz"]:
            return self.respond(200, {"ok": True, "time": datetime.utcnow().isoformat()})

        # /debug/database (admin only)
        if parts == ["debug", "database"]:
            try:
                if not user or user.get("tier") != "admin":
                    return self.forbidden("Admin only")
                tables = ["users","sessions","characters","templates","systems","shares"]
                out = {t: [dict(r) for r in db_exec(f"SELECT * FROM {t}")] for t in tables}
                return self.respond(200, out)
            except Exception as e:
                return self.respond(500, {"error": str(e)})

        # /list/{bucket}
        if len(parts) == 2 and parts[0] == "list":
            bucket = parts[1]
            if bucket not in MOUNTS:
                return self.bad_request(f"Unknown bucket '{bucket}'")
            meta_table = bucket  # matches table names for core buckets
            if bucket in ("characters","templates","systems"):
                if user:
                    # owned
                    owned = [dict(r) for r in db_exec(f"SELECT * FROM {meta_table} WHERE owner_id=? ORDER BY modified_at DESC", (user["id"],))]
                    # shared
                    shared = [dict(r) for r in db_exec(f"""
                        SELECT m.*, s.permissions FROM {meta_table} m
                        JOIN shares s ON s.content_id = m.id AND s.content_type = ?
                        WHERE s.shared_with_user_id = ?
                        ORDER BY m.modified_at DESC
                    """, (bucket[:-1], user["id"]))]
                    # public (not owned)
                    public = [dict(r) for r in db_exec(f"SELECT * FROM {meta_table} WHERE is_public=1 AND (owner_id IS NULL OR owner_id != ?) ORDER BY modified_at DESC", (user["id"],))]
                    return self.respond(200, {"owned": owned, "shared": shared, "public": public})
                else:
                    public = [dict(r) for r in db_exec(f"SELECT * FROM {meta_table} WHERE is_public=1 ORDER BY modified_at DESC")]
                    return self.respond(200, {"public": public})
            # non-meta buckets: list files
            files = [f[:-5] for f in os.listdir(MOUNTS[bucket]) if f.endswith(".json")]
            return self.respond(200, {"files": sorted(files)})

        # /content/{bucket}/{id}  (read)
        if len(parts) == 3 and parts[0] == "content":
            bucket, id_ = parts[1], parts[2]
            if bucket not in MOUNTS:
                return self.bad_request(f"Unknown bucket '{bucket}'")
            try:
                # ACL check for core buckets
                if bucket in ("characters","templates","systems"):
                    if not self.can_read(bucket, id_, user):
                        return self.unauthorized("Login or share required")
                path = bucket_path(bucket, id_)
                data = read_json(path)
                if bucket == "characters":
                    db_exec("UPDATE characters SET last_accessed_at=CURRENT_TIMESTAMP WHERE id=?", (id_.replace(".json",""),))
                return self.respond(200, data)
            except FileNotFoundError:
                return self.not_found()
            except PermissionError as e:
                return self.forbidden(str(e))
            except Exception as e:
                return self.respond(500, {"error": str(e)})

        # /shares/{content_type}/{content_id} (list shares)
        if len(parts) == 3 and parts[0] == "shares":
            if not user: return self.unauthorized()
            ctype, cid = parts[1], parts[2]
            if ctype not in ("character","template","schema"):
                return self.bad_request("Invalid content_type")
            if not self.is_owner_or_admin(ctype, cid, user):
                return self.forbidden("Only owner or admin can view shares")
            rows = [dict(r) for r in db_exec("SELECT * FROM shares WHERE content_type=? AND content_id=?", (ctype, cid))]
            return self.respond(200, {"shares": rows})

        # Fallback to static file serving
        return super().do_GET()

    # --- POST (mutating endpoints) ---
    def do_POST(self):
        user = self.auth_user()
        parts, qs = self.parse_path()
        body = self.json_body() or {}

        # ---------- Auth ----------
        if parts == ["auth", "register"]:
            try:
                email = body.get("email","").strip()
                username = body.get("username","").strip()
                password = body.get("password","")
                if not email or not username or not password:
                    return self.bad_request("email, username, password required")
                pw_hash = hash_password(password)
                try:
                    cur = db_exec("INSERT INTO users (email, username, password_hash) VALUES (?,?,?)", (email, username, pw_hash))
                except sqlite3.IntegrityError:
                    return self.respond(409, {"error":"Email or username already exists"})
                user_id = cur.lastrowid
                token = make_session(user_id, self.client_address[0], self.headers.get("User-Agent",""))
                row = db_exec("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                return self.respond(200, {"token": token, "user": dict(row)})
            except Exception as e:
                return self.respond(500, {"error": str(e)})

        if parts == ["auth", "login"]:
            try:
                uoe = body.get("username_or_email","")
                password = body.get("password","")
                row = db_exec("SELECT * FROM users WHERE username=? OR email=? LIMIT 1", (uoe, uoe)).fetchone()
                if not row or not verify_password(password, row["password_hash"]):
                    return self.unauthorized("Invalid credentials")
                token = make_session(row["id"], self.client_address[0], self.headers.get("User-Agent",""))
                db_exec("UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?", (row["id"],))
                return self.respond(200, {"token": token, "user": dict(row)})
            except Exception as e:
                return self.respond(500, {"error": str(e)})

        if parts == ["auth", "logout"]:
            if not user: return self.unauthorized()
            auth = self.headers.get("Authorization", "")
            token = auth[7:] if auth.startswith("Bearer ") else None
            if token:
                db_exec("UPDATE sessions SET is_active=0 WHERE session_token=?", (token,))
            return self.respond(200, {"ok": True})

        if parts == ["auth", "refresh"]:
            if not user: return self.unauthorized()
            # Kill old, create new
            auth = self.headers.get("Authorization", "")
            token_old = auth[7:] if auth.startswith("Bearer ") else None
            if token_old:
                db_exec("UPDATE sessions SET is_active=0 WHERE session_token=?", (token_old,))
            token = make_session(user["id"], self.client_address[0], self.headers.get("User-Agent",""))
            row = db_exec("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
            return self.respond(200, {"token": token, "user": dict(row)})

        # ---------- Content write/delete ----------
        # POST /content/{bucket}/{id}   (write/replace)
        if len(parts) == 3 and parts[0] == "content":
            bucket, id_ = parts[1], parts[2]
            if bucket not in MOUNTS:
                return self.bad_request(f"Unknown bucket '{bucket}'")
            if not user:
                return self.unauthorized()

            # Role gates (create/update)
            try:
                if bucket == "templates" and role_rank(user["tier"]) < role_rank("master"):
                    return self.forbidden("Master or higher required to write templates")
                if bucket == "systems" and role_rank(user["tier"]) < role_rank("creator"):
                    return self.forbidden("Creator or higher required to write systems")
                # ACL (if exists and not owner/shared-edit)
                if not self.can_write(bucket, id_, user):
                    # can_write returns True for new items or owner/shared-edit
                    return self.forbidden("Edit not permitted")
                path = bucket_path(bucket, id_)
                write_json(path, body)

                # Save metadata
                if bucket in ("characters","templates","systems"):
                    self.save_meta(bucket, id_, body, user["id"])

                return self.respond(200, {"ok": True, "bucket": bucket, "id": id_})
            except Exception as e:
                return self.respond(500, {"error": str(e)})

        # POST /content/{bucket}/{id}/delete
        if len(parts) == 4 and parts[0] == "content" and parts[3] == "delete":
            bucket, id_ = parts[1], parts[2]
            if not user: return self.unauthorized()
            try:
                if not self.can_write(bucket, id_, user):
                    return self.forbidden("Delete not permitted")
                delete_path(bucket_path(bucket, id_))
                base_id = id_.replace(".json","")
                if bucket == "characters":
                    db_exec("DELETE FROM characters WHERE id=?", (base_id,))
                elif bucket == "templates":
                    db_exec("DELETE FROM templates WHERE id=?", (base_id,))
                elif bucket == "systems":
                    db_exec("DELETE FROM systems WHERE id=?", (base_id,))
                return self.respond(200, {"ok": True})
            except Exception as e:
                return self.respond(500, {"error": str(e)})

        # POST /content/{bucket}/{id}/public?public=true|false
        if len(parts) == 4 and parts[0] == "content" and parts[3] == "public":
            if not user: return self.unauthorized()
            bucket, id_ = parts[1], parts[2]
            if bucket not in ("characters","templates","systems"):
                return self.bad_request("Public toggle only for core buckets")
            if not self.can_write(bucket, id_, user):
                return self.forbidden("Only owner/shared-edit can change public flag")
            public_flag = True
            if "public" in self.path:
                q = urllib.parse.urlparse(self.path).query
                qs = urllib.parse.parse_qs(q)
                public_flag = (qs.get("public", ["true"])[0].lower() == "true")
            table = bucket
            db_exec(f"UPDATE {table} SET is_public=? WHERE id=?", (1 if public_flag else 0, id_.replace(".json","")))
            return self.respond(200, {"ok": True, "public": public_flag})

        # ---------- Shares ----------
        # POST /shares   {content_type, content_id, shared_with_user_id, permissions}
        if parts == ["shares"]:
            if not user: return self.unauthorized()
            try:
                ctype = body.get("content_type")
                cid = body.get("content_id")
                target_uid = int(body.get("shared_with_user_id"))
                perm = body.get("permissions","view")
                if ctype not in ("character","template","schema") or perm not in ("view","edit"):
                    return self.bad_request("Invalid content_type or permissions")

                if not self.is_owner_or_admin(ctype, cid, user):
                    return self.forbidden("Only owner/admin can share")

                db_exec("""INSERT OR REPLACE INTO shares (content_type, content_id, shared_with_user_id, permissions)
                           VALUES (?,?,?,?)""", (ctype, cid, target_uid, perm))
                return self.respond(200, {"ok": True})
            except Exception as e:
                return self.respond(500, {"error": str(e)})

        # ---------- Importer ----------
        # POST /import/{system_id}/{importer_id}   { payload, dryRun? }
        if len(parts) == 3 and parts[0] == "import":
            if not user: return self.unauthorized()
            system_id, importer_id = parts[1], parts[2]
            try:
                sys_path = bucket_path("systems", system_id)
                system = read_json(sys_path)
                importers = system.get("importers", [])
                imp = next((i for i in importers if i.get("id")==importer_id), None)
                if not imp:
                    return self.not_found("Importer not found in system schema")

                payload = body.get("payload", {})
                # detect (optional)
                detect = imp.get("detect")
                if detect:
                    if jsonpath_extract(payload, detect) is None:
                        return self.bad_request("Importer detect failed")

                mappings = imp.get("map", [])
                result_patch: Dict[str, Any] = {}
                diffs: List[Dict[str,Any]] = []

                for m in mappings:
                    src = m.get("from")
                    dst = m.get("to")  # '@dot.path'
                    tf = m.get("transform")
                    val = jsonpath_extract(payload, src)
                    val = transform_value(val, tf)
                    if not isinstance(dst, str) or not dst.startswith("@"):
                        continue
                    # Build nested dict under result_patch for @path
                    path = dst[1:].split(".")
                    node = result_patch
                    for k in path[:-1]:
                        if k not in node or not isinstance(node[k], dict):
                            node[k] = {}
                        node = node[k]
                    node[path[-1]] = val
                    diffs.append({"from": src, "to": dst, "value": val})

                return self.respond(200, {"dryRun": bool(body.get("dryRun", True)), "patch": result_patch, "diff": diffs})
            except FileNotFoundError:
                return self.not_found("System schema not found")
            except Exception as e:
                return self.respond(500, {"error": str(e)})

        # ---------- Legacy compatibility (optional) ----------
        # keep your old /write?dir=...&file=... behavior if needed
        if parts and parts[0] in ("write","replace","remove_key","delete"):
            return self.handle_legacy(parts, qs, body, user)

        # Unknown
        return self.not_found()

    # --- Legacy compat (optional; can remove if not needed) ---
    def handle_legacy(self, parts, qs, body, user):
        action = parts[0]
        directory = qs.get("dir", ["codex_data"])[0]
        file_name = qs.get("file", [None])[0]
        key = qs.get("key", [None])[0]

        if directory not in MOUNTS:
            return self.bad_request(f"Invalid directory '{directory}'. Valid: {list(MOUNTS.keys())}")
        if not file_name or not file_name.endswith(".json"):
            return self.bad_request("Missing or invalid 'file' parameter")

        base_dir = MOUNTS[directory]
        file_path = os.path.join(base_dir, file_name)

        try:
            if action == "write":
                existing = {}
                if os.path.exists(file_path):
                    with file_lock(file_path, 'r') as f:
                        existing = json.load(f)
                if isinstance(existing, list) and isinstance(body, list):
                    existing.extend(body)
                elif isinstance(existing, dict) and isinstance(body, dict):
                    existing.update(body)
                else:
                    existing = body
                with file_lock(file_path, 'w') as f:
                    json.dump(existing, f, indent=2)
                return self.respond(200, {"status": "File created or updated", "path": file_path})

            if action == "replace":
                if key is None:
                    return self.bad_request("Missing 'key' for replace")
                with file_lock(file_path, 'r+') as f:
                    obj = json.load(f)
                    if not isinstance(obj, dict):
                        return self.bad_request("Replace supports dict JSON only")
                    obj[key] = body
                    f.seek(0); f.truncate()
                    json.dump(obj, f, indent=2)
                return self.respond(200, {"status": f"Replaced key '{key}'", "path": file_path})

            if action == "remove_key":
                if key is None:
                    return self.bad_request("Missing 'key' for remove_key")
                with file_lock(file_path, 'r+') as f:
                    obj = json.load(f)
                    if not isinstance(obj, dict):
                        return self.bad_request("Cannot remove key from non-dict JSON")
                    if key in obj:
                        del obj[key]
                        f.seek(0); f.truncate()
                        json.dump(obj, f, indent=2)
                        return self.respond(200, {"status": f"Key '{key}' removed", "path": file_path})
                    return self.not_found(f"Key '{key}' not found")

            if action == "delete":
                if os.path.exists(file_path):
                    os.remove(file_path)
                    return self.respond(200, {"status": f"File {file_name} deleted"})
                return self.not_found("File not found")

            return self.not_found(f"Unknown legacy action: {action}")
        except Exception as e:
            return self.respond(500, {"error": str(e)})

    # --- ACL / Meta helpers ---
    def is_owner_or_admin(self, ctype: str, cid: str, user: dict) -> bool:
        table = {"character": "characters", "template": "templates", "system": "systems"}[ctype]
        row = db_exec(f"SELECT owner_id FROM {table} WHERE id=?", (cid,)).fetchone()
        if not row: return False
        return (row["owner_id"] == user["id"]) or (user.get("tier") == "admin")

    def can_read(self, bucket: str, id_: str, user: Optional[dict]) -> bool:
        base_id = id_.replace(".json","")
        row = db_exec(f"SELECT owner_id, is_public FROM {bucket} WHERE id=?", (base_id,)).fetchone()
        if not row: return True  # no metadata → assume allowed
        if row["is_public"] == 1: return True
        if not user: return False
        if row["owner_id"] == user["id"]: return True
        shared = db_exec("""
            SELECT 1 FROM shares WHERE content_type=? AND content_id=? AND shared_with_user_id=?
        """, (bucket[:-1], base_id, user["id"])).fetchone()
        return bool(shared)

    def can_write(self, bucket: str, id_: str, user: dict) -> bool:
        base_id = id_.replace(".json","")
        row = db_exec(f"SELECT owner_id FROM {bucket} WHERE id=?", (base_id,)).fetchone()
        if not row:
            # creating new
            if bucket == "systems" and role_rank(user["tier"]) < role_rank("creator"):
                return False
            if bucket == "templates" and role_rank(user["tier"]) < role_rank("master"):
                return False
            # characters allowed for free+
            return True
        if row["owner_id"] == user["id"]:
            return True
        shared = db_exec("""
            SELECT permissions FROM shares WHERE content_type=? AND content_id=? AND shared_with_user_id=?
        """, (bucket[:-1], base_id, user["id"])).fetchone()
        return bool(shared and shared["permissions"] == "edit")

    def save_meta(self, bucket: str, id_: str, data: dict, owner_id: int):
        now_ts = datetime.utcnow()
        fname = f"{id_}.json" if not id_.endswith(".json") else id_
        base_id = id_.replace(".json","")
        if bucket == "characters":
            char_name = "Unnamed"
            if isinstance(data.get("data"), dict):
                char_name = data["data"].get("name", "Unnamed")
            else:
                char_name = data.get("name", "Unnamed")
            # Keep system/template if already set (or accept provided)
            existing = db_exec("SELECT system, template FROM characters WHERE id=?", (base_id,)).fetchone()
            system = data.get("system") or (existing["system"] if existing else None)
            template = data.get("template") or (existing["template"] if existing else None)
            db_exec("""
            INSERT INTO characters (id, owner_id, name, system, template, filename, modified_at, last_accessed_at)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              owner_id=excluded.owner_id,
              name=excluded.name,
              system=excluded.system,
              template=excluded.template,
              filename=excluded.filename,
              modified_at=excluded.modified_at,
              last_accessed_at=excluded.last_accessed_at
            """, (base_id, owner_id, char_name, system, template, fname, now_ts, now_ts))
        elif bucket == "templates":
            db_exec("""
            INSERT INTO templates (id, owner_id, title, schema, filename, modified_at)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              owner_id=excluded.owner_id,
              title=excluded.title,
              schema=excluded.schema,
              filename=excluded.filename,
              modified_at=excluded.modified_at
            """, (base_id, owner_id, data.get("title","Unnamed"), data.get("schema"), fname, now_ts))
        elif bucket == "systems":
            db_exec("""
            INSERT INTO systems (id, owner_id, title, "index", filename, modified_at)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              owner_id=excluded.owner_id,
              title=excluded.title,
              "index"=excluded."index",
              filename=excluded.filename,
              modified_at=excluded.modified_at
            """, (base_id, owner_id, data.get("title","Unnamed"), data.get("index"), fname, now_ts))

# ---------- Serve ----------
if __name__ == "__main__":
    print(f"Starting Server on port {PORT}")
    print("Bucket mappings:")
    for name, path in MOUNTS.items():
        print(f"  {name}: {os.path.abspath(path)}")
    try:
        with socketserver.TCPServer(("", PORT), JSONHandler) as httpd:
            print(f"\nServer running at http://localhost:{PORT}")
            print("Press Ctrl+C to stop")
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped by user")
    except Exception as e:
        print(f"Server error: {e}")

"""
Auth
POST /auth/register → {email, username, password} ⇒ {token, user}
POST /auth/login → {username_or_email, password} ⇒ {token, user}
POST /auth/logout (Bearer token)
POST /auth/refresh (Bearer token)

Lists
GET /list/{bucket}
Buckets: characters, templates, systems, codex_data, codex_templates
(Core buckets return owned/shared/public when logged in; public when not.)

Content
GET /content/{bucket}/{id} → reads {id}.json
POST /content/{bucket}/{id} (Bearer token) → writes/replaces JSON; enforces roles & ACL
POST /content/{bucket}/{id}/delete (Bearer) → deletes file + metadata
POST /content/{bucket}/{id}/public?public=true|false (Bearer) → toggle public flag (owner/edit-share only)

Shares
POST /shares (Bearer) → {content_type, content_id, shared_with_user_id, permissions: "view"|"edit"}
GET /shares/{content_type}/{content_id} (Bearer; owner/admin)

Importer
POST /import/{system_id}/{importer_id} (Bearer) → {payload, dryRun?}: Returns { patch, diff } using the schema‑embedded mappings (tiny JSONPath subset).

Misc
GET /healthz
GET /debug/database (admin)
"""