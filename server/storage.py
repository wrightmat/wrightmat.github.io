from __future__ import annotations

import contextlib
import json
import os
import platform
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import re

from .auth import AuthError, User
from .kinds import invalidate_kind_policy, load_kind_policy, normalize_kind
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
    # No CREATE TABLE for `groups` any more — a Group is now an ordinary
    # Library kind (library_items row + undercroft/common/data/group/{id}.json
    # flat file), exactly like System/Character/Map, created the first time
    # anyone saves one via the generic content route. The bespoke table only
    # still exists (as `_legacy_groups`, see _migrate_groups_to_library_items)
    # on a database that had real campaigns before this migration shipped.
    # `shared_with_group_id`/`group_id` below are plain TEXT references to a
    # group's id string, not FK-enforced against anything — same
    # already-established "polymorphic reference, checked in application
    # code, not the schema" pattern this same `shares` table already uses for
    # its own content_id column.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS group_members (
            group_id TEXT NOT NULL,
            content_type TEXT NOT NULL,
            content_id TEXT NOT NULL,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (group_id, content_type, content_id)
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
            FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    # Account-tied third-party integration credentials (currently: Home
    # Assistant's own base_url + access token) — deliberately its own table
    # rather than a key in users.settings (see integrations.py's own header
    # comment): that JSON blob round-trips to the client on every load, and a
    # real secret has no business living somewhere that does. `provider` is a
    # plain string, not an enum, so a second integration later (a different
    # base_url + token shape) is just another row, no schema change.
    # encrypted_token is Fernet ciphertext (integrations.py), never plaintext.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS integration_credentials (
            user_id INTEGER NOT NULL,
            provider TEXT NOT NULL,
            base_url TEXT,
            encrypted_token BLOB,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, provider),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    # The deployment-wide sibling of integration_credentials above — for a
    # third-party credential that's shared by the whole install rather than
    # tied to one account (currently: transcription servers — a GM-managed
    # LIST of them, e.g. one per homelab box, not a single deployment-wide
    # singleton). No user_id at all, deliberately a separate table rather
    # than a NULL/sentinel user_id in integration_credentials — this
    # codebase never turns SQLite FK enforcement on (see the migration
    # functions' own comments below), so a sentinel would technically work
    # today, but a table honestly shaped for "no owner" is worth the few
    # extra lines over relying on that. `(provider, id)` is the composite
    # primary key — `id` is a client-generated key so more than one entry
    # can exist per provider (add/edit/delete/select, same shape as WLED's
    # own known-devices list — see wled.js); `label` is the human-chosen
    # display name. `model` is the model identifier to send in each
    # transcription request's own "model" form field — genuinely per-
    # server, not a suite-wide constant: a self-hosted server only
    # recognizes whatever model it actually has loaded (confirmed real:
    # OpenAI's own "whisper-1" 404's against a self-hosted server that
    # doesn't have a model by that name), so this can't be hardcoded the
    # way it originally was. encrypted_token same Fernet-ciphertext
    # convention as above, still optional — most self-hosted transcription
    # servers need no API key.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS deployment_secrets (
            provider TEXT NOT NULL,
            id TEXT NOT NULL,
            label TEXT,
            base_url TEXT,
            model TEXT,
            encrypted_token BLOB,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (provider, id)
        )
        """
    )
    # A deployment-wide credential's own last-known-good state — currently
    # just the D&D Beyond session cookie (server/ddb_auth_status.py), but
    # `service` is a free-text key, not a DDB-specific column, so any future
    # similar "does this still work" check has somewhere to land without a
    # new table. Deliberately separate from deployment_secrets itself: that
    # table is the credential's VALUE (encrypted), this is a cheap, plain
    # (non-secret) record of whether the last live check against it
    # succeeded — no reason to encrypt a boolean and a timestamp.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS service_status (
            service TEXT PRIMARY KEY,
            checked_at DATETIME,
            valid INTEGER,
            detail TEXT
        )
        """
    )
    # Must run before any index creation below: on a pre-existing database,
    # every CREATE TABLE IF NOT EXISTS above is a no-op against whatever
    # shape that table already has on disk (shares missing
    # shared_with_group_id, or still carrying its old FK against `groups`),
    # so building an index — or, further below, migrating `groups` itself —
    # against a stale shape would fail or silently target the wrong table.
    # A fresh install already has every final shape from the CREATE TABLE
    # statements above, so all of these just no-op there.
    _migrate_groups_table_add_system_id(conn)
    _migrate_groups_table_add_setting_id(conn)
    _migrate_shares_table_for_group_targets(conn)
    _migrate_deployment_secrets_table_for_multi_entry(conn)
    _migrate_deployment_secrets_table_add_model(conn)
    # Group is being migrated onto the same generic library_items/flat-JSON
    # model System/Character/Map already use (see _migrate_groups_to_library_
    # items's own comment) — group_members/shares/group_logs stay relational
    # (they're membership facts and an event log, not part of Group's own
    # document), but their FK against the old bespoke `groups` table has to
    # go, since library_items' primary key is the composite (kind, id), not
    # a bare unique id an FK could point at. SQLite can't ALTER TABLE DROP a
    # FK constraint, so each of these does the same rename/recreate/copy/drop
    # rebuild `_migrate_shares_table_for_group_targets` above already
    # demonstrates. FK enforcement is never turned on for this connection
    # (no PRAGMA foreign_keys anywhere in this codebase), so none of this
    # changes any enforced behavior today — it's schema hygiene so a stale
    # constraint text doesn't reference a table that's about to be renamed
    # away, and so turning enforcement on later wouldn't break silently.
    _migrate_shares_drop_groups_fk(conn)
    _migrate_group_members_drop_groups_fk(conn)
    _migrate_group_logs_drop_groups_fk(conn)
    # Must run AFTER _migrate_group_logs_drop_groups_fk, never before: that
    # migration rebuilds group_logs from a hardcoded old column list (rename
    # to _legacy_group_logs, recreate, copy just those columns, drop) on any
    # database that still carries the old FK — running this addition first
    # would have its new columns silently discarded by that rebuild the very
    # next line. Running after means it always operates on group_logs' final,
    # stable shape.
    _migrate_group_logs_table_add_whisper_columns(conn)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_shares_content ON shares(content_type, content_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(shared_with_user_id)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_share_links_content ON share_links(content_type, content_id)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token)")
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
    _migrate_effect_kind_to_wonder(conn)
    _migrate_groups_to_library_items(state, conn)
    _migrate_seed_group_inventory_property(state, conn)
    _backfill_flat_library_kinds(state)
    _drop_dead_legacy_tables(conn)
    conn.commit()


