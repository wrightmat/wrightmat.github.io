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
    write_roles: List[str] = field(default_factory=lambda: ["gm"])
    directory_listing: bool = False
    directory_extensions: List[str] = field(default_factory=list)

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
    cors_origin: str = ""
    session_ttl_days: int = 7
    config_watch: bool = False
    log_level: str = "info"
    require_email_verification: bool = False
    debug_verification_codes: bool = False
    # Creates the free/player/gm/creator test accounts on start (never an admin). Development only.
    seed_dev_accounts: bool = False
    # Registration needs a valid invite code (see invites.py).
    require_invite: bool = False
    # Lets a GM embed files from this machine's disk (Browser widget). Local single-user setups only.
    local_file_access: bool = False
    # Addresses of reverse proxies whose X-Forwarded-For header may be believed.
    trusted_proxies: List[str] = field(default_factory=list)
    # Top-level folders of the checkout that are served as static files. Nothing else is reachable.
    static_roots: List[str] = field(default_factory=list)
    # Where everything the server writes lives (Library content, community lists, mappings, page sizes),
    # and where the encryption key and credential files live. Empty means the checkout itself (development).
    data_dir: str = ""
    secrets_dir: str = ""
    # The folder holding the code (undercroft/, server/). Empty means the folder the config file sits in.
    root_dir: str = ""
    # Hosts the /ddb-proxy route is allowed to fetch from — the one place the
    # otherwise system-agnostic core server has to know about a specific
    # third-party game-content service (D&D Beyond). Configurable rather than
    # hardcoded so a fork targeting a different system's content site isn't
    # forced to patch app.py.
    ddb_proxy_allowed_hosts: List[str] = field(
        default_factory=lambda: [
            "www.dndbeyond.com",
            "dndbeyond.com",
            "monster-service.dndbeyond.com",
            "character-service.dndbeyond.com",
        ]
    )


@dataclass
class EmailConfig:
    enabled: bool = False
    sender: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None
    use_tls: bool = True
    use_ssl: bool = False
    timeout: int = 10


@dataclass
class ServerConfig:
    options: ServerOptions
    database: DatabaseConfig
    mounts: Dict[str, MountConfig]
    email: EmailConfig

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
            cors_origin=server_opts.get("cors_origin", ""),
            session_ttl_days=int(server_opts.get("session_ttl_days", 7)),
            config_watch=bool(server_opts.get("config_watch", False)),
            log_level=server_opts.get("log_level", "info"),
            require_email_verification=bool(server_opts.get("require_email_verification", False)),
            debug_verification_codes=bool(server_opts.get("debug_verification_codes", False)),
            seed_dev_accounts=bool(server_opts.get("seed_dev_accounts", False)),
            require_invite=bool(server_opts.get("require_invite", False)),
            local_file_access=bool(server_opts.get("local_file_access", False)),
            trusted_proxies=[str(item) for item in server_opts.get("trusted_proxies", [])],
            static_roots=[str(item).strip("/") for item in server_opts.get("static_roots", [])],
            data_dir=str(server_opts.get("data_dir", "") or ""),
            secrets_dir=str(server_opts.get("secrets_dir", "") or ""),
            root_dir=str(server_opts.get("root_dir", "") or ""),
            ddb_proxy_allowed_hosts=list(
                server_opts.get(
                    "ddb_proxy_allowed_hosts",
                    ["www.dndbeyond.com", "dndbeyond.com", "monster-service.dndbeyond.com"],
                )
            ),
        )

        db_opts = payload.get("database", {})
        db_config = DatabaseConfig(path=Path(db_opts.get("path", "undercroft/workbench/data/database.sqlite")))

        email_opts = dict(payload.get("email", {}))
        # Mail credentials live with the other secrets, so a file there replaces the config's email block.
        secrets_dir = options.secrets_dir
        email_file = Path(secrets_dir) / "email.json" if secrets_dir else None
        if email_file and email_file.exists():
            with email_file.open("r", encoding="utf-8") as fp:
                email_opts = json.load(fp)
        smtp_username = email_opts.get("smtp_username")
        if isinstance(smtp_username, str) and not smtp_username.strip():
            smtp_username = None
        smtp_password = email_opts.get("smtp_password")
        if isinstance(smtp_password, str) and not smtp_password:
            smtp_password = None
        email_config = EmailConfig(
            enabled=bool(email_opts.get("enabled", False)),
            sender=email_opts.get("sender", ""),
            smtp_host=email_opts.get("smtp_host", ""),
            smtp_port=int(email_opts.get("smtp_port", 587)),
            smtp_username=smtp_username,
            smtp_password=smtp_password,
            use_tls=bool(email_opts.get("use_tls", True)),
            use_ssl=bool(email_opts.get("use_ssl", False)),
            timeout=int(email_opts.get("timeout", 10)),
        )

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
                write_roles=list(mount.get("write_roles", ["gm"])),
                directory_listing=bool(mount.get("directory_listing", False)),
                directory_extensions=list(mount.get("directory_extensions", [])),
            )
            cfg.validate()
            mounts[cfg.name] = cfg

        config = ServerConfig(
            options=options,
            database=db_config,
            mounts=mounts,
            email=email_config,
        )
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
