from __future__ import annotations

import logging
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Dict

from .config import ConfigLoader, MountConfig, ServerConfig


@dataclass
class ServerState:
    config_loader: ConfigLoader
    config: ServerConfig
    db: sqlite3.Connection
    mounts: Dict[str, MountConfig]
    lock: threading.RLock
    root_dir: Path

    @classmethod
    def from_loader(cls, loader: ConfigLoader) -> "ServerState":
        config = loader.get()
        db = sqlite3.connect(str(config.database.path), check_same_thread=False)
        db.row_factory = sqlite3.Row
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
            self.config = new_config
            self.mounts = dict(new_config.mounts)
            self.root_dir = self.config_loader.path.resolve().parent

    def get_mount(self, name: str) -> MountConfig:
        try:
            return self.mounts[name]
        except KeyError:
            raise KeyError(f"Unknown mount '{name}'")


def configure_logging(level: str) -> None:
    lvl = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(level=lvl, format="[%(asctime)s] %(levelname)s %(message)s")