def _groups_table_exists(conn: sqlite3.Connection) -> bool:
    # `groups` no longer has a CREATE TABLE IF NOT EXISTS of its own (Group is
    # a generic Library kind now — see _migrate_groups_to_library_items) — it
    # only still exists on a database that had real campaigns before this
    # migration shipped, until that migration renames it to `_legacy_groups`.
    # A fresh install never creates it at all, so every migration below that
    # still touches it by name has to check first instead of assuming it's
    # there (PRAGMA table_info on a nonexistent table silently returns
    # nothing rather than erroring, but a bare ALTER TABLE does not).
    row = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='groups'").fetchone()
    return row is not None


def _migrate_groups_table_add_system_id(conn: sqlite3.Connection) -> None:
    # Idempotent add-column migration for databases created before a Group
    # could declare its own System (Section 1.2 of the System-Defined Dice
    # plan) — `groups` predates `system_id` entirely on any pre-existing
    # database. A nullable column needs no full table rebuild (unlike
    # _migrate_shares_table_for_group_targets's NOT NULL relaxation below) —
    # a plain ALTER TABLE ADD COLUMN is safe and cheap to run on every
    # startup once the column already exists.
    if not _groups_table_exists(conn):
        return
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(groups)")}
    if "system_id" in columns:
        return
    conn.execute("ALTER TABLE groups ADD COLUMN system_id TEXT")


def _migrate_groups_table_add_setting_id(conn: sqlite3.Connection) -> None:
    # Same idempotent add-column migration as system_id above, for a Group's
    # own Setting (lets widgets like the Dashboard's Calculator scope
    # System-authored, per-Setting data — e.g. Travel Means — the same way
    # Group.systemId already scopes dice).
    if not _groups_table_exists(conn):
        return
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(groups)")}
    if "setting_id" in columns:
        return
    conn.execute("ALTER TABLE groups ADD COLUMN setting_id TEXT")


def _migrate_group_logs_table_add_whisper_columns(conn: sqlite3.Connection) -> None:
    # Idempotent add-column migration for the Game Log's whisper/@mention and
    # in-character support — same nullable-column-needs-no-rebuild reasoning
    # as _migrate_groups_table_add_system_id above. Unlike that one, no
    # _groups_table_exists guard is needed: group_logs has its own unconditional
    # CREATE TABLE IF NOT EXISTS (this module, above) and is never renamed
    # away the way the old bespoke `groups` table was, so it's always present
    # by the time this runs. recipient_ids is a JSON array string of user ids
    # (NULL/empty = public entry, today's behavior for every pre-existing
    # row); in_character is a plain 0/1 flag. Both default to "absent = the
    # old public/OOC behavior" so no backfill is needed for existing rows.
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(group_logs)")}
    if "recipient_ids" not in columns:
        conn.execute("ALTER TABLE group_logs ADD COLUMN recipient_ids TEXT")
    if "in_character" not in columns:
        conn.execute("ALTER TABLE group_logs ADD COLUMN in_character INTEGER DEFAULT 0")


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
    # No FK on shared_with_group_id even here — a group is a generic Library
    # kind now (see _migrate_groups_to_library_items), so there is no
    # `groups(id)` for this brand-new column to reference in the first
    # place; this used to add that FK and a later migration
    # (_migrate_shares_drop_groups_fk) would immediately remove it again on
    # the very same startup for anyone old enough to hit this branch at all.
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
            FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE
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


def _migrate_deployment_secrets_table_for_multi_entry(conn: sqlite3.Connection) -> None:
    # One-time (idempotent) migration for a database that already has this
    # suite's original single-row-per-provider deployment_secrets shape
    # (provider TEXT PRIMARY KEY, no id/label columns) — the transcription
    # server config briefly shipped that way before becoming a real add/
    # edit/delete list of named servers. SQLite can't redefine a PRIMARY KEY
    # via ALTER TABLE, so this rebuilds the table (rename, recreate via
    # init_storage_db's own CREATE TABLE above, copy rows across, drop the
    # renamed original), same pattern _migrate_shares_table_for_group_targets
    # above uses. Any pre-existing row is preserved under a generated id
    # ("default"), its own base_url doubling as its label, rather than
    # silently dropped — even though it predates this table having any UI to
    # fix a wrong URL, it's still real data someone saved.
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(deployment_secrets)")}
    if not columns or "id" in columns:
        return
    conn.execute("ALTER TABLE deployment_secrets RENAME TO _legacy_deployment_secrets")
    conn.execute(
        """
        CREATE TABLE deployment_secrets (
            provider TEXT NOT NULL,
            id TEXT NOT NULL,
            label TEXT,
            base_url TEXT,
            encrypted_token BLOB,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (provider, id)
        )
        """
    )
    conn.execute(
        """
        INSERT INTO deployment_secrets (provider, id, label, base_url, encrypted_token, updated_at)
        SELECT provider, 'default', base_url, base_url, encrypted_token, updated_at
        FROM _legacy_deployment_secrets
        """
    )
    conn.execute("DROP TABLE _legacy_deployment_secrets")


def _migrate_deployment_secrets_table_add_model(conn: sqlite3.Connection) -> None:
    # Idempotent add-column migration for a deployment_secrets table that
    # predates the "model" column — the transcription server list originally
    # hardcoded "whisper-1" (OpenAI's own model identifier) into every
    # request instead of letting each server declare its own. Confirmed a
    # real bug: a self-hosted server with a different model loaded 404's
    # against that hardcoded value. A nullable column needs no full table
    # rebuild (unlike _migrate_deployment_secrets_table_for_multi_entry's
    # PRIMARY KEY reshape above) — a plain ALTER TABLE ADD COLUMN is safe and
    # cheap to run on every startup once the column already exists. Must run
    # after that migration, not before — this table might not exist in its
    # final (provider, id) shape yet on a database old enough to need both.
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(deployment_secrets)")}
    if not columns or "model" in columns:
        return
    conn.execute("ALTER TABLE deployment_secrets ADD COLUMN model TEXT")


def _table_references_groups(conn: sqlite3.Connection, table_name: str) -> bool:
    # Whether `table_name`'s CURRENT on-disk schema still carries a
    # `REFERENCES groups(` clause — used by the three rebuilds just below to
    # decide whether they still have work to do. A CREATE TABLE IF NOT
    # EXISTS never reconciles an existing table's schema against a changed
    # statement text, so this has to inspect what's actually there rather
    # than assume the CREATE TABLE statements earlier in this file reflect
    # reality on an upgraded database.
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    ).fetchone()
    return bool(row and row["sql"] and "REFERENCES groups(" in row["sql"])


