from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .state import ServerState

# Account-tied third-party integration credentials (currently just Home
# Assistant's own access token) — the one place in this server that needs a
# REVERSIBLE secret at rest, unlike auth.py's one-way PBKDF2 password
# hashing. Encrypted with `cryptography`'s Fernet recipe (symmetric,
# authenticated) — this server's only third-party dependency (see
# server/requirements.txt); Python's stdlib has no authenticated cipher of
# its own, and hand-rolling one is worse than not encrypting at all.
#
# Deliberately lightweight, not a full secrets-management story: one key,
# generated once and left alone (no rotation), stored in a local, gitignored
# file next to the other *.local.json secrets this server already has. That
# protects against the most likely real leak (a stolen DB backup, a
# misconfigured sync/export) without pretending to protect against a fully
# compromised server, which no in-process key can — see this module's own
# _load_or_create_key for the honest boundary. Every `import cryptography`
# below is lazy (inside a function, not at module load) so a deployment that
# never touches Home Assistant never needs the package installed at all —
# the rest of the server runs unaffected either way.

_SECRET_FILENAME = "secret.local.json"


class EncryptionUnavailable(Exception):
    """The `cryptography` package isn't installed."""


def _secret_path(state: ServerState) -> Path:
    return state.root_dir / "server" / _SECRET_FILENAME


def _require_fernet():
    try:
        from cryptography.fernet import Fernet
    except ImportError as exc:
        raise EncryptionUnavailable(
            "This requires the 'cryptography' package — run: pip install -r server/requirements.txt"
        ) from exc
    return Fernet


# Unlike every other *.local.json in this server (anthropic.local.json,
# ddb-session.local.json), there's nothing for a person to go obtain and
# paste in here — the key just needs to exist, so this generates and
# persists one itself on first use rather than shipping a .example template
# for someone to fill in. Losing this file makes every credential encrypted
# under the old key permanently unreadable (there's no recovery — that's
# what "the key" means); that's an accepted tradeoff for staying this
# simple, not an oversight.
def _load_or_create_key(state: ServerState) -> bytes:
    Fernet = _require_fernet()
    path = _secret_path(state)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            existing = str(data.get("fernet_key") or "").strip()
            if existing:
                return existing.encode("utf-8")
        except (json.JSONDecodeError, OSError):
            pass
    key = Fernet.generate_key()
    path.write_text(json.dumps({"fernet_key": key.decode("utf-8")}, indent=2) + "\n", encoding="utf-8")
    return key


def encrypt_token(state: ServerState, plaintext: str) -> bytes:
    Fernet = _require_fernet()
    return Fernet(_load_or_create_key(state)).encrypt(plaintext.encode("utf-8"))


def decrypt_token(state: ServerState, token: bytes) -> str:
    Fernet = _require_fernet()
    return Fernet(_load_or_create_key(state)).decrypt(bytes(token)).decode("utf-8")


# --- Home Assistant connection (one per account) ----------------------------
#
# Split deliberately from the generic per-user `settings` JSON blob
# (auth.py's get_user_settings/update_user_settings, which WLED's own device
# list round-trips through) — that blob is returned to the client on every
# load, and mixing a real credential into it would mean every future reader
# of that blob has to know to treat one field specially. This gets its own
# tiny table and its own narrow routes instead: base_url is plain (not
# sensitive enough to bother encrypting, and the UI wants to display it), the
# token is Fernet-encrypted and NEVER returned to the client again after the
# save that set it — see app.py's handle_get_ha_connection, which only ever
# reports {configured, baseUrl}. That's the real "masking": not a dotted
# input hiding a value the client still has, but a value the client
# genuinely never gets back.
def get_ha_connection(state: ServerState, user_id: int) -> dict:
    row = state.read_db.execute(
        "SELECT base_url FROM integration_credentials WHERE user_id = ? AND provider = 'home-assistant'",
        (user_id,),
    ).fetchone()
    return {"configured": bool(row), "baseUrl": (row["base_url"] or "") if row else ""}


def save_ha_connection(state: ServerState, user_id: int, base_url: str, token: str) -> None:
    encrypted = encrypt_token(state, token)
    state.db.execute(
        """
        INSERT INTO integration_credentials (user_id, provider, base_url, encrypted_token, updated_at)
        VALUES (?, 'home-assistant', ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, provider) DO UPDATE SET
            base_url = excluded.base_url,
            encrypted_token = excluded.encrypted_token,
            updated_at = excluded.updated_at
        """,
        (user_id, base_url, encrypted),
    )
    state.db.commit()


