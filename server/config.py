from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional


@dataclass
class MountConfig:
    name: str
    type: str
    root: Path
    table: Optional[str] = None
    default_visibility: str = "private"
    read_roles: List[str] = field(default_factory=lambda: ["free"])
    write_roles: List[str] = field(default_factory=lambda: ["master"])
    directory_listing: bool = False

    def validate(self) -> None:
        if self.type not in {"json", "static"}:
            raise ValueError(f"Mount '{self.name}' has unsupported type '{self.type}'")
        if not self.name:
            raise ValueError("Mount name cannot be empty")
        if not self.root:
            raise ValueError(f"Mount '{self.name}' is missing a root path")
        if self.type == "json" and not self.table:
            raise ValueError(f"JSON mount '{self.name}' requires a table name")


@dataclass
class DatabaseConfig:
    path: Path


@dataclass
class ServerOptions:
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origin: str = "*"
    session_ttl_days: int = 7
    config_watch: bool = False
    log_level: str = "info"


@dataclass
class ServerConfig:
    options: ServerOptions
    database: DatabaseConfig
    mounts: Dict[str, MountConfig]

    def ensure_directories(self) -> None:
        db_parent = self.database.path.parent
        db_parent.mkdir(parents=True, exist_ok=True)
        for mount in self.mounts.values():
            mount.root.mkdir(parents=True, exist_ok=True)


class ConfigLoader:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._config = self._read()
        self._mtime = self._file_mtime()

    def _file_mtime(self) -> float:
        try:
            return self.path.stat().st_mtime
        except FileNotFoundError:
            return 0.0

    def _read(self) -> ServerConfig:
        with self.path.open("r", encoding="utf-8") as fp:
            payload = json.load(fp)

        server_opts = payload.get("server", {})
        options = ServerOptions(
            host=server_opts.get("host", "127.0.0.1"),
            port=int(server_opts.get("port", 8000)),
            cors_origin=server_opts.get("cors_origin", "*"),
            session_ttl_days=int(server_opts.get("session_ttl_days", 7)),
            config_watch=bool(server_opts.get("config_watch", False)),
            log_level=server_opts.get("log_level", "info"),
        )

        db_opts = payload.get("database", {})
        db_config = DatabaseConfig(path=Path(db_opts.get("path", "sheets/data/database.sqlite")))

        mounts_payload = payload.get("mounts", [])
        mounts: Dict[str, MountConfig] = {}
        for mount in mounts_payload:
            cfg = MountConfig(
                name=mount["name"],
                type=mount.get("type", "json"),
                root=Path(mount["root"]).expanduser(),
                table=mount.get("table"),
                default_visibility=mount.get("default_visibility", "private"),
                read_roles=list(mount.get("read_roles", ["free"])),
                write_roles=list(mount.get("write_roles", ["master"])),
                directory_listing=bool(mount.get("directory_listing", False)),
            )
            cfg.validate()
            mounts[cfg.name] = cfg

        config = ServerConfig(options=options, database=db_config, mounts=mounts)
        config.ensure_directories()
        return config

    def get(self) -> ServerConfig:
        with self._lock:
            return self._config

    def reload(self) -> ServerConfig:
        with self._lock:
            self._config = self._read()
            self._mtime = self._file_mtime()
            return self._config

    def maybe_reload(self) -> Optional[ServerConfig]:
        current = self._file_mtime()
        with self._lock:
            if current > self._mtime:
                self._config = self._read()
                self._mtime = current
                return self._config
        return None

    def watch(self, callback, poll_interval: float = 1.0, stop_event: Optional[threading.Event] = None) -> threading.Thread:
        def _loop():
            while not (stop_event and stop_event.is_set()):
                updated = self.maybe_reload()
                if updated is not None:
                    callback(updated)
                time.sleep(poll_interval)

        thread = threading.Thread(target=_loop, name="config-watcher", daemon=True)
        thread.start()
        return thread
