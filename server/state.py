from __future__ import annotations

import logging
import sqlite3
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, Tuple

from .config import ConfigLoader, MountConfig, ServerConfig


# A burst of clicks from an idle/unwatched group shouldn't grow
# ServerState.pending_pings unbounded — only the most recent handful ever
# matter, since pings are meant to fade within a couple of seconds on the
# client anyway.
MAX_PINGS_PER_GROUP = 20
# Same reasoning as MAX_PINGS_PER_GROUP above, for the dice-roll broadcast
# bucket (Cards/Decks plan, Part 2) — a Broadcast-mode roll is meant to
# animate within seconds of being seen; nothing older than a handful of
# rolls back is ever worth relaying to a client that just connected.
MAX_DICE_ROLL_BROADCASTS_PER_GROUP = 20
# Same reasoning, for the card-draw broadcast bucket (Cards/Decks plan,
# Part 5 revised).
MAX_CARD_BROADCASTS_PER_GROUP = 20
# Same reasoning, for the Shapes/Effects re-trigger broadcast bucket
# (Shapes & Effects plan, Part 5) — "replay this already-placed element
# now," never persisted.
MAX_EFFECT_BROADCASTS_PER_GROUP = 20


def _tune_connection(db: sqlite3.Connection) -> None:
    # WAL + NORMAL turns most commits into a log-append instead of a full
    # fsync of the main database file — SQLite's own documented pairing.
    # Plain sqlite3.connect() defaults (rollback journal, synchronous=FULL)
    # made every commit here a full fsync, which is especially slow when
    # the database file lives inside a cloud-synced folder (e.g. Nextcloud)
    # rather than a plain local disk.
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")


def _open_read_connection(path: str) -> sqlite3.Connection:
    # One thread's own dedicated connection, used ONLY for reads on routes
    # audited to be write-free on their own (see router.py's Route.unlocked,
    # do_GET's own comment, and ServerState.read_db's property below). A
    # single connection object shared across threads was the first version of
    # this — confirmed real, serious bug: even though sqlite3.threadsafety ==
    # 3 in this environment (SQLite's own C library, compiled "serialized",
    # genuinely safe for concurrent multi-threaded use of one connection),
    # the Python sqlite3 DB-API wrapper around it is NOT — a real 16-thread
    # concurrency stress test against a shared read connection produced
    # actual `InterfaceError: bad parameter or other API misuse` failures.
    # One connection per thread (see the read_db property, which lazily opens
    # and caches exactly one of these per thread via threading.local) sidesteps
    # that entirely: each connection object is only ever touched by the one
    # thread that owns it. Cheap to do — SQLite connections are lightweight,
    # especially in WAL mode where readers never block each other or the
    # writer.
    #
    # PRAGMA query_only is a cheap belt-and-suspenders guard: if an unaudited
    # write ever gets routed through one of these by mistake, it fails loudly
    # (OperationalError) instead of silently racing the real write connection
    # (ServerState.db) below.
    #
    # isolation_level=None (autocommit) is NOT optional here — confirmed a
    # real, nasty failure mode without it: Python's sqlite3 driver still
    # implicitly opens a transaction before an INSERT/UPDATE/DELETE even on a
    # query_only connection, and since the statement itself then fails, that
    # transaction is never closed. Every subsequent SELECT on this connection
    # then silently runs inside that same still-open transaction's frozen
    # snapshot — permanently stale reads with no further error, until
    # something calls commit()/rollback(). Autocommit mode never opens that
    # implicit transaction in the first place, so a rejected write attempt
    # (which should never happen, but see the comment above) fails once and
    # leaves every later read on this same connection unaffected, instead of
    # quietly breaking them all for the rest of the process's life.
    connection = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