def clear_ha_connection(state: ServerState, user_id: int) -> None:
    state.db.execute(
        "DELETE FROM integration_credentials WHERE user_id = ? AND provider = 'home-assistant'",
        (user_id,),
    )
    state.db.commit()


# The "edit just the URL" path — confirmed a real gap without this: fixing a
# typo'd/wrong base_url (e.g. localhost used where a real LAN IP was needed)
# otherwise meant re-pasting the whole long-lived access token too, since
# save_ha_connection above always overwrites it. Only ever called when a
# connection already exists (app.py's own handle_save_ha_connection checks
# that before reaching here) — nothing to "update" otherwise.
def update_ha_connection_url(state: ServerState, user_id: int, base_url: str) -> None:
    state.db.execute(
        "UPDATE integration_credentials SET base_url = ?, updated_at = CURRENT_TIMESTAMP "
        "WHERE user_id = ? AND provider = 'home-assistant'",
        (base_url, user_id),
    )
    state.db.commit()


# Decrypted token, for the proxy routes' own outgoing calls only — never
# serialized into a response. None means "not configured," a single clear
# case every caller checks for instead of a separately-raised error, since
# it's an entirely expected state (most accounts will never set this up).
def resolve_ha_credentials(state: ServerState, user_id: int) -> Optional[dict]:
    row = state.read_db.execute(
        "SELECT base_url, encrypted_token FROM integration_credentials WHERE user_id = ? AND provider = 'home-assistant'",
        (user_id,),
    ).fetchone()
    if not row or not row["encrypted_token"]:
        return None
    return {"baseUrl": row["base_url"] or "", "token": decrypt_token(state, row["encrypted_token"])}


# --- Deployment-wide secrets (currently: a GM-managed LIST of transcription
# servers) -------------------------------------------------------------------
#
# Same split/masking rationale as the Home Assistant connection above
# (base_url plain and shown back, token encrypted and never shown back) —
# just with no user_id column, and (unlike HA's one-per-account row) more
# than one entry per provider: a GM might run a transcription server on more
# than one homelab box, or want to keep a couple around and pick between
# them. See deployment_secrets' own CREATE TABLE comment (storage.py) for
# the schema shape (`(provider, id)` composite key, plus `label`).
def list_deployment_secrets(state: ServerState, provider: str) -> list:
    rows = state.read_db.execute(
        "SELECT id, label, base_url, model, encrypted_token FROM deployment_secrets WHERE provider = ? ORDER BY label COLLATE NOCASE",
        (provider,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "label": row["label"] or row["base_url"] or row["id"],
            "baseUrl": row["base_url"] or "",
            "model": row["model"] or "",
            "hasKey": bool(row["encrypted_token"]),
        }
        for row in rows
    ]


def save_deployment_secret(
    state: ServerState, provider: str, entry_id: str, label: str, base_url: str, model: str, token: str
) -> None:
    encrypted = encrypt_token(state, token) if token else None
    state.db.execute(
        """
        INSERT INTO deployment_secrets (provider, id, label, base_url, model, encrypted_token, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(provider, id) DO UPDATE SET
            label = excluded.label,
            base_url = excluded.base_url,
            model = excluded.model,
            encrypted_token = excluded.encrypted_token,
            updated_at = excluded.updated_at
        """,
        (provider, entry_id, label, base_url, model, encrypted),
    )
    state.db.commit()


def clear_deployment_secret(state: ServerState, provider: str, entry_id: str) -> None:
    state.db.execute(
        "DELETE FROM deployment_secrets WHERE provider = ? AND id = ?",
        (provider, entry_id),
    )
    state.db.commit()


# Decrypted token, for the proxy routes' own outgoing calls only — never
# serialized into a response. None means "no such entry" — a single clear
# case every caller checks for, whether that's a bad/deleted id or the list
# is simply empty. `model` comes back plain (never a secret) — "" when the
# entry didn't set one, left to the caller to fall back to a sensible
# default (server/app.py's own handle_audio_transcribe_chunk falls back to
# "whisper-1", the one case where that hardcoded value is actually correct:
# OpenAI's own real hosted API).
def resolve_deployment_secret(state: ServerState, provider: str, entry_id: str) -> Optional[dict]:
    row = state.read_db.execute(
        "SELECT base_url, model, encrypted_token FROM deployment_secrets WHERE provider = ? AND id = ?",
        (provider, entry_id),
    ).fetchone()
    if not row or not row["base_url"]:
        return None
    token = decrypt_token(state, row["encrypted_token"]) if row["encrypted_token"] else ""
    return {"baseUrl": row["base_url"], "model": row["model"] or "", "token": token}
