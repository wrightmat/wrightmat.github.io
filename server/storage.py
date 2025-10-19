from __future__ import annotations

import contextlib
import json
import os
import platform
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import re

from .auth import AuthError, User
from .roles import ROLE_ORDER, role_rank
from .shares import resolve_share_token, touch_share_link
from .state import ServerState

if platform.system() != "Windows":  # pragma: no cover - platform specific
    import fcntl

    @contextlib.contextmanager
    def file_lock(path: Path, mode: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        if ("w" in mode or "a" in mode or "+" in mode) and not path.exists():
            path.write_text("{}", encoding="utf-8")
        with path.open(mode, encoding="utf-8") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield handle
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
else:  # pragma: no cover
    @contextlib.contextmanager
    def file_lock(path: Path, mode: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        if ("w" in mode or "a" in mode or "+" in mode) and not path.exists():
            path.write_text("{}", encoding="utf-8")
        with path.open(mode, encoding="utf-8") as handle:
            yield handle


_METADATA_PATTERN = re.compile(r"@([\w-]+):\s*(.+)")


def init_storage_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
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
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS templates (
            id TEXT PRIMARY KEY,
            owner_id INTEGER,
            title TEXT,
            schema TEXT,
            filename TEXT,
            is_public INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS systems (
            id TEXT PRIMARY KEY,
            owner_id INTEGER,
            title TEXT,
            "index" TEXT,
            filename TEXT,
            is_public INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS shares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content_type TEXT NOT NULL,
            content_id TEXT NOT NULL,
            shared_with_user_id INTEGER NOT NULL,
            permissions TEXT DEFAULT 'view',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(content_type, content_id, shared_with_user_id),
            FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS share_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content_type TEXT NOT NULL,
            content_id TEXT NOT NULL,
            token TEXT NOT NULL,
            permissions TEXT DEFAULT 'view',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(content_type, content_id),
            UNIQUE(token)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_shares_content ON shares(content_type, content_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(shared_with_user_id)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_share_links_content ON share_links(content_type, content_id)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token)")
    # Ensure legacy databases pick up the last_accessed_at columns
    _ensure_column(conn, "templates", "last_accessed_at", "DATETIME", "CURRENT_TIMESTAMP")
    _ensure_column(conn, "systems", "last_accessed_at", "DATETIME", "CURRENT_TIMESTAMP")
    conn.commit()


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, type_: str, default: Optional[str] = None) -> None:
    info = conn.execute(f"PRAGMA table_info({table})").fetchall()
    if any(row[1] == column for row in info):
        return
    default_clause = f" DEFAULT {default}" if default else ""
    conn.execute(
        f"ALTER TABLE {table} ADD COLUMN {column} {type_}{default_clause}"
    )


def bucket_root(state: ServerState, bucket: str) -> Path:
    return state.get_mount(bucket).root


def _record_filename(id_: str) -> str:
    return id_ if id_.endswith(".json") else f"{id_}.json"


def _record_path(state: ServerState, bucket: str, id_: str) -> Path:
    return bucket_root(state, bucket) / _record_filename(id_)


def load_json(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(str(path))
    with file_lock(path, "r") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with file_lock(temp_path, "w") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    temp_path.replace(path)


def _parse_metadata(path: Path, line_limit: int = 20) -> Dict[str, str]:
    metadata: Dict[str, str] = {}
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            for _, line in zip(range(line_limit), handle):
                if "@" not in line:
                    continue
                match = _METADATA_PATTERN.search(line)
                if not match:
                    continue
                key, value = match.groups()
                metadata[key.strip()] = value.strip()
    except FileNotFoundError:
        return metadata
    return metadata


def list_bucket(state: ServerState, bucket: str, user: Optional[User]) -> Dict[str, Any]:
    mount = state.get_mount(bucket)
    if mount.type == "static":
        if not mount.directory_listing:
            return {"files": []}
        allowed = {ext.lower() for ext in mount.directory_extensions if ext}
        files: List[Dict[str, Any]] = []
        if not mount.root.exists():
            return {"files": files}
        for entry in sorted(mount.root.iterdir()):
            if not entry.is_file():
                continue
            if allowed and entry.suffix.lower() not in allowed:
                continue
            item: Dict[str, Any] = {"filename": entry.stem}
            item.update(_parse_metadata(entry))
            files.append(item)
        return {"files": files}
    if mount.type != "json":
        return {"items": []}
    table = mount.table
    supports_public = bucket in ("templates", "systems")
    public: List[Dict[str, Any]] = []
    if supports_public:
        public = [
            dict(row)
            for row in state.db.execute(
                f"""
                SELECT m.*, u.username AS owner_username, u.tier AS owner_tier
                FROM {table} m
                LEFT JOIN users u ON u.id = m.owner_id
                WHERE m.is_public = 1
                ORDER BY m.modified_at DESC
                """
            )
        ]
    if bucket in ("characters", "templates", "systems"):
        if not user:
            return {"owned": [], "shared": [], "public": public}
        if bucket == "characters":
            owned_query = f"""
                SELECT m.*, u.username AS owner_username, u.tier AS owner_tier, t.title AS template_title
                FROM {table} m
                LEFT JOIN users u ON u.id = m.owner_id
                LEFT JOIN templates t ON t.id = m.template
                WHERE m.owner_id = ?
                ORDER BY m.modified_at DESC
            """
            shared_query = f"""
                SELECT m.*, s.permissions, u.username AS owner_username, u.tier AS owner_tier, t.title AS template_title
                FROM {table} m
                JOIN shares s ON s.content_id = m.id AND s.content_type = ?
                LEFT JOIN users u ON u.id = m.owner_id
                LEFT JOIN templates t ON t.id = m.template
                WHERE s.shared_with_user_id = ?
                ORDER BY m.modified_at DESC
            """
        else:
            owned_query = f"""
                SELECT m.*, u.username AS owner_username, u.tier AS owner_tier
                FROM {table} m
                LEFT JOIN users u ON u.id = m.owner_id
                WHERE m.owner_id = ?
                ORDER BY m.modified_at DESC
            """
            shared_query = f"""
                SELECT m.*, s.permissions, u.username AS owner_username, u.tier AS owner_tier
                FROM {table} m
                JOIN shares s ON s.content_id = m.id AND s.content_type = ?
                LEFT JOIN users u ON u.id = m.owner_id
                WHERE s.shared_with_user_id = ?
                ORDER BY m.modified_at DESC
            """
        owned = [
            dict(row)
            for row in state.db.execute(
                owned_query,
                (user.id,),
            )
        ]
        shared = [
            dict(row)
            for row in state.db.execute(
                shared_query,
                (bucket[:-1], user.id),
            )
        ]
        return {"owned": owned, "shared": shared, "public": public}
    rows = [dict(r) for r in state.db.execute(f"SELECT * FROM {table} ORDER BY modified_at DESC")]
    return {"items": rows}


def is_owner(state: ServerState, bucket: str, id_: str, user: Optional[User]) -> bool:
    if not user:
        return False
    if str(getattr(user, "tier", "")).lower() == "admin":
        return True
    mount = state.get_mount(bucket)
    if mount.type != "json" or not mount.table:
        return False
    row = state.db.execute(
        f"SELECT owner_id FROM {mount.table} WHERE id = ?",
        (id_.replace(".json", ""),),
    ).fetchone()
    if not row:
        return False
    return row["owner_id"] == user.id or user.tier == "admin"


def is_shared(state: ServerState, bucket: str, id_: str, user: Optional[User], require_edit: bool = False) -> bool:
    if not user:
        return False
    content_type = bucket[:-1]
    row = state.db.execute(
        """
        SELECT permissions FROM shares
        WHERE content_type = ? AND content_id = ? AND shared_with_user_id = ?
        """,
        (content_type, id_.replace(".json", ""), user.id),
    ).fetchone()
    if not row:
        return False
    if not require_edit:
        return True
    return row["permissions"] == "edit"


def is_public(state: ServerState, bucket: str, id_: str) -> bool:
    mount = state.get_mount(bucket)
    if mount.type != "json" or not mount.table:
        return True
    row = state.db.execute(
        f"SELECT is_public FROM {mount.table} WHERE id = ?",
        (id_.replace(".json", ""),),
    ).fetchone()
    if not row:
        return True
    return bool(row["is_public"])


def ensure_write_role(state: ServerState, bucket: str, user: Optional[User]) -> None:
    mount = state.get_mount(bucket)
    required_roles = mount.write_roles or ["creator"]
    if not user:
        raise AuthError("Authentication required")
    user_rank = role_rank(user.tier)
    min_rank = min(role_rank(role) for role in required_roles if role_rank(role) >= 0)
    if user_rank < min_rank:
        raise AuthError("Insufficient role")


def ensure_read_role(state: ServerState, bucket: str, user: Optional[User]) -> None:
    mount = state.get_mount(bucket)
    required_roles = mount.read_roles or ["free"]
    if not required_roles:
        return
    min_rank = min(role_rank(role) for role in required_roles if role_rank(role) >= 0)
    if min_rank < 0:
        return
    user_rank = role_rank(user.tier) if user else role_rank("free")
    if user_rank < min_rank:
        raise AuthError("Insufficient role")


def get_item(
    state: ServerState,
    bucket: str,
    id_: str,
    user: Optional[User],
    share_token: Optional[str] = None,
) -> Dict[str, Any]:
    mount = state.get_mount(bucket)
    if mount.type != "json":
        raise AuthError("Bucket does not support content read")
    ensure_read_role(state, bucket, user)
    base_id = id_.replace(".json", "")
    token_info = resolve_share_token(state, share_token or "") if share_token else None
    share_granted = False
    if token_info and token_info.get("content_type") == bucket[:-1] and token_info.get("content_id") == base_id:
        share_granted = True
        touch_share_link(state, token_info.get("token", ""))
    if not (
        share_granted
        or is_owner(state, bucket, id_, user)
        or is_shared(state, bucket, id_, user)
        or is_public(state, bucket, id_)
    ):
        raise AuthError("Access denied")
    payload = load_json(_record_path(state, bucket, id_))
    if bucket in {"characters", "templates", "systems"}:
        table = state.get_mount(bucket).table
        if table:
            state.db.execute(
                f"UPDATE {table} SET last_accessed_at = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), base_id),
            )
            state.db.commit()
    return payload


def save_item(state: ServerState, bucket: str, id_: str, body: Dict[str, Any], user: Optional[User]) -> Dict[str, Any]:
    mount = state.get_mount(bucket)
    if mount.type != "json":
        raise AuthError("Bucket does not support writes")
    try:
        ensure_write_role(state, bucket, user)
    except AuthError as exc:
        if bucket == "templates":
            raise AuthError("Your tier cannot create templates") from exc
        if bucket == "systems":
            raise AuthError("Your tier cannot create systems") from exc
        raise
    base_id = id_.replace(".json", "")
    existing_row = state.db.execute(
        f"SELECT * FROM {mount.table} WHERE id = ?",
        (base_id,),
    ).fetchone()
    is_new_record = existing_row is None
    if not (is_owner(state, bucket, id_, user) or is_shared(state, bucket, id_, user, require_edit=True)):
        # creation allowed if record missing
        path = _record_path(state, bucket, id_)
        if path.exists():
            raise AuthError("Edit not permitted")
    if is_new_record:
        _enforce_creation_limits(state, bucket, user)
    write_json(_record_path(state, bucket, id_), body)
    now_ts = datetime.utcnow().isoformat()
    filename = _record_filename(id_)
    owner_id = user.id if user else None
    if bucket == "characters":
        char_name = body.get("name") or body.get("data", {}).get("name", "Unnamed")
        existing = existing_row
        system = body.get("system") or (existing["system"] if existing else None)
        template = body.get("template") or (existing["template"] if existing else None)
        state.db.execute(
            """
            INSERT INTO characters (id, owner_id, name, system, template, filename, modified_at, last_accessed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                owner_id = excluded.owner_id,
                name = excluded.name,
                system = excluded.system,
                template = excluded.template,
                filename = excluded.filename,
                modified_at = excluded.modified_at,
                last_accessed_at = excluded.last_accessed_at
            """,
            (base_id, owner_id, char_name or "Unnamed", system, template, filename, now_ts, now_ts),
        )
    elif bucket == "templates":
        state.db.execute(
            """
            INSERT INTO templates (id, owner_id, title, schema, filename, modified_at, last_accessed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                owner_id = excluded.owner_id,
                title = excluded.title,
                schema = excluded.schema,
                filename = excluded.filename,
                modified_at = excluded.modified_at,
                last_accessed_at = excluded.last_accessed_at
            """,
            (base_id, owner_id, body.get("title", "Unnamed"), body.get("schema"), filename, now_ts, now_ts),
        )
    elif bucket == "systems":
        state.db.execute(
            """
            INSERT INTO systems (id, owner_id, title, "index", filename, modified_at, last_accessed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                owner_id = excluded.owner_id,
                title = excluded.title,
                "index" = excluded."index",
                filename = excluded.filename,
                modified_at = excluded.modified_at,
                last_accessed_at = excluded.last_accessed_at
            """,
            (base_id, owner_id, body.get("title", "Unnamed"), body.get("index"), filename, now_ts, now_ts),
        )
    else:
        state.db.execute(
            f"INSERT OR REPLACE INTO {mount.table} (id, owner_id, filename, modified_at) VALUES (?, ?, ?, ?)",
            (base_id, owner_id, filename, now_ts),
        )
    state.db.commit()
    return {"ok": True, "bucket": bucket, "id": id_}


def delete_item(state: ServerState, bucket: str, id_: str, user: Optional[User]) -> None:
    mount = state.get_mount(bucket)
    if mount.type != "json":
        raise AuthError("Bucket does not support deletes")
    ensure_write_role(state, bucket, user)
    if not (is_owner(state, bucket, id_, user) or is_shared(state, bucket, id_, user, require_edit=True)):
        raise AuthError("Delete not permitted")
    path = _record_path(state, bucket, id_)
    if path.exists():
        path.unlink()
    base_id = id_.replace(".json", "")
    state.db.execute(f"DELETE FROM {mount.table} WHERE id = ?", (base_id,))
    if bucket in ("characters", "templates", "systems"):
        content_type = bucket[:-1]
        state.db.execute(
            "DELETE FROM shares WHERE content_type = ? AND content_id = ?",
            (content_type, base_id),
        )
        state.db.execute(
            "DELETE FROM share_links WHERE content_type = ? AND content_id = ?",
            (content_type, base_id),
        )
    state.db.commit()


def _minimum_owner_role(bucket: str) -> str:
    if bucket == "characters":
        return "player"
    if bucket == "templates":
        return "gm"
    if bucket == "systems":
        return "creator"
    return "free"


def update_owner(
    state: ServerState,
    bucket: str,
    id_: str,
    acting_user: Optional[User],
    new_owner: User,
) -> Dict[str, Any]:
    if not acting_user or acting_user.tier != "admin":
        raise AuthError("Admin only")
    mount = state.get_mount(bucket)
    if mount.type != "json" or not mount.table:
        raise AuthError("Bucket does not support owner updates")
    required = _minimum_owner_role(bucket)
    if role_rank(new_owner.tier) < role_rank(required):
        raise AuthError("Owner tier too low for this content type")
    base_id = id_.replace(".json", "")
    row = state.db.execute(
        f"SELECT id FROM {mount.table} WHERE id = ?",
        (base_id,),
    ).fetchone()
    if not row:
        raise AuthError("Content not found")
    state.db.execute(
        f"UPDATE {mount.table} SET owner_id = ? WHERE id = ?",
        (new_owner.id, base_id),
    )
    state.db.commit()
    return {
        "ok": True,
        "bucket": bucket,
        "id": id_,
        "owner": {
            "id": new_owner.id,
            "username": new_owner.username,
            "tier": new_owner.tier,
        },
    }


def _enforce_creation_limits(state: ServerState, bucket: str, user: Optional[User]) -> None:
    if not user or user.tier == "admin":
        return
    tier = (user.tier or "").lower()
    if bucket == "characters":
        if tier == "free":
            count = state.db.execute(
                "SELECT COUNT(*) AS count FROM characters WHERE owner_id = ?",
                (user.id,),
            ).fetchone()["count"]
            if count >= 5:
                raise AuthError("Free accounts can only create up to 5 characters")
        return
    if bucket == "templates":
        if tier not in {"gm", "master", "creator"}:
            raise AuthError("Your tier cannot create templates")
        return
    if bucket == "systems":
        if tier not in {"creator"}:
            raise AuthError("Your tier cannot create systems")


def list_owned_content(state: ServerState, owner: User) -> Dict[str, Any]:
    items: List[Dict[str, Any]] = []
    now_owner = {
        "id": owner.id,
        "username": owner.username,
        "email": getattr(owner, "email", ""),
        "tier": owner.tier,
    }
    mappings = [
        ("characters", "characters", "name"),
        ("templates", "templates", "title"),
        ("systems", "systems", "title"),
    ]
    for bucket, table, label_field in mappings:
        rows = state.db.execute(
            f"""
            SELECT id, {label_field} AS label, created_at, modified_at, last_accessed_at
            FROM {table}
            WHERE owner_id = ?
            ORDER BY modified_at DESC
            """,
            (owner.id,),
        ).fetchall()
        for row in rows:
            items.append(
                {
                    "bucket": bucket,
                    "id": row["id"],
                    "label": row["label"] or row["id"],
                    "created_at": row["created_at"],
                    "modified_at": row["modified_at"],
                    "last_accessed_at": row["last_accessed_at"],
                }
            )
    items.sort(key=lambda item: item.get("modified_at") or "", reverse=True)
    return {"owner": now_owner, "items": items}


def list_static(state: ServerState, bucket: str, relative_path: str = "") -> List[str]:
    mount = state.get_mount(bucket)
    if mount.type != "static":
        raise AuthError("Mount is not static")
    base = mount.root / relative_path
    if not base.exists():
        return []
    if base.is_file():
        return [relative_path]
    return [str(Path(relative_path) / entry.name) if relative_path else entry.name for entry in base.iterdir()]
