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
from .kinds import load_kind_policy
from .roles import role_rank
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

# Every Library kind (character/template/system, and every kind that used to be
# a plain unauthenticated flat file — class/subclass/species/background/
# variant/npc/setting/location/kind itself) now shares ONE ownership/sharing
# mechanism instead of three hand-written tables plus nine ungated ones. A
# creator-defined kind (undercroft/common/data/kind/{id}.json, itself just
# another Library kind) gets full ownership/sharing with zero server code
# changes, ever — that's the whole point of keying this table by `kind`
# instead of giving every kind its own table.
_LEGACY_BUCKET_SPECS = {
    "characters": ("character", "name", ["system", "template"]),
    "templates": ("template", "title", ["schema", "category"]),
    "systems": ("system", "title", ["index"]),
}


def init_storage_db(state: ServerState) -> None:
    conn = state.db
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS library_items (
            kind TEXT NOT NULL,
            id TEXT NOT NULL,
            owner_id INTEGER,
            title TEXT,
            is_public INTEGER DEFAULT 0,
            metadata TEXT,
            filename TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (kind, id),
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            owner_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'campaign',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS group_members (
            group_id TEXT NOT NULL,
            content_type TEXT NOT NULL,
            content_id TEXT NOT NULL,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (group_id, content_type, content_id),
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS group_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            entry_type TEXT NOT NULL,
            author_id INTEGER,
            author_name TEXT,
            message TEXT,
            payload TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
            FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
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
    conn.execute("CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_id)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_group_members_content ON group_members(content_type, content_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_group_logs_group ON group_logs(group_id, id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_group_logs_created ON group_logs(group_id, created_at)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_library_items_kind_owner ON library_items(kind, owner_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_library_items_kind_public ON library_items(kind, is_public)")
    _migrate_legacy_buckets_to_library_items(conn)
    _backfill_flat_library_kinds(state)
    conn.commit()


def _migrate_legacy_buckets_to_library_items(conn: sqlite3.Connection) -> None:
    # One-time (but idempotent — safe to run on every startup) migration from
    # the old per-bucket tables onto the unified library_items table. A fresh
    # install never has these tables at all; an upgraded install has them
    # renamed to _legacy_{table} after their first successful migration, so
    # this is a no-op on every later startup.
    existing_tables = {
        row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    for table, (kind, title_col, metadata_cols) in _LEGACY_BUCKET_SPECS.items():
        if table not in existing_tables:
            continue
        rows = conn.execute(f"SELECT * FROM {table}").fetchall()
        for row in rows:
            metadata = {col: row[col] for col in metadata_cols if row[col] is not None}
            conn.execute(
                """
                INSERT OR IGNORE INTO library_items
                    (kind, id, owner_id, title, is_public, metadata, filename,
                     created_at, modified_at, last_accessed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    kind,
                    row["id"],
                    row["owner_id"],
                    row[title_col],
                    row["is_public"],
                    json.dumps(metadata) if metadata else None,
                    row["filename"],
                    row["created_at"],
                    row["modified_at"],
                    row["last_accessed_at"],
                ),
            )
        conn.execute(f"ALTER TABLE {table} RENAME TO _legacy_{table}")


def _backfill_flat_library_kinds(state: ServerState) -> None:
    # Every Library kind's file root is a fixed, uniform path now — no more
    # per-kind server.config.json mount. Any file with no library_items row
    # yet (every pre-existing entry from before its kind ever had ownership
    # tracking) gets backfilled to an admin account, public, so existing
    # content stays visible/usable exactly as before, just with a real owner
    # of record. Idempotent — already-tracked files are skipped every run.
    data_root = state.root_dir / "undercroft" / "common" / "data"
    if not data_root.exists():
        return
    admin_row = state.db.execute(
        "SELECT id FROM users WHERE tier = 'admin' ORDER BY id LIMIT 1"
    ).fetchone()
    admin_id = admin_row["id"] if admin_row else None
    for kind_dir in sorted(data_root.iterdir()):
        if not kind_dir.is_dir():
            continue
        kind = kind_dir.name
        for entry in sorted(kind_dir.glob("*.json")):
            entry_id = entry.stem
            existing = state.db.execute(
                "SELECT 1 FROM library_items WHERE kind = ? AND id = ?",
                (kind, entry_id),
            ).fetchone()
            if existing:
                continue
            try:
                payload = json.loads(entry.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                payload = {}
            title = (payload.get("title") or payload.get("name") or entry_id) if isinstance(payload, dict) else entry_id
            # Each file's own on-disk mtime, not one shared "now" for the
            # whole batch — list_bucket() orders by modified_at DESC, so a
            # shared timestamp across an entire backfill makes the resulting
            # order an arbitrary tie-break (confirmed to cause a real bug:
            # Press's default template ended up being whichever one happened
            # to sort first among ties, not a meaningful "most recent" one).
            # File mtimes at least reflect real, distinct history.
            file_ts = datetime.utcfromtimestamp(entry.stat().st_mtime).isoformat()
            state.db.execute(
                """
                INSERT INTO library_items
                    (kind, id, owner_id, title, is_public, filename, created_at, modified_at, last_accessed_at)
                VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
                """,
                (kind, entry_id, admin_id, title, entry.name, file_ts, file_ts, file_ts),
            )


def library_kind_root(state: ServerState, kind: str) -> Path:
    return state.root_dir / "undercroft" / "common" / "data" / kind


def _record_filename(id_: str) -> str:
    return id_ if id_.endswith(".json") else f"{id_}.json"


def _record_path(state: ServerState, kind: str, id_: str) -> Path:
    return library_kind_root(state, kind) / _record_filename(id_)


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


def _flatten_metadata_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # metadata is stored as a JSON blob (see _extract_metadata) so a new kind
    # never needs a schema change, but every existing consumer of a list
    # response reads fields like `category`/`schema`/`system`/`template`
    # directly off the entry (e.g. Loom's Assigned Template picker, Workbench
    # and Press's template category filters) — flattening here once, instead
    # of teaching every one of those call sites about the metadata wrapper,
    # matches what list_owned_content() already does for Admin's Owned
    # Content tab.
    for row in rows:
        raw = row.get("metadata")
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(parsed, dict):
            row.update(parsed)
    return rows


def list_bucket(state: ServerState, kind: str, user: Optional[User]) -> Dict[str, Any]:
    # `kind` here covers two unrelated things sharing one route: legitimately
    # static, non-Library asset mounts (sheets, codex, loom-mappings — still
    # declared in server.config.json) fall through to the old directory-
    # listing behavior; everything else is a Library kind backed by
    # library_items, whether or not it has a server.config.json entry at all.
    try:
        mount = state.get_mount(kind)
    except KeyError:
        mount = None
    if mount is not None and mount.type == "static":
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
            item: Dict[str, Any] = {"filename": entry.stem, "modified": entry.stat().st_mtime}
            item.update(_parse_metadata(entry))
            files.append(item)
        return {"files": files}

    ensure_read_role(state, kind, user)
    public = _flatten_metadata_rows(
        [
            dict(row)
            for row in state.db.execute(
                """
                SELECT li.*, u.username AS owner_username, u.tier AS owner_tier
                FROM library_items li
                LEFT JOIN users u ON u.id = li.owner_id
                WHERE li.kind = ? AND li.is_public = 1
                ORDER BY li.modified_at DESC
                """,
                (kind,),
            )
        ]
    )
    if not user:
        return {"owned": [], "shared": [], "public": public}
    # Admin-only "see everything" bypass, for every kind uniformly (matches
    # is_owner()'s existing admin bypass for single-record reads/writes).
    # Non-admin tiers — including creator, Loom's own access floor — only
    # ever see items they own or that are shared with them.
    if str(user.tier).lower() == "admin":
        owned = _flatten_metadata_rows(
            [
                dict(row)
                for row in state.db.execute(
                    """
                    SELECT li.*, u.username AS owner_username, u.tier AS owner_tier
                    FROM library_items li
                    LEFT JOIN users u ON u.id = li.owner_id
                    WHERE li.kind = ?
                    ORDER BY li.modified_at DESC
                    """,
                    (kind,),
                )
            ]
        )
        shared: List[Dict[str, Any]] = []
    else:
        owned = _flatten_metadata_rows(
            [
                dict(row)
                for row in state.db.execute(
                    """
                    SELECT li.*, u.username AS owner_username, u.tier AS owner_tier
                    FROM library_items li
                    LEFT JOIN users u ON u.id = li.owner_id
                    WHERE li.kind = ? AND li.owner_id = ?
                    ORDER BY li.modified_at DESC
                    """,
                    (kind, user.id),
                )
            ]
        )
        shared = _flatten_metadata_rows(
            [
                dict(row)
                for row in state.db.execute(
                    """
                    SELECT li.*, s.permissions, u.username AS owner_username, u.tier AS owner_tier
                    FROM library_items li
                    JOIN shares s ON s.content_id = li.id AND s.content_type = li.kind
                    LEFT JOIN users u ON u.id = li.owner_id
                    WHERE li.kind = ? AND s.shared_with_user_id = ?
                    ORDER BY li.modified_at DESC
                    """,
                    (kind, user.id),
                )
            ]
        )
    return {"owned": owned, "shared": shared, "public": public}


def is_owner(state: ServerState, kind: str, id_: str, user: Optional[User]) -> bool:
    if not user:
        return False
    if str(getattr(user, "tier", "")).lower() == "admin":
        return True
    row = state.db.execute(
        "SELECT owner_id FROM library_items WHERE kind = ? AND id = ?",
        (kind, id_.replace(".json", "")),
    ).fetchone()
    if not row:
        return False
    return row["owner_id"] == user.id


def is_shared(state: ServerState, kind: str, id_: str, user: Optional[User], require_edit: bool = False) -> bool:
    if not user:
        return False
    row = state.db.execute(
        """
        SELECT permissions FROM shares
        WHERE content_type = ? AND content_id = ? AND shared_with_user_id = ?
        """,
        (kind, id_.replace(".json", ""), user.id),
    ).fetchone()
    if not row:
        return False
    if not require_edit:
        return True
    return row["permissions"] == "edit"


def is_public(state: ServerState, kind: str, id_: str) -> bool:
    row = state.db.execute(
        "SELECT is_public FROM library_items WHERE kind = ? AND id = ?",
        (kind, id_.replace(".json", "")),
    ).fetchone()
    if not row:
        return True
    return bool(row["is_public"])


def ensure_write_role(state: ServerState, kind: str, user: Optional[User]) -> None:
    if not user:
        raise AuthError("Authentication required")
    policy = load_kind_policy(state, kind)
    min_rank = role_rank(policy["writeTier"])
    if min_rank < 0:
        return
    if role_rank(user.tier) < min_rank:
        raise AuthError("Insufficient role")


def ensure_read_role(state: ServerState, kind: str, user: Optional[User]) -> None:
    policy = load_kind_policy(state, kind)
    min_rank = role_rank(policy["readTier"])
    if min_rank < 0:
        return
    user_rank = role_rank(user.tier) if user else role_rank("free")
    if user_rank < min_rank:
        raise AuthError("Insufficient role")


def get_item(
    state: ServerState,
    kind: str,
    id_: str,
    user: Optional[User],
    share_token: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_read_role(state, kind, user)
    base_id = id_.replace(".json", "")
    token_info = resolve_share_token(state, share_token or "") if share_token else None
    share_granted = False
    if token_info:
        token_type = token_info.get("content_type")
        token_target = token_info.get("content_id")
        if token_type == kind and token_target == base_id:
            share_granted = True
            touch_share_link(state, token_info.get("token", ""))
        elif token_type == "group" and kind == "character" and token_target:
            row = state.db.execute(
                """
                SELECT g.owner_id AS group_owner_id,
                       li.owner_id AS character_owner_id
                FROM groups AS g
                JOIN group_members AS gm ON gm.group_id = g.id
                LEFT JOIN library_items AS li ON li.kind = 'character' AND li.id = gm.content_id
                WHERE g.id = ?
                  AND gm.content_type = 'character'
                  AND gm.content_id = ?
                """,
                (token_target, base_id),
            ).fetchone()
            if row and row["group_owner_id"] is not None:
                character_owner_id = row["character_owner_id"]
                if character_owner_id is None or character_owner_id == row["group_owner_id"]:
                    share_granted = True
                    touch_share_link(state, token_info.get("token", ""))
    if not (
        share_granted
        or is_owner(state, kind, id_, user)
        or is_shared(state, kind, id_, user)
        or is_public(state, kind, id_)
    ):
        raise AuthError("Access denied")
    payload = load_json(_record_path(state, kind, id_))
    state.db.execute(
        "UPDATE library_items SET last_accessed_at = ? WHERE kind = ? AND id = ?",
        (datetime.utcnow().isoformat(), kind, base_id),
    )
    state.db.commit()
    return payload


def _extract_title(kind: str, body: Dict[str, Any], existing_row: Optional[sqlite3.Row]) -> str:
    if kind == "character":
        name = body.get("name") or (body.get("data") or {}).get("name")
    else:
        name = body.get("title") or body.get("name")
    if name:
        return name
    if existing_row is not None and existing_row["title"]:
        return existing_row["title"]
    return "Unnamed"


def _extract_metadata(kind: str, body: Dict[str, Any]) -> Optional[str]:
    # Small, kind-specific fields worth surfacing in list responses without an
    # N+1 fetch per entry (e.g. Loom's Assigned Template picker filtering by
    # template.category, or a character's system/template for display) — see
    # templates' `category` field, added deliberately for exactly this reason
    # earlier this session.
    if kind == "character":
        fields = {"system": body.get("system"), "template": body.get("template")}
    elif kind == "template":
        fields = {"schema": body.get("schema"), "category": body.get("category")}
    elif kind == "system":
        fields = {"index": body.get("index")}
    else:
        return None
    fields = {key: value for key, value in fields.items() if value is not None}
    return json.dumps(fields) if fields else None


def save_item(state: ServerState, kind: str, id_: str, body: Dict[str, Any], user: Optional[User]) -> Dict[str, Any]:
    try:
        ensure_write_role(state, kind, user)
    except AuthError as exc:
        raise AuthError(f"Your tier cannot create {kind} entries") from exc
    base_id = id_.replace(".json", "")
    existing_row = state.db.execute(
        "SELECT * FROM library_items WHERE kind = ? AND id = ?",
        (kind, base_id),
    ).fetchone()
    is_new_record = existing_row is None
    if not (is_owner(state, kind, id_, user) or is_shared(state, kind, id_, user, require_edit=True)):
        # creation allowed if record missing
        path = _record_path(state, kind, id_)
        if path.exists():
            raise AuthError("Edit not permitted")
    if is_new_record:
        _enforce_creation_limits(state, kind, user)
    write_json(_record_path(state, kind, id_), body)
    now_ts = datetime.utcnow().isoformat()
    filename = _record_filename(id_)
    owner_id = user.id if user else None
    title = _extract_title(kind, body, existing_row)
    metadata = _extract_metadata(kind, body)
    is_public_value = existing_row["is_public"] if existing_row is not None else 0
    state.db.execute(
        """
        INSERT INTO library_items (kind, id, owner_id, title, is_public, metadata, filename, modified_at, last_accessed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET
            owner_id = excluded.owner_id,
            title = excluded.title,
            metadata = excluded.metadata,
            filename = excluded.filename,
            modified_at = excluded.modified_at,
            last_accessed_at = excluded.last_accessed_at
        """,
        (kind, base_id, owner_id, title, is_public_value, metadata, filename, now_ts, now_ts),
    )
    state.db.commit()
    return {"ok": True, "bucket": kind, "id": id_}


def delete_item(state: ServerState, kind: str, id_: str, user: Optional[User]) -> None:
    ensure_write_role(state, kind, user)
    if not (is_owner(state, kind, id_, user) or is_shared(state, kind, id_, user, require_edit=True)):
        raise AuthError("Delete not permitted")
    path = _record_path(state, kind, id_)
    if path.exists():
        path.unlink()
    base_id = id_.replace(".json", "")
    state.db.execute("DELETE FROM library_items WHERE kind = ? AND id = ?", (kind, base_id))
    state.db.execute("DELETE FROM shares WHERE content_type = ? AND content_id = ?", (kind, base_id))
    state.db.execute("DELETE FROM share_links WHERE content_type = ? AND content_id = ?", (kind, base_id))
    state.db.commit()


def update_owner(
    state: ServerState,
    kind: str,
    id_: str,
    acting_user: Optional[User],
    new_owner: User,
) -> Dict[str, Any]:
    if not acting_user or acting_user.tier != "admin":
        raise AuthError("Admin only")
    policy = load_kind_policy(state, kind)
    if role_rank(new_owner.tier) < role_rank(policy["writeTier"]):
        raise AuthError("Owner tier too low for this content type")
    base_id = id_.replace(".json", "")
    row = state.db.execute(
        "SELECT id FROM library_items WHERE kind = ? AND id = ?",
        (kind, base_id),
    ).fetchone()
    if not row:
        raise AuthError("Content not found")
    state.db.execute(
        "UPDATE library_items SET owner_id = ? WHERE kind = ? AND id = ?",
        (new_owner.id, kind, base_id),
    )
    state.db.commit()
    return {
        "ok": True,
        "bucket": kind,
        "id": id_,
        "owner": {
            "id": new_owner.id,
            "username": new_owner.username,
            "tier": new_owner.tier,
        },
    }


def _enforce_creation_limits(state: ServerState, kind: str, user: Optional[User]) -> None:
    if not user or user.tier == "admin":
        return
    policy = load_kind_policy(state, kind)
    max_per_owner = policy.get("maxPerOwner")
    if not isinstance(max_per_owner, dict):
        return
    tier = (user.tier or "").lower()
    limit = max_per_owner.get(tier)
    if not isinstance(limit, int):
        return
    count = state.db.execute(
        "SELECT COUNT(*) AS count FROM library_items WHERE kind = ? AND owner_id = ?",
        (kind, user.id),
    ).fetchone()["count"]
    if count >= limit:
        raise AuthError(f"{tier.capitalize()} accounts can only create up to {limit} {kind} entries")


def list_owned_content(state: ServerState, owner: Optional[User], scope: str = "user") -> Dict[str, Any]:
    if scope != "all" and owner is None:
        raise AuthError("Owner required")
    if scope == "all":
        rows = state.db.execute(
            """
            SELECT li.kind AS kind, li.id AS id, li.title AS label, li.metadata AS metadata,
                   li.is_public AS is_public, li.created_at AS created_at,
                   li.modified_at AS modified_at, li.last_accessed_at AS last_accessed_at,
                   u.username AS owner_username, u.tier AS owner_tier
            FROM library_items li
            JOIN users u ON u.id = li.owner_id
            ORDER BY li.modified_at DESC
            """
        ).fetchall()
    else:
        rows = state.db.execute(
            """
            SELECT li.kind AS kind, li.id AS id, li.title AS label, li.metadata AS metadata,
                   li.is_public AS is_public, li.created_at AS created_at,
                   li.modified_at AS modified_at, li.last_accessed_at AS last_accessed_at,
                   u.username AS owner_username, u.tier AS owner_tier
            FROM library_items li
            JOIN users u ON u.id = li.owner_id
            WHERE li.owner_id = ?
            ORDER BY li.modified_at DESC
            """,
            (owner.id,),
        ).fetchall()
    items: List[Dict[str, Any]] = []
    for row in rows:
        metadata: Dict[str, Any] = {}
        if row["metadata"]:
            try:
                metadata = json.loads(row["metadata"])
            except json.JSONDecodeError:
                metadata = {}
        item = {
            "bucket": row["kind"],
            "id": row["id"],
            "label": row["label"] or row["id"],
            "is_public": bool(row["is_public"]),
            "created_at": row["created_at"],
            "modified_at": row["modified_at"],
            "last_accessed_at": row["last_accessed_at"],
            "owner_username": row["owner_username"],
            "owner_tier": row["owner_tier"],
        }
        item.update(metadata)
        items.append(item)
    if scope == "all":
        owner_info = {
            "id": None,
            "username": "__all__",
            "display_name": "Everyone",
            "tier": "",
        }
    else:
        owner_info = {
            "id": owner.id,
            "username": owner.username,
            "email": getattr(owner, "email", ""),
            "tier": owner.tier,
        }
    return {"owner": owner_info, "items": items, "scope": scope}


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