def _migrate_shares_drop_groups_fk(conn: sqlite3.Connection) -> None:
    # Rebuilds `shares` one more time, dropping shared_with_group_id's FK
    # against the old bespoke `groups` table — see this function's own call
    # site comment in init_storage_db for why. Runs independently of
    # _migrate_shares_table_for_group_targets above: that one only fires for
    # a database missing shared_with_group_id entirely, while THIS one fires
    # for anyone who already has that column (with the old FK) from any
    # earlier version of this schema, which by now is most upgraded
    # databases. Same rename/recreate/copy/drop shape, just dropping one FK
    # clause instead of adding a column.
    if not _table_references_groups(conn, "shares"):
        return
    conn.execute("ALTER TABLE shares RENAME TO _legacy_shares2")
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
            FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        INSERT INTO shares (id, content_type, content_id, shared_with_user_id, shared_with_group_id, permissions, created_at)
        SELECT id, content_type, content_id, shared_with_user_id, shared_with_group_id, permissions, created_at
        FROM _legacy_shares2
        """
    )
    conn.execute("DROP TABLE _legacy_shares2")


def _migrate_group_members_drop_groups_fk(conn: sqlite3.Connection) -> None:
    # Same rebuild as _migrate_shares_drop_groups_fk above, for
    # group_members.group_id's own FK against the old `groups` table.
    if not _table_references_groups(conn, "group_members"):
        return
    conn.execute("ALTER TABLE group_members RENAME TO _legacy_group_members")
    conn.execute(
        """
        CREATE TABLE group_members (
            group_id TEXT NOT NULL,
            content_type TEXT NOT NULL,
            content_id TEXT NOT NULL,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (group_id, content_type, content_id)
        )
        """
    )
    conn.execute(
        """
        INSERT INTO group_members (group_id, content_type, content_id, added_at)
        SELECT group_id, content_type, content_id, added_at
        FROM _legacy_group_members
        """
    )
    conn.execute("DROP TABLE _legacy_group_members")


def _migrate_group_logs_drop_groups_fk(conn: sqlite3.Connection) -> None:
    # Same rebuild again, for group_logs.group_id's own FK against the old
    # `groups` table (author_id's own FK against `users` is untouched).
    if not _table_references_groups(conn, "group_logs"):
        return
    conn.execute("ALTER TABLE group_logs RENAME TO _legacy_group_logs")
    conn.execute(
        """
        CREATE TABLE group_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            entry_type TEXT NOT NULL,
            author_id INTEGER,
            author_name TEXT,
            message TEXT,
            payload TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    conn.execute(
        """
        INSERT INTO group_logs (id, group_id, entry_type, author_id, author_name, message, payload, created_at)
        SELECT id, group_id, entry_type, author_id, author_name, message, payload, created_at
        FROM _legacy_group_logs
        """
    )
    conn.execute("DROP TABLE _legacy_group_logs")


def _migrate_groups_to_library_items(state: ServerState, conn: sqlite3.Connection) -> None:
    # One-time (idempotent) migration of the old bespoke `groups` table onto
    # the exact same generic library_items/flat-JSON-file model every other
    # Library kind (System, Character, Map, ...) already uses — Group has no
    # principled reason to have ever worked differently, it just predates
    # this suite's own generic content-kind convention. `group_members`/
    # `group_logs` (relational membership facts / an append-only event log,
    # not part of Group's own document) are untouched by this — they keep
    # referencing a group by the exact same id string, which this migration
    # preserves unchanged, so neither of those tables needs its own rows
    # rewritten. A fresh install never creates a `groups` table at all (see
    # its CREATE TABLE's own removal above), so this is a no-op there.
    if not _groups_table_exists(conn):
        return
    rows = conn.execute("SELECT * FROM groups").fetchall()
    group_root = state.root_dir / "undercroft" / "common" / "data" / "group"
    group_root.mkdir(parents=True, exist_ok=True)
    row_columns = rows[0].keys() if rows else []
    for row in rows:
        group_id = row["id"]
        system_id = row["system_id"] if "system_id" in row_columns else None
        setting_id = row["setting_id"] if "setting_id" in row_columns else None
        payload = {
            "id": group_id,
            "title": row["name"],
            "type": row["type"] or "campaign",
            "systemId": system_id or None,
            "settingId": setting_id or None,
            # The new mechanism this whole migration exists to enable —
            # every pre-existing group simply starts with none defined yet,
            # same as a System's own `fields` would for a brand-new System.
            "properties": [],
            "propertyValues": {},
        }
        write_json(group_root / f"{group_id}.json", payload)
        metadata_fields = {
            key: value
            for key, value in {"type": payload["type"], "systemId": payload["systemId"], "settingId": payload["settingId"]}.items()
            if value is not None
        }
        conn.execute(
            """
            INSERT OR IGNORE INTO library_items
                (kind, id, owner_id, title, is_public, metadata, filename,
                 created_at, modified_at, last_accessed_at)
            VALUES ('group', ?, ?, ?, 0, ?, ?, ?, ?, ?)
            """,
            (
                group_id,
                row["owner_id"],
                row["name"],
                json.dumps(metadata_fields) if metadata_fields else None,
                f"{group_id}.json",
                row["created_at"],
                row["modified_at"],
                row["modified_at"],
            ),
        )
    conn.execute("ALTER TABLE groups RENAME TO _legacy_groups")


def _migrate_seed_group_inventory_property(state: ServerState, conn: sqlite3.Connection) -> None:
    """Backfills the "inventory" Group Property (server/groups.py's own
    create_group/update_group seed it going forward — see
    _default_inventory_property's own comment) onto every campaign that
    predates that convention. Idempotent by construction, not a one-shot
    flag: a group already carrying an "inventory" key (auto-seeded before,
    or one a GM defined by hand under that exact same key) is skipped every
    run, so this is a no-op after the first group is actually backfilled.
    """
    from . import groups as groups_module

    rows = conn.execute("SELECT id FROM library_items WHERE kind = 'group'").fetchall()
    for row in rows:
        group_id = row["id"]
        try:
            payload = load_item_raw(state, "group", group_id)
        except FileNotFoundError:
            continue
        if not isinstance(payload, dict):
            continue
        properties = payload.get("properties")
        if not isinstance(properties, list):
            properties = []
        if any(isinstance(p, dict) and p.get("key") == "inventory" for p in properties):
            continue
        properties.append(groups_module._default_inventory_property(state, payload.get("systemId")))
        payload["properties"] = properties
        write_item_raw(state, "group", group_id, payload)


_DEAD_LEGACY_TABLES = ("_legacy_characters", "_legacy_templates", "_legacy_systems", "_legacy_groups")


def _drop_dead_legacy_tables(conn: sqlite3.Connection) -> None:
    # _migrate_legacy_buckets_to_library_items/_migrate_groups_to_library_items
    # (below/above) rename the old bespoke tables to _legacy_{name} rather
    # than dropping them outright, but every idempotency check in both
    # functions keys off the ORIGINAL table name ("characters"/"templates"/
    # "systems"/"groups"), never the renamed one — so once a table has been
    # renamed away it is permanently dead weight in the database file:
    # nothing in this codebase ever reads a _legacy_* table again. Safe to
    # actually drop it here instead of leaving it around forever.
    existing = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for table in _DEAD_LEGACY_TABLES:
        if table in existing:
            conn.execute(f"DROP TABLE {table}")


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


