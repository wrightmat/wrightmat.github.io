from __future__ import annotations

import contextlib
import json
import os
import platform
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from .auth import AuthError, User
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


ROLE_ORDER = ["free", "player", "gm", "master", "creator", "admin"]


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
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_shares_content ON shares(content_type, content_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(shared_with_user_id)")
    conn.commit()


def role_rank(role: str) -> int:
    return ROLE_ORDER.index(role) if role in ROLE_ORDER else -1


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


def list_bucket(state: ServerState, bucket: str, user: Optional[User]) -> Dict[str, Any]:
    mount = state.get_mount(bucket)
    if mount.type == "static":
        files = []
        for entry in sorted(mount.root.glob("*.json")):
            files.append(entry.stem)
        return {"files": files}
    if mount.type != "json":
        return {"items": []}
    table = mount.table
    if bucket in ("characters", "templates", "systems"):
        if user:
            owned = [dict(r) for r in state.db.execute(
                f"SELECT * FROM {table} WHERE owner_id=? ORDER BY modified_at DESC", (user.id,)
            )]
            shared = [dict(r) for r in state.db.execute(
                f"""
                SELECT m.*, s.permissions FROM {table} m
                JOIN shares s ON s.content_id = m.id AND s.content_type = ?
                WHERE s.shared_with_user_id = ?
                ORDER BY m.modified_at DESC
                """,
                (bucket[:-1], user.id),
            )]
            public = [dict(r) for r in state.db.execute(
                f"SELECT * FROM {table} WHERE is_public=1 AND (owner_id IS NULL OR owner_id != ?) ORDER BY modified_at DESC",
                (user.id,),
            )]
            return {"owned": owned, "shared": shared, "public": public}
        public = [dict(r) for r in state.db.execute(
            f"SELECT * FROM {table} WHERE is_public=1 ORDER BY modified_at DESC"
        )]
        return {"public": public}
    rows = [dict(r) for r in state.db.execute(f"SELECT * FROM {table} ORDER BY modified_at DESC")]
    return {"items": rows}


def is_owner(state: ServerState, bucket: str, id_: str, user: Optional[User]) -> bool:
    if not user:
        return False
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


def get_item(state: ServerState, bucket: str, id_: str, user: Optional[User]) -> Dict[str, Any]:
    mount = state.get_mount(bucket)
    if mount.type != "json":
        raise AuthError("Bucket does not support content read")
    ensure_read_role(state, bucket, user)
    if not (is_public(state, bucket, id_) or is_owner(state, bucket, id_, user) or is_shared(state, bucket, id_, user)):
        raise AuthError("Access denied")
    payload = load_json(_record_path(state, bucket, id_))
    if bucket == "characters":
        state.db.execute(
            "UPDATE characters SET last_accessed_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), id_.replace(".json", "")),
        )
        state.db.commit()
    return payload


def save_item(state: ServerState, bucket: str, id_: str, body: Dict[str, Any], user: Optional[User]) -> Dict[str, Any]:
    mount = state.get_mount(bucket)
    if mount.type != "json":
        raise AuthError("Bucket does not support writes")
    ensure_write_role(state, bucket, user)
    if not (is_owner(state, bucket, id_, user) or is_shared(state, bucket, id_, user, require_edit=True)):
        # creation allowed if record missing
        path = _record_path(state, bucket, id_)
        if path.exists():
            raise AuthError("Edit not permitted")
    write_json(_record_path(state, bucket, id_), body)
    now_ts = datetime.utcnow().isoformat()
    base_id = id_.replace(".json", "")
    filename = _record_filename(id_)
    owner_id = user.id if user else None
    if bucket == "characters":
        char_name = body.get("name") or body.get("data", {}).get("name", "Unnamed")
        existing = state.db.execute("SELECT system, template FROM characters WHERE id = ?", (base_id,)).fetchone()
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
            INSERT INTO templates (id, owner_id, title, schema, filename, modified_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                owner_id = excluded.owner_id,
                title = excluded.title,
                schema = excluded.schema,
                filename = excluded.filename,
                modified_at = excluded.modified_at
            """,
            (base_id, owner_id, body.get("title", "Unnamed"), body.get("schema"), filename, now_ts),
        )
    elif bucket == "systems":
        state.db.execute(
            """
            INSERT INTO systems (id, owner_id, title, "index", filename, modified_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                owner_id = excluded.owner_id,
                title = excluded.title,
                "index" = excluded."index",
                filename = excluded.filename,
                modified_at = excluded.modified_at
            """,
            (base_id, owner_id, body.get("title", "Unnamed"), body.get("index"), filename, now_ts),
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
    state.db.execute(f"DELETE FROM {mount.table} WHERE id = ?", (id_.replace(".json", ""),))
    state.db.commit()


def toggle_public(state: ServerState, bucket: str, id_: str, user: Optional[User], public: bool) -> Dict[str, Any]:
    mount = state.get_mount(bucket)
    if mount.type != "json":
        raise AuthError("Bucket does not support public toggle")
    ensure_write_role(state, bucket, user)
    if not (is_owner(state, bucket, id_, user) or is_shared(state, bucket, id_, user, require_edit=True)):
        raise AuthError("Only owner or editors can change visibility")
    state.db.execute(
        f"UPDATE {mount.table} SET is_public = ? WHERE id = ?",
        (1 if public else 0, id_.replace(".json", "")),
    )
    state.db.commit()
    return {"ok": True, "public": public}


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