@dataclass
class ServerState:
    config_loader: ConfigLoader
    config: ServerConfig
    db: sqlite3.Connection
    mounts: Dict[str, MountConfig]
    lock: threading.RLock
    root_dir: Path
    # In-memory, unflushed `library_items.last_accessed_at` updates — see
    # record_touch()/storage.flush_pending_touches(). Deliberately its own
    # lock, separate from the broad request-serializing `lock` above, so
    # recording a touch during a request never has to wait on (or hold)
    # that lock, and the periodic flush thread only needs `lock` for the
    # brief moment it actually touches the shared `db` connection.
    pending_touches: Dict[Tuple[str, str], str] = field(default_factory=dict)
    touches_lock: threading.Lock = field(default_factory=threading.Lock)
    # Kind registry files (undercroft/common/data/kind/{id}.json) are static
    # at runtime — they're deploy-time/hand-edited data, not written by any
    # route — so kinds.py#load_kind_policy caches its parsed result here for
    # the process lifetime instead of re-reading+re-parsing the same file on
    # every call (some request paths call it more than once). Cleared in
    # reload() below since root_dir can change there.
    kind_policy_cache: Dict[str, Dict[str, object]] = field(default_factory=dict)
    # storage.py#_sync_library_kind_directory's gate: the directory mtime a
    # given kind's library_items rows were last confirmed to match. A file
    # added/removed outside save_item() (hand-authored JSON, seeded/imported
    # content) changes its kind directory's own mtime, so comparing against
    # this cached value turns "re-scan that whole directory on every single
    # list_bucket()/get_item() call" (confirmed real perf regression — a full
    # directory enumeration per request, especially slow against this repo's
    # Nextcloud-synced folder) into "one cheap stat() call when nothing
    # changed." Cleared in reload() below since root_dir can change there.
    library_kind_synced_mtimes: Dict[str, float] = field(default_factory=dict)
    # Ephemeral per-group "ping" events (map pointer clicks) — deliberately
    # NOT persisted to the database or the library_items table at all: a
    # ping is a transient pointer-broadcast, not a saved record, and routing
    # it through the normal save-then-poll path would (a) pollute a map's
    # own undo/edit history with something nobody actually edited and (b)
    # force a real DB write for something that's meant to vanish in seconds.
    # Reuses the exact same "own small in-memory dict + dedicated lock,
    # separate from the broad request-serializing `lock`" shape as
    # pending_touches above, for the same reason: recording a ping during a
    # request should never have to wait on (or block) unrelated requests.
    pending_pings: Dict[str, list] = field(default_factory=dict)
    pings_lock: threading.Lock = field(default_factory=threading.Lock)
    ping_seq: int = 0
    # A Broadcast-mode dice roll's own "go animate this now" signal (Cards/
    # Decks plan, Part 2) — same "transient, in-memory, never a DB write"
    # reasoning as pending_pings above: this is purely "roll this notation
    # on your own screen right now," not a record of what happened (the
    # roll's own group_log entry, posted separately, already is that).
    pending_dice_roll_broadcasts: Dict[str, list] = field(default_factory=dict)
    dice_roll_broadcasts_lock: threading.Lock = field(default_factory=threading.Lock)
    dice_roll_broadcast_seq: int = 0
    # A Broadcast-mode card draw's own "go animate this now" signal (Cards/
    # Decks plan, Part 5 revised) — same shape as pending_dice_roll_broadcasts
    # just above for the identical reason: confirmed real bug reusing the
    # persistent spotlight mechanism for this instead (server/groups.py's own
    # _INLINE_SPOTLIGHT_KINDS) — a card reveal is a one-time animation event,
    # not "currently shown to the table" state, so it kept wrongly (a)
    # replaying on every later page load (a spotlight stays "active" until
    # explicitly cleared) and (b) appearing in the "what's shown to the
    # table" icon tray with nothing meaningful to toggle, unlike every other
    # kind that actually lives there. This is purely "play this reveal right
    # now" — the draw's own group_log entry (deck.js's own handleDraw, type
    # "card") is the separate, persisted record of what happened.
    pending_card_broadcasts: Dict[str, list] = field(default_factory=dict)
    card_broadcasts_lock: threading.Lock = field(default_factory=threading.Lock)
    card_broadcast_seq: int = 0
    # Re-triggers a placed Shape/Effect element's own animation (Shapes &
    # Effects plan, Part 5) — same "transient, never persisted" reasoning as
    # the two buckets just above. Unlike those, the payload only ever needs
    # to say WHICH element to replay (map_id + element_id), not carry the
    # element's own data — every viewer with that map open already has the
    # full element (preset, color, everything) from the map itself.
    pending_effect_broadcasts: Dict[str, list] = field(default_factory=dict)
    effect_broadcasts_lock: threading.Lock = field(default_factory=threading.Lock)
    effect_broadcast_seq: int = 0
    # Backing fields for the read_db property below — not meant to be read or
    # set directly by anything outside this class. _read_local holds one
    # lazily-opened connection per thread (see _open_read_connection's own
    # comment on why this can't be a single shared connection).
    _read_db_path: str = field(default="", repr=False)
    _read_local: threading.local = field(default_factory=threading.local, repr=False, compare=False)

    @property
    def read_db(self) -> sqlite3.Connection:
        connection = getattr(self._read_local, "connection", None)
        if connection is None:
            connection = _open_read_connection(self._read_db_path)
            self._read_local.connection = connection
        return connection

    @classmethod
    def from_loader(cls, loader: ConfigLoader) -> "ServerState":
        config = loader.get()
        db = sqlite3.connect(str(config.database.path), check_same_thread=False)
        db.row_factory = sqlite3.Row
        _tune_connection(db)
        mounts = dict(config.mounts)
        lock = threading.RLock()
        return cls(
            config_loader=loader,
            config=config,
            db=db,
            mounts=mounts,
            lock=lock,
            root_dir=loader.path.resolve().parent,
            _read_db_path=str(config.database.path),
        )

    def reload(self, new_config: ServerConfig | None = None) -> None:
        if new_config is None:
            new_config = self.config_loader.reload()
        with self.lock:
            if Path(new_config.database.path) != Path(self.config.database.path):
                self.db.close()
                self.db = sqlite3.connect(str(new_config.database.path), check_same_thread=False)
                self.db.row_factory = sqlite3.Row
                _tune_connection(self.db)
                self._read_db_path = str(new_config.database.path)
                # Every thread's own cached read connection (see the read_db
                # property) still points at the OLD file — a fresh
                # threading.local means the next state.read_db access on any
                # thread lazily opens a new connection against the new path
                # instead of reusing a stale one. The old per-thread
                # connections are simply dropped, not explicitly closed —
                # this only runs on a rare, admin-triggered config change,
                # not a hot path worth the bookkeeping to close them all.
                self._read_local = threading.local()
            self.config = new_config
            self.mounts = dict(new_config.mounts)
            self.root_dir = self.config_loader.path.resolve().parent
            self.kind_policy_cache = {}
            self.library_kind_synced_mtimes = {}

    def get_mount(self, name: str) -> MountConfig:
        try:
            return self.mounts[name]
        except KeyError:
            raise KeyError(f"Unknown mount '{name}'")

    def record_touch(self, kind: str, id_: str) -> None:
        with self.touches_lock:
            self.pending_touches[(kind, id_)] = datetime.utcnow().isoformat()

    def drain_pending_touches(self) -> Dict[Tuple[str, str], str]:
        with self.touches_lock:
            drained = self.pending_touches
            self.pending_touches = {}
        return drained

    # `data` is the ping's own payload (x, y, by) — opaque to this method,
    # just stamped with a monotonic seq so _handle_live_stream can tell
    # which pings a given connection has already sent (same "int watermark"
    # shape as its own group_log handling, not a modified_at string since
    # there's no backing row at all here).
    def record_ping(self, group_id: str, data: dict) -> int:
        with self.pings_lock:
            self.ping_seq += 1
            seq = self.ping_seq
            bucket = self.pending_pings.setdefault(group_id, [])
            bucket.append({"seq": seq, **data})
            if len(bucket) > MAX_PINGS_PER_GROUP:
                del bucket[: len(bucket) - MAX_PINGS_PER_GROUP]
            return seq

    def get_ping_bucket(self, group_id: str) -> list:
        with self.pings_lock:
            return list(self.pending_pings.get(group_id, []))

    # `data` is the broadcast's own payload ({notation, label}) — opaque
    # here, same as record_ping's own `data` above; just stamped with a
    # monotonic seq so _handle_live_stream can tell which broadcasts a given
    # connection has already relayed.
    def record_dice_roll_broadcast(self, group_id: str, data: dict) -> int:
        with self.dice_roll_broadcasts_lock:
            self.dice_roll_broadcast_seq += 1
            seq = self.dice_roll_broadcast_seq
            bucket = self.pending_dice_roll_broadcasts.setdefault(group_id, [])
            bucket.append({"seq": seq, **data})
            if len(bucket) > MAX_DICE_ROLL_BROADCASTS_PER_GROUP:
                del bucket[: len(bucket) - MAX_DICE_ROLL_BROADCASTS_PER_GROUP]
            return seq

    def get_dice_roll_broadcast_bucket(self, group_id: str) -> list:
        with self.dice_roll_broadcasts_lock:
            return list(self.pending_dice_roll_broadcasts.get(group_id, []))

    def record_card_broadcast(self, group_id: str, data: dict) -> int:
        with self.card_broadcasts_lock:
            self.card_broadcast_seq += 1
            seq = self.card_broadcast_seq
            bucket = self.pending_card_broadcasts.setdefault(group_id, [])
            bucket.append({"seq": seq, **data})
            if len(bucket) > MAX_CARD_BROADCASTS_PER_GROUP:
                del bucket[: len(bucket) - MAX_CARD_BROADCASTS_PER_GROUP]
            return seq

    def get_card_broadcast_bucket(self, group_id: str) -> list:
        with self.card_broadcasts_lock:
            return list(self.pending_card_broadcasts.get(group_id, []))

    def record_effect_broadcast(self, group_id: str, data: dict) -> int:
        with self.effect_broadcasts_lock:
            self.effect_broadcast_seq += 1
            seq = self.effect_broadcast_seq
            bucket = self.pending_effect_broadcasts.setdefault(group_id, [])
            bucket.append({"seq": seq, **data})
            if len(bucket) > MAX_EFFECT_BROADCASTS_PER_GROUP:
                del bucket[: len(bucket) - MAX_EFFECT_BROADCASTS_PER_GROUP]
            return seq

    def get_effect_broadcast_bucket(self, group_id: str) -> list:
        with self.effect_broadcasts_lock:
            return list(self.pending_effect_broadcasts.get(group_id, []))


def configure_logging(level: str) -> None:
    lvl = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(level=lvl, format="[%(asctime)s] %(levelname)s %(message)s")
