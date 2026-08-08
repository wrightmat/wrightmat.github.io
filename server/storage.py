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
from .groups import accessible_group_ids, get_active_spotlights, user_can_access_group
from .kinds import load_kind_policy, normalize_kind
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
            shared_with_user_id INTEGER,
            shared_with_group_id TEXT,
            permissions TEXT DEFAULT 'view',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (shared_with_group_id) REFERENCES groups(id) ON DELETE CASCADE
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
    # Must run before the two partial indexes below: on a pre-existing
    # database, CREATE TABLE IF NOT EXISTS shares (above) is a no-op against
    # the already-existing old-shape table (no shared_with_group_id column
    # yet), so creating an index against that column would fail until this
    # migration has actually rebuilt the table. A fresh install already has
    # the new shape from CREATE TABLE IF NOT EXISTS, so this just no-ops.
    _migrate_shares_table_for_group_targets(conn)
    # Two partial unique indexes (one per target column) rather than one
    # combined UNIQUE — SQLite treats NULLs as distinct from each other in a
    # UNIQUE constraint, so a single UNIQUE(content_type, content_id,
    # shared_with_user_id, shared_with_group_id) would let duplicate
    # user-shares slip through (their both-NULL group_id never "matches").
    # Each row targets exactly one of the two columns (enforced in
    # server/shares.py, not by the schema), so a partial index scoped to
    # "this column is set" gives the real one-share-per-target-per-record
    # guarantee for each kind of target independently.
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_user_target
        ON shares(content_type, content_id, shared_with_user_id)
        WHERE shared_with_user_id IS NOT NULL
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_group_target
        ON shares(content_type, content_id, shared_with_group_id)
        WHERE shared_with_group_id IS NOT NULL
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_shares_group ON shares(shared_with_group_id)")
    _migrate_legacy_buckets_to_library_items(conn)
    _backfill_flat_library_kinds(state)
    conn.commit()


