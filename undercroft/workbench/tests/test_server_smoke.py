import json
import shutil
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from server.app import create_server


class ServerSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.TemporaryDirectory()
        cls._root = Path(cls._tmpdir.name)
        cls._content_root = cls._root / "content"
        cls._content_root.mkdir(parents=True, exist_ok=True)

        sample_data = Path(__file__).resolve().parents[1] / "data"
        for bucket in ("characters", "templates", "systems"):
            source = sample_data / bucket
            target = cls._content_root / bucket
            if source.exists():
                shutil.copytree(source, target, dirs_exist_ok=True)
            else:
                target.mkdir(parents=True, exist_ok=True)

        cls._config_path = cls._root / "server.config.json"
        config = {
            "server": {
                "host": "127.0.0.1",
                "port": 0,
                "cors_origin": "*",
                "session_ttl_days": 7,
                "config_watch": False,
                "log_level": "error",
                "require_email_verification": True,
                "debug_verification_codes": True,
                "default_admin_username": "admin",
                "default_admin_password": "admin",
                "default_admin_email": "admin@example.com",
            },
            "database": {"path": str(cls._root / "test.sqlite")},
            "mounts": [
                {
                    "name": "characters",
                    "type": "json",
                    "root": str(cls._content_root / "characters"),
                    "table": "characters",
                    "read_roles": ["free"],
                    "write_roles": ["free"],
                },
                {
                    "name": "templates",
                    "type": "json",
                    "root": str(cls._content_root / "templates"),
                    "table": "templates",
                    "read_roles": ["free"],
                    "write_roles": ["gm", "master", "creator", "admin"],
                },
                {
                    "name": "systems",
                    "type": "json",
                    "root": str(cls._content_root / "systems"),
                    "table": "systems",
                    "read_roles": ["free"],
                    "write_roles": ["creator", "admin"],
                },
            ],
        }
        cls._config_path.write_text(json.dumps(config), encoding="utf-8")

        cls._static_dir = cls._root / "public"
        nested = cls._static_dir / "nested"
        nested.mkdir(parents=True, exist_ok=True)
        (cls._static_dir / "index.html").write_text("<h1>Root</h1>", encoding="utf-8")
        (nested / "info.txt").write_text("static-ok", encoding="utf-8")

        workbench_root = cls._root / "undercroft" / "workbench"
        workbench_root.mkdir(parents=True, exist_ok=True)
        (workbench_root / "index.html").write_text("<main>Workbench</main>", encoding="utf-8")

        cls._server = create_server(str(cls._config_path))
        cls._thread = threading.Thread(
            target=cls._server.serve_forever,
            kwargs={"poll_interval": 0.01},
            daemon=True,
        )
        cls._thread.start()
        cls._host = cls._server.server_address[0]
        cls._port = cls._server.server_address[1]
        cls._wait_for_server()

    @classmethod
    def tearDownClass(cls):
        cls._server.shutdown()
        cls._thread.join(timeout=2)
        cls._server.server_close()
        cls._tmpdir.cleanup()

    @classmethod
    def _wait_for_server(cls, timeout=5.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with socket.create_connection((cls._host, cls._port), timeout=0.5):
                    return
            except OSError:
                time.sleep(0.05)
        raise RuntimeError("Server did not start in time")

    @classmethod
    def _request(cls, path, *, method="GET", payload=None, token=None):
        url = f"http://{cls._host}:{cls._port}{path}"
        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                body = response.read().decode("utf-8")
                return response.status, json.loads(body) if body else None
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8")
            payload = json.loads(body) if body else None
            raise AssertionError(f"{method} {path} failed with {exc.code}: {payload}") from exc

    @classmethod
    def _fetch_raw(cls, path):
        url = f"http://{cls._host}:{cls._port}{path}"
        request = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(request, timeout=5) as response:
            body = response.read()
            return response.status, response.headers, body

    def test_healthz_returns_ok(self):
        status, body = self._request("/healthz")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})

    def test_anonymous_list_and_read(self):
        status, listing = self._request("/list/characters")
        self.assertEqual(status, 200)
        self.assertIn("public", listing)

        sample_files = list((self._content_root / "characters").glob("*.json"))
        self.assertTrue(sample_files, "expected seeded character data")
        sample_id = sample_files[0].stem

        status, character = self._request(f"/content/characters/{sample_id}")
        self.assertEqual(status, 200)
        self.assertTrue(
            "name" in character or ("data" in character and "name" in character["data"]),
            "expected character payload to include a name field",
        )

    def test_authenticated_save_flow(self):
        # Register user and capture token
        email = "smoke@example.com"
        username = "smoketest"
        password = "testing123"
        status, session = self._request(
            "/auth/register",
            method="POST",
            payload={"email": email, "username": username, "password": password},
        )
        self.assertEqual(status, 201)
        if session.get("requires_verification"):
            code = session.get("verification_code")
            self.assertIsNotNone(code, "expected verification code in debug mode")
            status, session = self._request(
                "/auth/verify",
                method="POST",
                payload={"email": email, "code": code},
            )
            self.assertEqual(status, 200)
        token = session["token"]

        # Save new character record
        character_id = "test-character"
        payload = {
            "id": character_id,
            "name": "Smoke Test",
            "system": "sys.dnd5e",
            "template": "tpl.5e.flex-basic",
            "data": {"name": "Smoke Test"},
        }
        status, response = self._request(
            f"/content/characters/{character_id}",
            method="POST",
            payload=payload,
            token=token,
        )
        self.assertEqual(status, 200)
        self.assertEqual(response["ok"], True)

        # Authenticated listing should show owned record
        status, listing = self._request("/list/characters", token=token)
        self.assertEqual(status, 200)
        owned = listing.get("owned", [])
        self.assertTrue(any(item["id"] == character_id for item in owned))

        # Round-trip content fetch
        status, character = self._request(f"/content/characters/{character_id}", token=token)
        self.assertEqual(status, 200)
        self.assertEqual(character["name"], "Smoke Test")

    def test_static_files_are_served_from_any_directory(self):
        status, headers, body = self._fetch_raw("/public/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers.get("Content-Type", ""))
        self.assertIn(b"Root", body)

        status, headers, body = self._fetch_raw("/public/nested/info.txt")
        self.assertEqual(status, 200)
        self.assertIn("text/plain", headers.get("Content-Type", ""))
        self.assertEqual(body.decode("utf-8"), "static-ok")

        status, headers, body = self._fetch_raw("/undercroft/workbench/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers.get("Content-Type", ""))
        self.assertIn(b"Workbench", body)

    def test_missing_static_file_returns_default_404(self):
        url = f"http://{self._host}:{self._port}/missing/file.html"
        request = urllib.request.Request(url, method="GET")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(request, timeout=5)
        self.assertEqual(ctx.exception.code, 404)
        self.assertIn("text/html", ctx.exception.headers.get("Content-Type", ""))


if __name__ == "__main__":
    unittest.main()
