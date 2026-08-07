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


def _tune_connection(db: sqlite3.Connection) -> None:
    # WAL + NORMAL turns most commits into a log-append instead of a full
    # fsync of the main database file — SQLite's own documented pairing.
    # Plain sqlite3.connect() defaults (rollback journal, synchronous=FULL)
    # made every commit here a full fsync, which is especially slow when
    # the database file lives inside a cloud-synced folder (e.g. Nextcloud)
    # rather than a plain local disk.
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")


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
            self.config = new_config
            self.mounts = dict(new_config.mounts)
            self.root_dir = self.config_loader.path.resolve().parent
            self.kind_policy_cache = {}

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


def configure_logging(level: str) -> None:
    lvl = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(level=lvl, format="[%(asctime)s] %(levelname)s %(message)s")