def _migrate_shares_table_for_group_targets(conn: sqlite3.Connection) -> None:
    # One-time (but idempotent — safe to run on every startup) migration for
    # databases created before campaign-group sharing existed: the old
    # `shares` table has `shared_with_user_id INTEGER NOT NULL` and no
    # `shared_with_group_id` column at all. SQLite can't relax a NOT NULL
    # constraint or add a column mid-table via ALTER TABLE, so this rebuilds
    # the table (rename, recreate via init_storage_db's own CREATE TABLE/
    # INDEX statements above, copy rows across, drop the renamed original).
    # A fresh install already gets the new shape from CREATE TABLE IF NOT
    # EXISTS above, so this only ever runs once per pre-existing database.
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(shares)")}
    if not columns or "shared_with_group_id" in columns:
        return
    conn.execute("ALTER TABLE shares RENAME TO _legacy_shares")
    conn.execute(
        """
        CREATE TABLE shares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content_type TEXT NOT NULL,
            content_id TEXT NOT NULL,
            shared_with_user_id INTEGER,
            shared_with_group_id TEXT,
            permissions TEXT DEFAULT 'view',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (shared_with_group_id) REFERENCES groups(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_user_target
        ON shares(content_type, content_id, shared_with_user_id)
        WHERE shared_with_user_id IS NOT NULL
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_group_target
        ON shares(content_type, content_id, shared_with_group_id)
        WHERE shared_with_group_id IS NOT NULL
        """
    )
    conn.execute(
        """
        INSERT INTO shares (id, content_type, content_id, shared_with_user_id, permissions, created_at)
        SELECT id, content_type, content_id, shared_with_user_id, permissions, created_at
        FROM _legacy_shares
        """
    )
    conn.execute("DROP TABLE _legacy_shares")


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
    # One query for every already-tracked (kind, id) pair instead of one
    # query per file on disk — this loop is otherwise an N+1 against the
    # filesystem's own file count, run on every server start.
    existing_ids = {
        (row["kind"], row["id"]) for row in state.db.execute("SELECT kind, id FROM library_items")
    }
    # Already-tracked rows that never got a `metadata` blob — this backfill
    # path used to INSERT with no metadata column at all (only save_item()'s
    # own path called _extract_metadata), so any kind/template/character
    # discovered here instead of created through the app has no
    # template/systemIds/schema/etc. in its list-response row, ever, even
    # after this fix ships — until healed once here. Confirmed real bug: a
    # character with no `template` in its list entry is exactly what
    # Workbench's own picker filters out (see syncCharacterOptions), so
    # Rook/The Red Lanterns/Octavian Hoff were invisible there regardless
    # of owned/shared/public bucket. Recomputed from each file's own current
    # content every startup (cheap, self-heals a hand-edited file too)
    # rather than a one-shot flag.
    missing_metadata_ids = {
        (row["kind"], row["id"])
        for row in state.db.execute("SELECT kind, id FROM library_items WHERE metadata IS NULL")
    }
    for kind_dir in sorted(data_root.iterdir()):
        if not kind_dir.is_dir():
            continue
        kind = kind_dir.name
        policy = load_kind_policy(state, kind)
        for entry in sorted(kind_dir.glob("*.json")):
            entry_id = entry.stem
            is_new = (kind, entry_id) not in existing_ids
            needs_metadata_heal = (kind, entry_id) in missing_metadata_ids
            if not is_new and not needs_metadata_heal:
                continue
            try:
                payload = json.loads(entry.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                payload = {}
            metadata = _extract_metadata(kind, payload, policy)
            if not is_new:
                if metadata:
                    state.db.execute(
                        "UPDATE library_items SET metadata = ? WHERE kind = ? AND id = ?",
                        (metadata, kind, entry_id),
                    )
                continue
            title = _title_from_payload(kind, payload, policy) or entry_id
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
                    (kind, id, owner_id, title, is_public, metadata, filename, created_at, modified_at, last_accessed_at)
                VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
                """,
                (kind, entry_id, admin_id, title, metadata, entry.name, file_ts, file_ts, file_ts),
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
        # A record can be shared directly with this user, or with a campaign
        # group they can access (own it, or own a member character) — the
        # latter set is precomputed in Python via accessible_group_ids since
        # that resolution isn't a plain SQL join. A record could in principle
        # match both, so duplicates are deduped afterward rather than tried
        # to be avoided in the query itself.
        group_ids = accessible_group_ids(state, user)
        group_placeholders = ",".join("?" for _ in group_ids) if group_ids else "NULL"
        shared_rows = [
            dict(row)
            for row in state.db.execute(
                f"""
                SELECT li.*, s.permissions, u.username AS owner_username, u.tier AS owner_tier
                FROM library_items li
                JOIN shares s ON s.content_id = li.id AND s.content_type = li.kind
                LEFT JOIN users u ON u.id = li.owner_id
                WHERE li.kind = ? AND (s.shared_with_user_id = ? OR s.shared_with_group_id IN ({group_placeholders}))
                ORDER BY li.modified_at DESC
                """,
                (kind, user.id, *group_ids),
            )
        ]
        deduped_shared: Dict[str, Dict[str, Any]] = {}
        for row in shared_rows:
            existing = deduped_shared.get(row["id"])
            if not existing or (row.get("permissions") == "edit" and existing.get("permissions") != "edit"):
                deduped_shared[row["id"]] = row
        shared = _flatten_metadata_rows(list(deduped_shared.values()))
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
    content_id = id_.replace(".json", "")
    row = state.db.execute(
        """
        SELECT permissions FROM shares
        WHERE content_type = ? AND content_id = ? AND shared_with_user_id = ?
        """,
        (kind, content_id, user.id),
    ).fetchone()
    # A direct user share alone can grant access, but must NOT short-circuit
    # the group check below when it exists without meeting require_edit —
    # confirmed real bug: a user with an older *view* direct share and a
    # separately-granted *edit* group share (e.g. a Map first shared to them
    # individually, then later shared to the whole campaign at "edit" for
    # player-driven token movement) was denied edit access entirely, because
    # this used to return based on the direct share alone and never checked
    # the group share at all once a direct row existed.
    if row and (not require_edit or row["permissions"] == "edit"):
        return True
    # Check every group-targeted share on this record for one the user can
    # actually access (owns the group, or owns a member character); a
    # handful of rows per record at most, so a per-row Python check here is
    # simpler and clearer than folding group-membership resolution into this
    # query directly.
    group_rows = state.db.execute(
        """
        SELECT shared_with_group_id, permissions FROM shares
        WHERE content_type = ? AND content_id = ? AND shared_with_group_id IS NOT NULL
        """,
        (kind, content_id),
    ).fetchall()
    for group_row in group_rows:
        if not user_can_access_group(state, group_row["shared_with_group_id"], user):
            continue
        if not require_edit:
            return True
        if group_row["permissions"] == "edit":
            return True
    return False


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
        if not share_granted and token_type == "group" and token_target:
            # "Show to table": an anonymous share-link visitor can read
            # exactly whatever the group currently has spotlighted — any of
            # them, not just whichever was shown most recently (two things
            # can legitimately be up at once, e.g. a Handout and a Map — see
            # groups.get_active_spotlights's own comment on why this used to
            # be a single-slot bug, same shape as the one already fixed
            # client-side in spotlight.js) — the entity itself, or its
            # templateId — and nothing else. Deliberately narrow: this is not
            # "share this group's members' content", it's "whatever's
            # currently being projected to the table right now."
            normalized_kind = normalize_kind(kind)
            for spotlight in get_active_spotlights(state, token_target):
                spotlight_kind = normalize_kind(str(spotlight.get("kind") or ""))
                spotlight_id = str(spotlight.get("id") or "")
                spotlight_template_id = str(spotlight.get("templateId") or "")
                is_spotlighted_entity = normalized_kind == spotlight_kind and base_id == spotlight_id
                is_spotlighted_template = (
                    normalized_kind == "template" and spotlight_template_id and base_id == spotlight_template_id
                )
                if is_spotlighted_entity or is_spotlighted_template:
                    share_granted = True
                    touch_share_link(state, token_info.get("token", ""))
                    break
    if not (
        share_granted
        or is_owner(state, kind, id_, user)
        or is_shared(state, kind, id_, user)
        or is_public(state, kind, id_)
    ):
        raise AuthError("Access denied")
    payload = load_json(_record_path(state, kind, id_))
    # Recorded in memory, not written here — every read used to do a
    # synchronous UPDATE + commit (a full fsync on a plain read), which
    # dominated load time for anything that reads several items in a row
    # (e.g. populating a picker). last_accessed_at has exactly one consumer
    # (list_owned_content's display field below), nothing depends on it
    # being real-time, so batching it via flush_pending_touches() is free.
    state.record_touch(kind, base_id)
    return payload


def flush_pending_touches(state: ServerState) -> int:
    """Persists every queued last_accessed_at touch in one batched commit
    instead of one per read. Called periodically by a background thread
    (see server/app.py) and once more on shutdown so nothing queued is
    lost. Returns the number of rows touched, mainly for logging."""
    pending = state.drain_pending_touches()
    if not pending:
        return 0
    with state.lock:
        for (kind, id_), timestamp in pending.items():
            state.db.execute(
                "UPDATE library_items SET last_accessed_at = ? WHERE kind = ? AND id = ?",
                (timestamp, kind, id_),
            )
        state.db.commit()
    return len(pending)


def _resolve_dotted(payload: Dict[str, Any], path: str) -> Any:
    current: Any = payload
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _title_from_payload(kind: str, payload: Dict[str, Any], policy: Optional[Dict[str, Any]] = None) -> Optional[str]:
    # Which field(s) hold a kind's display name is declared on that kind's
    # own registry entry (titleFields — see common/data/kind/{id}.json),
    # falling back to the suite-wide default of top-level `title`/`name` for
    # every kind that doesn't need anything special (the vast majority) —
    # adding a kind with an unusual title location is a JSON edit, not a
    # server code change. `character`'s titleFields (["name", "data.name"])
    # is what covers Workbench's `data.name`-nested sheet shape alongside the
    # plain top-level `name` DDB-import shape. Used both at save time
    # (_extract_title) and by the disk-scan backfill
    # (_backfill_flat_library_kinds), so a pre-existing file and a freshly
    # saved one get the same title instead of the backfill path falling back
    # to the raw filename.
    if not isinstance(payload, dict):
        return None
    fields = (policy or {}).get("titleFields") or ["title", "name"]
    for field in fields:
        value = _resolve_dotted(payload, field)
        if value:
            return value
    return None


def _extract_title(
    kind: str, body: Dict[str, Any], existing_row: Optional[sqlite3.Row], policy: Optional[Dict[str, Any]] = None
) -> str:
    name = _title_from_payload(kind, body, policy)
    if name:
        return name
    if existing_row is not None and existing_row["title"]:
        return existing_row["title"]
    return "Unnamed"


def _extract_metadata(kind: str, body: Dict[str, Any], policy: Optional[Dict[str, Any]] = None) -> Optional[str]:
    # Small, kind-specific fields worth surfacing in list responses without an
    # N+1 fetch per entry (e.g. Loom's Assigned Template picker filtering by
    # template.category, or a character's system/template for display) —
    # declared per-kind via metadataFields on that kind's own registry entry
    # (common/data/kind/{id}.json), not hardcoded here — a new kind that
    # wants this just adds the field to its own JSON, no server code changes.
    field_names = (policy or {}).get("metadataFields")
    if not field_names:
        return None
    fields = {name: body.get(name) for name in field_names if body.get(name) is not None}
    return json.dumps(fields) if fields else None


def save_item(state: ServerState, kind: str, id_: str, body: Dict[str, Any], user: Optional[User]) -> Dict[str, Any]:
    base_id = id_.replace(".json", "")
    existing_row = state.db.execute(
        "SELECT * FROM library_items WHERE kind = ? AND id = ?",
        (kind, base_id),
    ).fetchone()
    is_new_record = existing_row is None
    if is_new_record:
        # The kind-wide tier gate (writeTier, common/data/kind/{kind}.json)
        # governs who may AUTHOR brand-new content of this kind — it must not
        # also block an editor with explicit owner/share-edit access from
        # updating a record that already exists. Confirmed real bug: a
        # player-tier member with edit-share access to a GM's shared map,
        # dragging their own character's token, was rejected with "Your tier
        # cannot create map entries" (map's writeTier is "creator") even
        # though they weren't creating anything — only new records need this
        # check at all.
        try:
            ensure_write_role(state, kind, user)
        except AuthError as exc:
            raise AuthError(f"Your tier cannot create {kind} entries") from exc
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
    # Ownership only transfers via the dedicated, explicit /content/{kind}/
    # {id}/owner route (update_owner) — never as a side effect of an
    # ordinary save. Confirmed real, severe bug: this used to unconditionally
    # set owner_id to whoever is CURRENTLY saving, even for an UPDATE to an
    # EXISTING record the saver only has EDIT-SHARE access to (not
    # ownership) — meaning any editor with edit permission on a record (a
    # player with edit access to a GM's shared map, dragging their own
    # token, is exactly this session's real trigger) silently stole
    # ownership of the ENTIRE record the instant they saved it. Every
    # ownership-gated check downstream (Delete button, "full map access" in
    # Orrery, etc.) then correctly, but catastrophically, treated the new
    # "owner" as legitimate, because the DATA was now wrong, not the checks.
    owner_id = (user.id if user else None) if is_new_record else existing_row["owner_id"]
    policy = load_kind_policy(state, kind)
    title = _extract_title(kind, body, existing_row, policy)
    metadata = _extract_metadata(kind, body, policy)
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
