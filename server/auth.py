from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, Optional

from .state import ServerState

PBKDF2_ITERATIONS = 240_000
PBKDF2_ALGO = "sha256"
SALT_BYTES = 16


@dataclass
class User:
    id: int
    email: str
    username: str
    tier: str


class AuthError(Exception):
    pass


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    dk = hashlib.pbkdf2_hmac(PBKDF2_ALGO, password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ALGO}${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, algo, iters_s, salt_hex, hash_hex = stored.split("$")
        if scheme != "pbkdf2":
            return False
        iters = int(iters_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        dk = hashlib.pbkdf2_hmac(algo, password.encode("utf-8"), salt, iters)
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def init_auth_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            tier TEXT DEFAULT 'free',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME,
            is_active INTEGER DEFAULT 1
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_token TEXT UNIQUE NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active INTEGER DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )


def create_session(state: ServerState, user_id: int, ip: str, user_agent: str) -> Dict[str, str]:
    expires_at = datetime.utcnow() + timedelta(days=state.config.options.session_ttl_days)
    token = secrets.token_hex(32)
    state.db.execute(
        """
        INSERT INTO sessions (user_id, session_token, ip_address, user_agent, expires_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user_id, token, ip, user_agent, expires_at.isoformat()),
    )
    state.db.commit()
    return {"token": token, "expires_at": expires_at.isoformat()}


def get_user_by_session(state: ServerState, token: Optional[str]) -> Optional[User]:
    if not token:
        return None
    row = state.db.execute(
        """
        SELECT users.id, users.email, users.username, users.tier, sessions.expires_at
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.session_token = ? AND sessions.is_active = 1
        """,
        (token,),
    ).fetchone()
    if not row:
        return None
    expires_at = datetime.fromisoformat(row["expires_at"])
    if expires_at < datetime.utcnow():
        state.db.execute("UPDATE sessions SET is_active = 0 WHERE session_token = ?", (token,))
        state.db.commit()
        return None
    state.db.execute(
        "UPDATE sessions SET last_accessed_at = ?, expires_at = ? WHERE session_token = ?",
        (datetime.utcnow().isoformat(), (datetime.utcnow() + timedelta(days=state.config.options.session_ttl_days)).isoformat(), token),
    )
    state.db.commit()
    return User(id=row["id"], email=row["email"], username=row["username"], tier=row["tier"])


def require_role(user: Optional[User], role: str) -> None:
    tiers = ["free", "player", "gm", "master", "creator", "admin"]
    if user is None:
        raise AuthError("Authentication required")
    if role not in tiers:
        raise AuthError("Unknown role requirement")
    user_index = tiers.index(user.tier) if user.tier in tiers else -1
    required_index = tiers.index(role)
    if user_index < required_index:
        raise AuthError("Insufficient permissions")


def upgrade_user(state: ServerState, target_username: str, new_tier: str) -> Dict[str, str]:
    tiers = ["free", "player", "gm", "creator", "admin"]
    if new_tier not in tiers:
        raise AuthError("Unknown tier")
    row = state.db.execute("SELECT id FROM users WHERE username = ?", (target_username,)).fetchone()
    if not row:
        raise AuthError("User not found")
    state.db.execute("UPDATE users SET tier = ? WHERE id = ?", (new_tier, row["id"]))
    state.db.commit()
    return {"username": target_username, "tier": new_tier}


def register_user(state: ServerState, payload: Dict[str, str]) -> Dict[str, str]:
    email = payload.get("email", "").strip().lower()
    username = payload.get("username", "").strip()
    password = payload.get("password", "")
    if not email or not username or not password:
        raise AuthError("email, username, and password are required")
    password_hash = hash_password(password)
    try:
        state.db.execute(
            "INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
            (email, username, password_hash),
        )
        state.db.commit()
    except sqlite3.IntegrityError as exc:
        raise AuthError("email or username already exists") from exc
    user_row = state.db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    session = create_session(state, user_row["id"], payload.get("ip", ""), payload.get("user_agent", ""))
    return {"token": session["token"], "expires_at": session["expires_at"], "user": dict(user_row)}


def login_user(state: ServerState, payload: Dict[str, str], ip: str, user_agent: str) -> Dict[str, str]:
    username = payload.get("username", "").strip()
    if not username:
        username = payload.get("username_or_email", "").strip()
    password = payload.get("password", "")
    row = state.db.execute(
        "SELECT id, password_hash FROM users WHERE (username = ? OR email = ?) AND is_active = 1",
        (username, username),
    ).fetchone()
    if not row:
        raise AuthError("Invalid credentials")
    if not verify_password(password, row["password_hash"]):
        raise AuthError("Invalid credentials")
    state.db.execute("UPDATE users SET last_login = ? WHERE id = ?", (datetime.utcnow().isoformat(), row["id"]))
    state.db.commit()
    session = create_session(state, row["id"], ip, user_agent)
    user_row = state.db.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
    return {"token": session["token"], "expires_at": session["expires_at"], "user": dict(user_row)}


def logout_user(state: ServerState, token: Optional[str]) -> None:
    if not token:
        return
    state.db.execute("UPDATE sessions SET is_active = 0 WHERE session_token = ?", (token,))
    state.db.commit()


def cleanup_sessions(state: ServerState) -> None:
    now = datetime.utcnow().isoformat()
    state.db.execute("UPDATE sessions SET is_active = 0 WHERE expires_at < ?", (now,))
    state.db.commit()