def _migrate_effect_kind_to_wonder(conn: sqlite3.Connection) -> None:
    # One-time (but idempotent — safe to run on every startup, same
    # convention as every other migration in this file) rename of the
    # Library kind id "effect" -> "wonder" (undercroft/common/data/kind/
    # wonder.json, undercroft/common/data/wonder/) — "Effect" was Vault's own
    # catch-all for a generated spell/magic-item record, freed up for
    # Orrery's newer, unrelated Shapes & Effects particle system. Must run
    # BEFORE _backfill_flat_library_kinds below: that function walks
    # common/data/{kind}/ directories and treats any (kind, id) pair with no
    # existing library_items row as brand-new content to backfill (admin-
    # owned, public) — if these rows were still sitting at kind='effect'
    # while the directory itself had already been renamed to wonder/, every
    # one of them would look "new" and silently lose its real
    # owner/sharing/privacy. `shares`/`share_links`/`group_members` all key
    # off this same kind string too (as `content_type`), not just
    # library_items, so all four need the same rename to keep any existing
    # sharing/group-membership grants pointed at a record that still exists.
    for table, column in (
        ("library_items", "kind"),
        ("shares", "content_type"),
        ("share_links", "content_type"),
        ("group_members", "content_type"),
    ):
        conn.execute(f"UPDATE {table} SET {column} = 'wonder' WHERE {column} = 'effect'")


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


def _admin_user_id(state: ServerState) -> Optional[int]:
    row = state.db.execute("SELECT id FROM users WHERE tier = 'admin' ORDER BY id LIMIT 1").fetchone()
    return row["id"] if row else None


