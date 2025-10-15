import json
import tempfile
import unittest
from pathlib import Path

from server.auth import User, init_auth_db
from server.config import ConfigLoader
from server.state import ServerState
from server.storage import (
    AuthError as StorageAuthError,
    delete_item,
    get_item,
    init_storage_db,
    list_bucket,
    save_item,
    toggle_public,
)


class StorageTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        base = Path(self.temp_dir.name)
        config_path = base / "server.config.json"
        mounts = [
            {
                "name": "characters",
                "type": "json",
                "root": str(base / "characters"),
                "table": "characters",
                "read_roles": ["free"],
                "write_roles": ["free"],
            }
        ]
        payload = {
            "server": {
                "host": "127.0.0.1",
                "port": 0,
                "cors_origin": "*",
                "session_ttl_days": 7,
                "config_watch": False,
                "log_level": "error",
            },
            "database": {"path": str(base / "db.sqlite")},
            "mounts": mounts,
        }
        config_path.write_text(json.dumps(payload), encoding="utf-8")
        self.loader = ConfigLoader(config_path)
        self.state = ServerState.from_loader(self.loader)
        init_auth_db(self.state.db)
        init_storage_db(self.state.db)
        # seed user
        self.state.db.execute(
            "INSERT INTO users (email, username, password_hash, tier) VALUES (?, ?, ?, ?)",
            ("user@example.com", "alice", "hash", "free"),
        )
        self.state.db.commit()
        self.user = User(id=1, email="user@example.com", username="alice", tier="free")

    def tearDown(self):
        self.state.db.close()
        self.temp_dir.cleanup()

    def test_save_and_get_character(self):
        save_item(self.state, "characters", "hero", {"name": "Hero"}, self.user)
        result = get_item(self.state, "characters", "hero", self.user)
        self.assertEqual(result["name"], "Hero")
        listing = list_bucket(self.state, "characters", self.user)
        self.assertEqual(len(listing["owned"]), 1)
        toggle_public(self.state, "characters", "hero", self.user, True)
        public_listing = list_bucket(self.state, "characters", None)
        self.assertEqual(len(public_listing["public"]), 1)

    def test_access_control(self):
        save_item(self.state, "characters", "rogue", {"name": "Rogue"}, self.user)
        other_user = User(id=2, email="other@example.com", username="bob", tier="free")
        with self.assertRaises(StorageAuthError):
            get_item(self.state, "characters", "rogue", other_user)
        toggle_public(self.state, "characters", "rogue", self.user, True)
        self.assertEqual(get_item(self.state, "characters", "rogue", other_user)["name"], "Rogue")
        delete_item(self.state, "characters", "rogue", self.user)
        with self.assertRaises(FileNotFoundError):
            get_item(self.state, "characters", "rogue", self.user)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