def _sync_library_kind_directory(state: ServerState, kind: str) -> None:
    # Self-heals library_items rows for files that exist on disk but aren't
    # indexed yet — content added outside save_item() (hand-authored JSON,
    # seeded/imported files) used to be invisible in listings, and outright
    # denied by get_item() (is_owner/is_shared/is_public all treat a rowless
    # record as absent), until the next server restart re-ran
    # _backfill_flat_library_kinds() at startup.
    #
    # Gated on the kind directory's own mtime (one cheap stat() call) so the
    # actual glob+query only runs when something on disk has actually
    # changed since this kind was last synced — adding or removing a file
    # changes its parent directory's mtime, editing an existing tracked
    # file's own contents does not, which is exactly the distinction that
    # matters here. Confirmed real regression running this unconditionally
    # on every single list_bucket()/get_item() call: a full directory
    # enumeration on every request, measurably slow against this repo's
    # Nextcloud-synced data folder (same sync-client overhead write_json's
    # own WinError-5 retry comment already documents). On an unchanged
    # directory this is now just one stat() call.
    # Called from list_bucket()/get_item(), both `unlocked` routes (see
    # router.py's Route.unlocked) — the existence check below reads via
    # state.read_db (safe lock-free), but the actual insert is a real write,
    # so it goes through state.db under state.lock explicitly, same as
    # get_user_by_session's own write branches.
    kind_dir = library_kind_root(state, kind)
    try:
        current_mtime = kind_dir.stat().st_mtime
    except OSError:
        return
    if state.library_kind_synced_mtimes.get(kind) == current_mtime:
        return
    existing_ids = {
        row["id"] for row in state.read_db.execute("SELECT id FROM library_items WHERE kind = ?", (kind,))
    }
    entries = [entry for entry in kind_dir.glob("*.json") if entry.stem not in existing_ids]
    if entries:
        policy = load_kind_policy(state, kind)
        with state.lock:
            admin_id = _admin_user_id(state)
            for entry in entries:
                try:
                    payload = json.loads(entry.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    payload = {}
                title = _title_from_payload(kind, payload, policy) or entry.stem
                metadata = _extract_metadata(kind, payload, policy)
                file_ts = datetime.utcfromtimestamp(entry.stat().st_mtime).isoformat()
                state.db.execute(
                    """
                    INSERT INTO library_items
                        (kind, id, owner_id, title, is_public, metadata, filename, created_at, modified_at, last_accessed_at)
                    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
                    ON CONFLICT(kind, id) DO NOTHING
                    """,
                    (kind, entry.stem, admin_id, title, metadata, entry.name, file_ts, file_ts, file_ts),
                )
            state.db.commit()
    # Recorded even when `entries` was empty — an empty result still proves
    # this mtime was fully checked, so the next call with the same mtime can
    # skip straight past the guard above again.
    state.library_kind_synced_mtimes[kind] = current_mtime


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
    _replace_with_retry(temp_path, path)


# This repo lives inside a live-synced Nextcloud folder — on Windows, renaming
# a file onto an existing destination (the atomic-write pattern above) can
# transiently fail with WinError 5 ("Access is denied") when the sync client
# briefly opens the just-changed file (without FILE_SHARE_DELETE) to
# hash/queue it for upload at the exact instant this replace runs. Confirmed
# real: intermittent "[WinError 5] ... .tmp -> ...json" toasts on ordinary
# saves (e.g. an encounter's own combat state) with no other explanation —
# the lock is always brief, so a short retry loop resolves it silently
# instead of surfacing a raw OS exception as a save-failure toast.
#
# The original 6-attempt/~3s budget below wasn't enough during an actual
# multi-hour GM session: Combat Tracker's own frequent autosaves (markDirty
# -> debounced persist, see combat-tracker.js) kept the same encounter file
# changing often enough that Nextcloud's sync client stayed busy with it for
# well past 3 seconds at a stretch, so the retry loop exhausted and every
# save failed outright, over and over, for the same record. Two changes:
# a longer, capped-backoff budget (~9s instead of ~3s) covers a longer
# contention window without making a single save hang indefinitely, and a
# direct write-in-place fallback (real if that's still not enough) — it
# uses a different Windows file-open mode than the rename above
# (CreateFile-for-write vs MoveFileEx), and in practice succeeds even while
# the rename can't, since it never has to unlink/replace the directory
# entry the sync client is watching. This is a genuine, if rare, loss of
# the atomic-write guarantee (a crash mid-write here could leave a partially
# written destination, unlike the rename path), but for a single local
# process saving its own data, "eventually succeeds" beats "fails outright
# after burning the whole retry budget, repeatedly, for the length of an
# entire session." The rename path stays the default and is always tried
# first — this is a last resort, not a replacement for it.
def _replace_with_retry(source: Path, destination: Path, attempts: int = 10, initial_delay: float = 0.05) -> None:
    delay = initial_delay
    for attempt in range(attempts):
        try:
            source.replace(destination)
            return
        except OSError:
            if attempt == attempts - 1:
                break
            time.sleep(delay)
            delay = min(delay * 2, 1.0)
    for attempt in range(3):
        try:
            destination.write_bytes(source.read_bytes())
            source.unlink(missing_ok=True)
            return
        except OSError:
            if attempt == 2:
                raise
            time.sleep(delay)


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

    _sync_library_kind_directory(state, kind)
    ensure_read_role(state, kind, user)
    public = _flatten_metadata_rows(
        [
            dict(row)
            for row in state.read_db.execute(
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
                for row in state.read_db.execute(
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
                for row in state.read_db.execute(
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
        # to be avoided in the query itself. Imported here, not at module
        # level — groups.py now itself imports this module's get_item/
        # save_item/load_json/write_json (Group is a generic Library kind
        # now too), and a top-level import on both sides would cycle.
        from .groups import accessible_group_ids

        group_ids = accessible_group_ids(state, user)
        group_placeholders = ",".join("?" for _ in group_ids) if group_ids else "NULL"
        shared_rows = [
            dict(row)
            for row in state.read_db.execute(
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


# Fixes the N+1 that used to sit behind every generator tool and Repository
# opening (common/js/lib/content-fetch.js's own fetchKindEntriesWithIds,
# which used to fetch a kind's metadata list, then issue one full HTTP
# request PER RECORD to get bodies) — Vault alone was firing ~118 request
# batches to open with today's ~1,400 Features. Modeled directly on
# search_content's own "read N files off disk in one request" precedent
# just above, not a new pattern: reuses list_bucket's exact owned/shared/
# public access rows (so this can never grant broader access than the
# normal list endpoint already does — no separate authorization logic to
# drift out of sync), then narrows by `ids` and/or `system_ids` BEFORE
# touching disk, then reads only the surviving files. `system_ids` only
# narrows anything for a kind that actually declares systemIds in its own
# metadataFields (common/data/kind/{kind}.json) — see _extract_metadata's
# own comment; a kind that doesn't declare it simply won't have the field
# on its rows here, and a filter request against it correctly excludes
# everything rather than silently ignoring the filter. Returns
# `[{"id": ..., "body": ...}, ...]` — NOT a bare list of bodies — since a
# record's own JSON doesn't always embed its own id (see the loop's own
# comment below); pairing each body with its library_items row's
# authoritative id is what get_item's single-record path effectively gets
# for free (the caller already knows the id it asked for), which this
# bulk path has to do explicitly instead.
def get_items_bulk(
    state: ServerState,
    kind: str,
    user: Optional[User],
    ids: Optional[List[str]] = None,
    system_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    buckets = list_bucket(state, kind, user)
    if "files" in buckets:
        # A static asset mount (sheets/codex/loom-mappings, see list_bucket's
        # own comment), not a Library kind — nothing here has a body to bulk-
        # fetch through this path.
        return []

    rows: Dict[str, Dict[str, Any]] = {}
    for group in ("owned", "shared", "public"):
        for row in buckets.get(group, []):
            rows.setdefault(row["id"], row)

    wanted_ids = set(ids) if ids else None
    wanted_systems = set(system_ids) if system_ids else None
    bodies: List[Dict[str, Any]] = []
    for id_, row in rows.items():
        if wanted_ids is not None and id_ not in wanted_ids:
            continue
        if wanted_systems is not None:
            row_systems = set(row.get("systemIds") or [])
            # An entry with NO systemIds is treated as universal (applies to
            # every System), not excluded — the exact semantics Vault/
            # Crucible/Sanctum's own tables.js already had client-side
            # (`!ids.length || ids.includes(systemId)`) before this filter
            # moved server-side; a row-less-strict-than-requested entry
            # silently disappearing from results would be a real regression,
            # not just a stricter filter.
            if row_systems and not (row_systems & wanted_systems):
                continue
        try:
            body = load_json(_record_path(state, kind, id_))
        except (FileNotFoundError, OSError, json.JSONDecodeError, ValueError):
            # A row exists in library_items but its file is missing/corrupt —
            # same defensive skip search_content already uses just above,
            # rather than failing the whole bulk response over one bad record.
            continue
        # Paired with the row's own AUTHORITATIVE id, not assumed to be
        # embedded in the body — same reason get_item's single-record path
        # never stamps id onto what it returns either: plenty of kinds don't
        # duplicate their own id inside the JSON at all (the id is the
        # filename/library_items row, see e.g. Forge's own Location loader
        # comment on this exact convention). Confirmed real bug from an
        # earlier version of this function that returned bare bodies: any
        # record without a self-embedded id came back with id=undefined on
        # the client, breaking every consumer that reads `entry.id`/
        # `feature.id` off the result (Crucible's Locked Features checklist
        # crashed on `feature.name.toLowerCase()` — both name AND id ended
        # up undefined for such a record).
        bodies.append({"id": id_, "body": body})
    return bodies


# Kinds excluded from the suite-wide search — `kind` is the meta-registry of
# kind DEFINITIONS (not end-user content), `relationship` is a graph edge
# record with no meaningful title/label a search result could show. Every
# other kind (including `journal`, Repository's own pages) is just another
# Library kind by this point, searched identically.
SEARCH_EXCLUDED_KINDS = ("kind", "relationship")


# Every record this user can access across every searchable kind, with NO
# text filter — the title/body/reference passes in search_content() below
# all need to look inside the same accessible set, not just whichever rows
# happen to title-match. Same owned/shared/admin-bypass rule list_bucket
# enforces per-kind, just spanning every kind at once.
def _accessible_library_rows(state: ServerState, user: User) -> List[Dict[str, Any]]:
    excluded_placeholders = ",".join("?" for _ in SEARCH_EXCLUDED_KINDS)
    if str(user.tier).lower() == "admin":
        rows = [
            dict(row)
            for row in state.read_db.execute(
                f"""
                SELECT li.*, u.username AS owner_username, u.tier AS owner_tier
                FROM library_items li
                LEFT JOIN users u ON u.id = li.owner_id
                WHERE li.kind NOT IN ({excluded_placeholders})
                """,
                SEARCH_EXCLUDED_KINDS,
            )
        ]
        return _flatten_metadata_rows(rows)

    owned_rows = [
        dict(row)
        for row in state.read_db.execute(
            f"""
            SELECT li.*, u.username AS owner_username, u.tier AS owner_tier
            FROM library_items li
            LEFT JOIN users u ON u.id = li.owner_id
            WHERE li.kind NOT IN ({excluded_placeholders}) AND li.owner_id = ?
            """,
            (*SEARCH_EXCLUDED_KINDS, user.id),
        )
    ]

    from .groups import accessible_group_ids

    group_ids = accessible_group_ids(state, user)
    group_placeholders = ",".join("?" for _ in group_ids) if group_ids else "NULL"
    shared_rows = [
        dict(row)
        for row in state.read_db.execute(
            f"""
            SELECT li.*, s.permissions, u.username AS owner_username, u.tier AS owner_tier
            FROM library_items li
            JOIN shares s ON s.content_id = li.id AND s.content_type = li.kind
            LEFT JOIN users u ON u.id = li.owner_id
            WHERE li.kind NOT IN ({excluded_placeholders})
              AND (s.shared_with_user_id = ? OR s.shared_with_group_id IN ({group_placeholders}))
            """,
            (*SEARCH_EXCLUDED_KINDS, user.id, *group_ids),
        )
    ]

    deduped: Dict[str, Dict[str, Any]] = {}
    for row in owned_rows + shared_rows:
        key = f"{row['kind']}:{row['id']}"
        if key not in deduped:
            deduped[key] = row
    return _flatten_metadata_rows(list(deduped.values()))


# Below this length a string is almost always an id/enum/short label
# ("tier-1", "Minor", a UUID) rather than genuine prose — searching those
# would surface a lot of noise ("fire" matching a "Fire" Rarity value, say)
# without ever being useful as a Wikipedia-style context snippet, so they're
# skipped entirely rather than filtered after the fact.
SEARCH_MIN_BODY_STRING_LENGTH = 12

# Deliberately NOT a full walk of every array field — `systemIds`/
# `settingIds`/`tags.categories` and the like are categorization, not real
# content composition, and matching them would surface unrelated records
# just because they happen to share a System. These four are genuine
# "this record is built FROM that other record" relationships: a Monster/
# Effect/Location's own `featureIds`, or one Feature referencing another via
# synergizesWith/conflictsWith/dependsOn.
SEARCH_REFERENCE_KEYS = ("featureIds", "synergizesWith", "conflictsWith", "dependsOn")


def _collect_searchable_strings(value: Any, acc: List[str]) -> None:
    if isinstance(value, str):
        if len(value) >= SEARCH_MIN_BODY_STRING_LENGTH:
            acc.append(value)
    elif isinstance(value, dict):
        for child in value.values():
            _collect_searchable_strings(child, acc)
    elif isinstance(value, list):
        for child in value:
            _collect_searchable_strings(child, acc)


def _collect_reference_ids(payload: Any) -> set:
    ids: set = set()
    if isinstance(payload, dict):
        for key in SEARCH_REFERENCE_KEYS:
            value = payload.get(key)
            if isinstance(value, list):
                ids.update(entry for entry in value if isinstance(entry, str))
    return ids


# Wikipedia-style "...text before MATCH text after..." context window —
# ellipses only where text was actually cut off, not unconditionally.
def _build_snippet(text: str, query: str, context: int = 50) -> Optional[str]:
    lower_text = text.lower()
    idx = lower_text.find(query.lower())
    if idx == -1:
        return None
    start = max(0, idx - context)
    end = min(len(text), idx + len(query) + context)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{text[start:end].strip()}{suffix}"


# Suite-wide header search (see common/js/lib/suite-search.js) — deep, not
# just title matching: every accessible record's own body text (Repository
# journal pages, NPC/Monster/Effect/Location notes, Feature descriptions,
# tier descriptions, ...) gets searched too, with a Wikipedia-style context
# snippet around the match, and a record that REFERENCES a title-matched
# entity (e.g. a Monster whose featureIds includes a Feature named "Void
# Body") surfaces as its own result even though its own title never matched
# anything. Same owned/shared access rule list_bucket enforces per-kind, but
# across every kind at once. Deliberately does NOT include `public` (unlike
# list_bucket) — the user asked this to search "anything... owned by (or
# shared with) the currently logged in user", not the wider public library.
# Anonymous users get no server results at all (nothing here is theirs to
# own/be shared) — the client-side half of this feature (suite-search.js)
# covers their own local-only saved content instead.
#
# Reads every accessible record's own JSON file off disk once per query —
# no search index, deliberately: at this tool's real scale (one GM's own
# campaign content, not a multi-tenant service), a few hundred small file
# reads after a 250ms debounce is genuinely fine, and building/maintaining a
# real full-text index would be a lot of new infrastructure for a search box
# used by a handful of people at a time.
def search_content(state: ServerState, user: Optional[User], query: str, limit: int = 20) -> List[Dict[str, Any]]:
    query = (query or "").strip()
    if not user or not query:
        return []
    needle = query.lower()

    rows = _accessible_library_rows(state, user)

    title_results: List[Dict[str, Any]] = []
    body_results: List[Dict[str, Any]] = []
    reference_candidates: List[tuple] = []
    matched_entities: Dict[str, Dict[str, str]] = {}

    for row in rows:
        kind = row["kind"]
        id_ = row["id"]
        title = row.get("title") or id_
        is_title_match = needle in title.lower()
        if is_title_match:
            entry = dict(row)
            entry["match_type"] = "title"
            title_results.append(entry)
            matched_entities[id_] = {"kind": kind, "title": title}

        try:
            payload = load_json(_record_path(state, kind, id_))
        except (FileNotFoundError, OSError, json.JSONDecodeError, ValueError):
            payload = None
        if payload is None:
            continue

        if not is_title_match:
            strings: List[str] = []
            _collect_searchable_strings(payload, strings)
            for text in strings:
                if needle in text.lower():
                    snippet = _build_snippet(text, query)
                    if snippet:
                        entry = dict(row)
                        entry["match_type"] = "body"
                        entry["snippet"] = snippet
                        body_results.append(entry)
                    break

        reference_ids = _collect_reference_ids(payload)
        if reference_ids:
            reference_candidates.append((row, title, reference_ids))

    reference_results: List[Dict[str, Any]] = []
    for row, _title, reference_ids in reference_candidates:
        for ref_id in reference_ids:
            matched = matched_entities.get(ref_id)
            if not matched:
                continue
            entry = dict(row)
            entry["match_type"] = "reference"
            entry["snippet"] = f"References {matched['kind'].replace('-', ' ').title()}: {matched['title']}"
            reference_results.append(entry)
            break  # one reference snippet per record is enough

    deduped: Dict[str, Dict[str, Any]] = {}
    for entry in title_results + body_results + reference_results:
        key = f"{entry['kind']}:{entry['id']}"
        if key not in deduped:
            deduped[key] = entry
    results = list(deduped.values())
    # Two stable sorts, not one compound key — modified_at wants descending
    # (newest first) while match_type wants ascending (title, then body,
    # then reference), and Python's sort being stable means sorting by the
    # secondary key first, then the primary key, produces exactly that
    # combined order.
    match_type_rank = {"title": 0, "body": 1, "reference": 2}
    results.sort(key=lambda entry: entry.get("modified_at") or "", reverse=True)
    results.sort(key=lambda entry: match_type_rank.get(entry.get("match_type"), 3))
    return results[:limit]


def is_owner(state: ServerState, kind: str, id_: str, user: Optional[User]) -> bool:
    # Pure read — called from both unlocked routes (get_item/list_bucket) and
    # still-locked write paths (save_item/delete_item, via do_POST). read_db
    # is safe either way: a POST handler's own writes via state.db haven't
    # committed yet at the point this runs (this check always precedes the
    # actual write in every caller), and once committed, WAL mode's normal
    # multi-connection semantics mean read_db sees it immediately on its next
    # query — no staleness, just no lock needed to get there.
    if not user:
        return False
    if str(getattr(user, "tier", "")).lower() == "admin":
        return True
    row = state.read_db.execute(
        "SELECT owner_id FROM library_items WHERE kind = ? AND id = ?",
        (kind, id_.replace(".json", "")),
    ).fetchone()
    if not row:
        return False
    return row["owner_id"] == user.id


def is_shared(state: ServerState, kind: str, id_: str, user: Optional[User], require_edit: bool = False) -> bool:
    # Pure read — see is_owner's own comment on why read_db is safe from
    # both unlocked and still-locked callers.
    if not user:
        return False
    content_id = id_.replace(".json", "")
    row = state.read_db.execute(
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
    # query directly. Local import — see list_bucket's own comment on why.
    from .groups import user_can_access_group

    group_rows = state.read_db.execute(
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
    # Pure read — see is_owner's own comment on why read_db is safe from
    # both unlocked and still-locked callers.
    row = state.read_db.execute(
        "SELECT is_public FROM library_items WHERE kind = ? AND id = ?",
        (kind, id_.replace(".json", "")),
    ).fetchone()
    if not row:
        return True
    return bool(row["is_public"])


def _character_visible_via_group_roster(state: ServerState, character_id: str, user: Optional[User]) -> bool:
    # A character added to a campaign's own party roster (group_members,
    # content_type='character' — Loom/Workbench's "add to party" action) is
    # meant to be visible to that campaign's whole table, the same way an
    # anonymous share-link viewer already gets a group-roster grant (see
    # get_item's own share_token branch above) — but that grant never
    # extended to real, logged-in fellow party members, who previously had
    # NO read path to a teammate's character at all unless it also had its
    # own explicit `shares` row. Confirmed real bug: none of a live
    # campaign's own party characters had ever been individually shared,
    # so every OTHER player's client (Map's live HP/condition badge,
    # eventually Combat Tracker) silently 401'd trying to read a fellow
    # party member's own character. Pure read — see is_owner's own comment
    # on why read_db is safe from both unlocked and still-locked callers.
    if not user:
        return False
    from .groups import user_can_access_group

    rows = state.read_db.execute(
        "SELECT group_id FROM group_members WHERE content_type = 'character' AND content_id = ?",
        (character_id,),
    ).fetchall()
    return any(user_can_access_group(state, row["group_id"], user) for row in rows)


def _template_visible_via_group(state: ServerState, template_id: str, user: Optional[User]) -> bool:
    """A campaign's own Party Template (Group.templateId) is meant to be
    readable by every member of that campaign, the same reasoning as
    _character_visible_via_group_roster just above (a teammate's own
    character) — confirmed real bug this fixes: Workbench's "Party Data"
    view (workbench-character-view.js's loadGroupPartyView/
    loadTemplateById) 401'd loading a campaign's own Party Template for
    any real member who wasn't its owner, even though that whole feature
    exists ONLY to show players the Group-bound fields authored on that
    exact template. Scans every group's own cheap metadata column (not a
    full JSON-file read per group) rather than an indexed lookup — this
    suite runs at small-campaign-count scale, same assumption
    _character_visible_via_group_roster's own group_members scan already
    makes.
    """
    if not user or not template_id:
        return False
    from .groups import user_can_access_group

    rows = state.read_db.execute("SELECT id, metadata FROM library_items WHERE kind = 'group'").fetchall()
    for row in rows:
        if not row["metadata"]:
            continue
        try:
            metadata = json.loads(row["metadata"])
        except json.JSONDecodeError:
            continue
        if metadata.get("templateId") != template_id:
            continue
        if user_can_access_group(state, row["id"], user):
            return True
    return False


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
    _sync_library_kind_directory(state, kind)
    token_info = resolve_share_token(state, share_token or "") if share_token else None
    share_granted = False
    if token_info:
        token_type = token_info.get("content_type")
        token_target = token_info.get("content_id")
        if token_type == kind and token_target == base_id:
            share_granted = True
            touch_share_link(state, token_info.get("token", ""))
        elif token_type == "group" and kind == "character" and token_target:
            # `g` and `li` are the SAME library_items table, joined against
            # itself under two aliases — a group's own row (kind='group') for
            # its owner_id, and the target character's row (kind='character')
            # for its own. Group is a generic Library kind now too (see
            # _migrate_groups_to_library_items), so there's no separate
            # `groups` table to join against any more.
            row = state.read_db.execute(
                """
                SELECT g.owner_id AS group_owner_id,
                       li.owner_id AS character_owner_id
                FROM library_items AS g
                JOIN group_members AS gm ON gm.group_id = g.id
                LEFT JOIN library_items AS li ON li.kind = 'character' AND li.id = gm.content_id
                WHERE g.kind = 'group'
                  AND g.id = ?
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
            # currently being projected to the table right now." Local
            # import — see list_bucket's own comment on why.
            from .groups import get_active_spotlights

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
        or (kind == "character" and _character_visible_via_group_roster(state, base_id, user))
        or (kind == "template" and _template_visible_via_group(state, base_id, user))
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


def load_item_raw(state: ServerState, kind: str, id_: str) -> Dict[str, Any]:
    """Loads a kind's JSON payload directly from disk with NO ownership/
    sharing/tier checks and no last-accessed touch — for server-side callers
    (groups.py's own Group document access, mainly) that have already done
    their own authorization and just need the raw content. Not a
    general-purpose "read any kind" escape hatch for request handlers — real
    HTTP reads always go through get_item above."""
    return load_json(_record_path(state, kind, id_))


def write_item_raw(state: ServerState, kind: str, id_: str, payload: Dict[str, Any]) -> None:
    """Writes a kind's JSON payload directly to disk with NO ownership/
    sharing/tier checks, and does NOT touch library_items at all (unlike
    save_item, which also upserts title/metadata/modified_at there) — for a
    caller whose OWN permission model doesn't fit save_item's coarse
    owner-or-edit-share gate (groups.py's per-property value writes, where a
    plain party member with neither may still write ONE property marked
    `public`) and who will do its own library_items bookkeeping afterward."""
    write_json(_record_path(state, kind, id_), payload)


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
    if normalize_kind(kind) == "kind":
        invalidate_kind_policy(state, base_id)
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


_RENAME_SAME_KIND_ARRAY_KEYS = {"synergizesWith", "dependsOn", "conflictsWith", "connectedTo"}


# Recursively repairs, IN PLACE, every reference to (kind, old_id) found
# inside `value` — the body of one OTHER record (rename_item below calls
# this once per record in the whole database). Four shapes are recognized,
# covering every reference convention this suite is confirmed to actually
# use (see rename_item's own docstring for the full reasoning on each):
#   1. A sibling {refKind|kind, refId} pair (Character.subclass/spells/
#      inventory, Sanctum Assets/Needs, map marker contents, shop stock, ...)
#      — refKind/kind must equal the kind being renamed.
#   2. An object literally KEYED by the old id (Wonder/Monster/etc's own
#      featureTiers/featureParams, e.g. featureParams["feat.old-id"]) — only
#      when kind == "feature", the only kind this convention is used for.
#   3. `featureIds` — a plain string array, cross-kind (appears on
#      Character/Monster/NPC/Location/Wonder/...) — only when kind ==
#      "feature".
#   4. A same-kind self-reference array (synergizesWith/dependsOn/
#      conflictsWith/connectedTo) or the `parentId` scalar (Location) — only
#      matched on a record whose OWN kind equals the kind being renamed,
#      since these arrays hold plain id strings with no independent kind
#      marker of their own (record_kind scoping is what keeps this from
#      colliding with an unrelated same-string id in a different kind).
def _repair_references_in_value(value, key, record_kind, kind, old_id, new_id, stats):
    if isinstance(value, dict):
        ref_kind = value.get("refKind") or value.get("kind")
        if ref_kind == kind and value.get("refId") == old_id:
            value["refId"] = new_id
            stats["count"] += 1
        if kind == "feature" and old_id in value:
            value[new_id] = value.pop(old_id)
            stats["count"] += 1
        if kind == "location" and value.get("parentId") == old_id:
            value["parentId"] = new_id
            stats["count"] += 1
        for child_key, child_value in list(value.items()):
            _repair_references_in_value(child_value, child_key, record_kind, kind, old_id, new_id, stats)
    elif isinstance(value, list):
        if (record_kind == kind and key in _RENAME_SAME_KIND_ARRAY_KEYS) or (key == "featureIds" and kind == "feature"):
            for i, item in enumerate(value):
                if item == old_id:
                    value[i] = new_id
                    stats["count"] += 1
        for item in value:
            _repair_references_in_value(item, key, record_kind, kind, old_id, new_id, stats)


# Admin-only (gated by the caller — Loom's own Rename action). Renames a
# Library record's own id — the filename, the library_items row, and (when
# present — Feature is the confirmed kind that embeds one; most kinds don't,
# per this suite's own "id is never body content" convention) the body's own
# "id" field — then sweeps every OTHER record in the whole database
# and repairs any reference to the old id via _repair_references_in_value
# above. `dry_run=True` performs the exact same sweep and returns the exact
# same impact summary WITHOUT writing anything back — Loom's own confirmation
# prompt calls this first to show what would change, then calls again with
# dry_run=False once the GM confirms. NOT covered: a Group Property whose own
# KEY embeds an id (shop-transactions.js's `shop:<locationId>` — renaming a
# Location with an open shop leaves that property under its old key; the
# ITEMS inside it still get repaired normally via the sweep below, since
# they're ordinary {refKind,refId} pairs nested in the group's own body).
def rename_item(
    state: ServerState, kind: str, old_id: str, new_id: str, user: Optional[User], dry_run: bool = False
) -> Dict[str, Any]:
    if not user or user.tier != "admin":
        raise AuthError("Admin only")
    old_id = old_id.replace(".json", "").strip()
    new_id = new_id.replace(".json", "").strip()
    if not old_id or not new_id:
        raise AuthError("Missing id")
    if old_id == new_id:
        raise AuthError("The new id is the same as the current one")
    if not re.match(r"^[A-Za-z0-9_.-]+$", new_id):
        raise AuthError("The new id can only contain letters, numbers, '.', '_', and '-'")
    existing = state.db.execute("SELECT 1 FROM library_items WHERE kind = ? AND id = ?", (kind, old_id)).fetchone()
    if not existing:
        raise AuthError("Record not found")
    conflict = state.db.execute("SELECT 1 FROM library_items WHERE kind = ? AND id = ?", (kind, new_id)).fetchone()
    if conflict:
        raise AuthError(f'A {kind} with id "{new_id}" already exists')

    stats = {"count": 0}
    touched: List[Dict[str, Any]] = []
    rows = state.db.execute("SELECT kind, id FROM library_items").fetchall()
    for row in rows:
        record_kind, record_id = row["kind"], row["id"]
        if record_kind == kind and record_id == old_id:
            continue  # the record being renamed — handled separately below
        path = _record_path(state, record_kind, record_id)
        try:
            body = load_json(path)
        except (FileNotFoundError, OSError, json.JSONDecodeError, ValueError):
            continue
        if not isinstance(body, dict):
            continue
        before = stats["count"]
        _repair_references_in_value(body, None, record_kind, kind, old_id, new_id, stats)
        if stats["count"] > before:
            touched.append({"kind": record_kind, "id": record_id, "count": stats["count"] - before})
            if not dry_run:
                write_json(path, body)

    if not dry_run:
        old_path = _record_path(state, kind, old_id)
        new_path = _record_path(state, kind, new_id)
        body = load_json(old_path)
        # `id` (when a kind embeds one — Feature is the confirmed case) is
        # THIS record's own identity, so it moves with the rename. `index`
        # (Wonder's own 5e-API-import provenance, e.g. "potion-of-giant-
        # strength-fire") is deliberately left untouched even when it
        # happens to equal old_id — it records the ORIGINAL external
        # source id this record was imported from, not a second copy of its
        # own local id; renaming it here would erase that provenance for no
        # functional benefit (nothing in this app ever reads it for lookups).
        if isinstance(body, dict) and body.get("id") == old_id:
            body["id"] = new_id
        write_json(new_path, body)
        old_path.unlink()
        now_ts = datetime.utcnow().isoformat()
        state.db.execute(
            "UPDATE library_items SET id = ?, filename = ?, modified_at = ? WHERE kind = ? AND id = ?",
            (new_id, _record_filename(new_id), now_ts, kind, old_id),
        )
        # Same two tables delete_item's own cleanup touches — a rekey here
        # instead of a delete, so an existing share/share-link survives the
        # rename pointing at the record's new id.
        state.db.execute("UPDATE shares SET content_id = ? WHERE content_type = ? AND content_id = ?", (new_id, kind, old_id))
        state.db.execute(
            "UPDATE share_links SET content_id = ? WHERE content_type = ? AND content_id = ?", (new_id, kind, old_id)
        )
        state.db.commit()
        if normalize_kind(kind) == "kind":
            invalidate_kind_policy(state, old_id)
            invalidate_kind_policy(state, new_id)

    return {
        "ok": True,
        "kind": kind,
        "oldId": old_id,
        "newId": new_id,
        "dryRun": dry_run,
        "referenceCount": stats["count"],
        "touched": touched,
    }


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
