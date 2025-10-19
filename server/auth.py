from __future__ import annotations

import hashlib
import logging
import hmac
import secrets
import smtplib
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import Any, Dict, Optional

from .state import ServerState

PBKDF2_ITERATIONS = 240_000
PBKDF2_ALGO = "sha256"
SALT_BYTES = 16
VERIFICATION_CODE_TTL_MINUTES = 15


@dataclass
class User:
    id: int
    email: str
    username: str
    tier: str


class AuthError(Exception):
    pass


def sanitize_user_row(row: sqlite3.Row) -> Dict[str, Any]:
    keys = set(row.keys()) if hasattr(row, "keys") else set()
    if "last_activity" in keys:
        last_activity = row["last_activity"] or None
    elif "last_login" in keys:
        last_activity = row["last_login"] or None
    else:
        last_activity = None
    return {
        "id": row["id"],
        "email": row["email"],
        "username": row["username"],
        "tier": row["tier"],
        "created_at": row["created_at"],
        "last_login": row["last_login"],
        "last_activity": last_activity,
        "is_active": bool(row["is_active"]),
    }


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
        CREATE TABLE IF NOT EXISTS email_verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            verified_at DATETIME,
            is_used INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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


def generate_verification_code() -> str:
    return f"{secrets.randbelow(900000) + 100000:06d}"


def create_verification_record(state: ServerState, user_id: int) -> str:
    code = generate_verification_code()
    expires_at = datetime.utcnow() + timedelta(minutes=VERIFICATION_CODE_TTL_MINUTES)
    state.db.execute("UPDATE email_verifications SET is_used = 1 WHERE user_id = ? AND is_used = 0", (user_id,))
    state.db.execute(
        "INSERT INTO email_verifications (user_id, code, expires_at) VALUES (?, ?, ?)",
        (user_id, code, expires_at.isoformat()),
    )
    state.db.commit()
    return code


def latest_verification_record(state: ServerState, user_id: int) -> Optional[sqlite3.Row]:
    return state.db.execute(
        """
        SELECT * FROM email_verifications
        WHERE user_id = ? AND is_used = 0
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (user_id,),
    ).fetchone()


def send_verification_email(state: ServerState, email: str, code: str) -> None:
    logging.info("Verification code for %s: %s", email, code)
    config = state.config.email
    if not config.enabled or not config.smtp_host or not config.sender:
        logging.info("Email delivery disabled or SMTP not configured; skipping send")
        return

    message = EmailMessage()
    message["Subject"] = "Your Undercroft verification code"
    message["From"] = config.sender
    message["To"] = email
    message.set_content(
        "\n".join(
            [
                "Hello!",
                "",
                f"Your verification code is {code}.",
                "",
                f"It expires in {VERIFICATION_CODE_TTL_MINUTES} minutes.",
                "",
                "If you did not request this code you can ignore this email.",
            ]
        )
    )

    try:
        if config.use_ssl:
            with smtplib.SMTP_SSL(config.smtp_host, config.smtp_port, timeout=config.timeout) as smtp:
                if config.smtp_username:
                    smtp.login(config.smtp_username, config.smtp_password or "")
                smtp.send_message(message)
        else:
            with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=config.timeout) as smtp:
                if config.use_tls:
                    smtp.starttls()
                if config.smtp_username:
                    smtp.login(config.smtp_username, config.smtp_password or "")
                smtp.send_message(message)
    except Exception as exc:  # pragma: no cover - depends on SMTP environment
        logging.exception("Failed to send verification email")
        raise AuthError("Unable to send verification email") from exc


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


def _normalize_session_token(token: Optional[str]) -> Optional[str]:
    if token is None:
        return None
    if isinstance(token, bytes):
        token = token.decode("utf-8", "ignore")
    elif not isinstance(token, str):
        token = str(token)
    token = token.strip()
    if not token:
        return None
    # Guard against clearly malformed tokens (e.g. accidentally stored dict reprs)
    if len(token) > 256:
        return None
    return token


def get_user_by_session(state: ServerState, token: Optional[str]) -> Optional[User]:
    normalized = _normalize_session_token(token)
    if not normalized:
        return None
    try:
        row = state.db.execute(
            """
            SELECT users.id, users.email, users.username, users.tier, sessions.expires_at
            FROM sessions JOIN users ON users.id = sessions.user_id
            WHERE sessions.session_token = ? AND sessions.is_active = 1
            """,
            (normalized,),
        ).fetchone()
    except sqlite3.InterfaceError:
        logging.exception("Rejected malformed session token")
        return None
    if not row:
        return None
    expires_at = datetime.fromisoformat(row["expires_at"])
    if expires_at < datetime.utcnow():
        state.db.execute("UPDATE sessions SET is_active = 0 WHERE session_token = ?", (normalized,))
        state.db.commit()
        return None
    state.db.execute(
        "UPDATE sessions SET last_accessed_at = ?, expires_at = ? WHERE session_token = ?",
        (
            datetime.utcnow().isoformat(),
            (datetime.utcnow() + timedelta(days=state.config.options.session_ttl_days)).isoformat(),
            normalized,
        ),
    )
    state.db.commit()
    return User(id=row["id"], email=row["email"], username=row["username"], tier=row["tier"])


def get_user_by_username(state: ServerState, username: str) -> Optional[User]:
    trimmed = (username or "").strip()
    if not trimmed:
        return None
    row = state.db.execute(
        "SELECT id, email, username, tier FROM users WHERE username = ?",
        (trimmed,),
    ).fetchone()
    if not row:
        return None
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


def count_active_admins(state: ServerState, exclude_user_id: Optional[int] = None) -> int:
    if exclude_user_id is not None:
        row = state.db.execute(
            "SELECT COUNT(*) AS count FROM users WHERE tier = 'admin' AND is_active = 1 AND id != ?",
            (exclude_user_id,),
        ).fetchone()
    else:
        row = state.db.execute(
            "SELECT COUNT(*) AS count FROM users WHERE tier = 'admin' AND is_active = 1",
        ).fetchone()
    return int(row["count"] if row and "count" in row.keys() else row[0] if row else 0)


def upgrade_user(state: ServerState, target_username: str, new_tier: str) -> Dict[str, str]:
    tiers = ["free", "player", "gm", "creator", "admin"]
    tier_value = (new_tier or "").strip().lower()
    if tier_value not in tiers:
        raise AuthError("Unknown tier")
    row = state.db.execute("SELECT id, tier FROM users WHERE username = ?", (target_username,)).fetchone()
    if not row:
        raise AuthError("User not found")
    if row["tier"] == "admin" and tier_value != "admin":
        if count_active_admins(state, exclude_user_id=row["id"]) == 0:
            raise AuthError("At least one administrator must remain")
    state.db.execute("UPDATE users SET tier = ? WHERE id = ?", (tier_value, row["id"]))
    state.db.commit()
    return {"username": target_username, "tier": tier_value}


def list_users(state: ServerState) -> Dict[str, list[Dict[str, Any]]]:
    rows = state.db.execute(
        """
        SELECT
            u.id,
            u.email,
            u.username,
            u.tier,
            u.created_at,
            u.last_login,
            u.is_active,
            CASE
                WHEN u.last_login IS NULL AND s.last_accessed_at IS NULL THEN NULL
                ELSE MAX(COALESCE(u.last_login, ''), COALESCE(s.last_accessed_at, ''))
            END AS last_activity
        FROM users AS u
        LEFT JOIN (
            SELECT user_id, MAX(last_accessed_at) AS last_accessed_at
            FROM sessions
            WHERE is_active = 1
            GROUP BY user_id
        ) AS s ON s.user_id = u.id
        ORDER BY u.username
        """
    ).fetchall()
    return {"users": [sanitize_user_row(row) for row in rows]}


def delete_user(state: ServerState, target_username: str) -> Dict[str, str]:
    username = (target_username or "").strip()
    if not username:
        raise AuthError("username is required")
    row = state.db.execute("SELECT id, tier FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        raise AuthError("User not found")
    if row["tier"] == "admin" and count_active_admins(state, exclude_user_id=row["id"]) == 0:
        raise AuthError("Cannot remove the last administrator")
    state.db.execute("DELETE FROM users WHERE id = ?", (row["id"],))
    state.db.commit()
    return {"username": username}


def update_email_address(state: ServerState, user: User, new_email: str, password: str) -> Dict[str, Any]:
    email = (new_email or "").strip().lower()
    if not email:
        raise AuthError("Email is required")
    if not password:
        raise AuthError("Password is required")
    row = state.db.execute("SELECT * FROM users WHERE id = ?", (user.id,)).fetchone()
    if not row:
        raise AuthError("User not found")
    if not verify_password(password, row["password_hash"]):
        raise AuthError("Incorrect password")
    existing = state.db.execute(
        "SELECT id FROM users WHERE email = ? AND id != ?",
        (email, user.id),
    ).fetchone()
    if existing:
        raise AuthError("Email already in use")
    state.db.execute("UPDATE users SET email = ? WHERE id = ?", (email, user.id))
    state.db.commit()
    updated = state.db.execute("SELECT * FROM users WHERE id = ?", (user.id,)).fetchone()
    return {"user": sanitize_user_row(updated)}


def update_password(state: ServerState, user: User, current_password: str, new_password: str) -> Dict[str, Any]:
    current = (current_password or "").strip()
    new = (new_password or "").strip()
    if len(new) < 8:
        raise AuthError("New password must be at least 8 characters long")
    row = state.db.execute("SELECT password_hash FROM users WHERE id = ?", (user.id,)).fetchone()
    if not row:
        raise AuthError("User not found")
    if not verify_password(current, row["password_hash"]):
        raise AuthError("Incorrect current password")
    state.db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new), user.id))
    state.db.commit()
    return {"ok": True}


def register_user(state: ServerState, payload: Dict[str, str]) -> Dict[str, str]:
    email = payload.get("email", "").strip().lower()
    username = payload.get("username", "").strip()
    password = payload.get("password", "")
    if not email or not username or not password:
        raise AuthError("email, username, and password are required")
    password_hash = hash_password(password)
    require_verification = state.config.options.require_email_verification
    is_active = 0 if require_verification else 1
    try:
        state.db.execute(
            "INSERT INTO users (email, username, password_hash, tier, is_active) VALUES (?, ?, ?, ?, ?)",
            (email, username, password_hash, "free", is_active),
        )
        state.db.commit()
    except sqlite3.IntegrityError as exc:
        existing = state.db.execute(
            "SELECT * FROM users WHERE email = ? OR username = ?",
            (email, username),
        ).fetchone()
        if existing and not existing["is_active"] and require_verification:
            state.db.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (password_hash, existing["id"]),
            )
            state.db.commit()
            code = create_verification_record(state, existing["id"])
            send_verification_email(state, existing["email"], code)
            result = {
                "requires_verification": True,
                "message": "Verification code resent",
                "user": sanitize_user_row(existing),
            }
            if state.config.options.debug_verification_codes:
                result["verification_code"] = code
            return result
        raise AuthError("email or username already exists") from exc
    user_row = state.db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    sanitized = sanitize_user_row(user_row)
    if require_verification:
        code = create_verification_record(state, user_row["id"])
        send_verification_email(state, email, code)
        result = {
            "requires_verification": True,
            "user": sanitized,
        }
        if state.config.options.debug_verification_codes:
            result["verification_code"] = code
        return result
    session = create_session(state, user_row["id"], payload.get("ip", ""), payload.get("user_agent", ""))
    return {"token": session["token"], "expires_at": session["expires_at"], "user": sanitized}


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
    return {"token": session["token"], "expires_at": session["expires_at"], "user": sanitize_user_row(user_row)}


def verify_registration(state: ServerState, payload: Dict[str, str]) -> Dict[str, str]:
    identifier = payload.get("email", "").strip().lower() or payload.get("username", "").strip()
    code = payload.get("code", "").strip()
    if not identifier or not code:
        raise AuthError("email or username and code are required")
    user_row = state.db.execute(
        "SELECT * FROM users WHERE email = ? OR username = ?",
        (identifier, identifier),
    ).fetchone()
    if not user_row:
        raise AuthError("User not found")
    record = latest_verification_record(state, user_row["id"])
    if user_row["is_active"] and not record:
        session = create_session(state, user_row["id"], payload.get("ip", ""), payload.get("user_agent", ""))
        sanitized = sanitize_user_row(user_row)
        return {"token": session["token"], "expires_at": session["expires_at"], "user": sanitized}
    if not record:
        raise AuthError("No verification code found")
    expires_at = datetime.fromisoformat(record["expires_at"])
    if expires_at < datetime.utcnow():
        state.db.execute("UPDATE email_verifications SET is_used = 1 WHERE id = ?", (record["id"],))
        state.db.commit()
        raise AuthError("Verification code expired")
    if record["code"].strip() != code:
        raise AuthError("Invalid verification code")
    state.db.execute(
        "UPDATE email_verifications SET is_used = 1, verified_at = ? WHERE id = ?",
        (datetime.utcnow().isoformat(), record["id"]),
    )
    state.db.execute(
        "UPDATE users SET is_active = 1, last_login = ? WHERE id = ?",
        (datetime.utcnow().isoformat(), user_row["id"]),
    )
    state.db.commit()
    refreshed = state.db.execute("SELECT * FROM users WHERE id = ?", (user_row["id"],)).fetchone()
    session = create_session(state, user_row["id"], payload.get("ip", ""), payload.get("user_agent", ""))
    return {"token": session["token"], "expires_at": session["expires_at"], "user": sanitize_user_row(refreshed)}


def logout_user(state: ServerState, token: Optional[str]) -> None:
    if not token:
        return
    state.db.execute("UPDATE sessions SET is_active = 0 WHERE session_token = ?", (token,))
    state.db.commit()


def cleanup_sessions(state: ServerState) -> None:
    now = datetime.utcnow().isoformat()
    state.db.execute("UPDATE sessions SET is_active = 0 WHERE expires_at < ?", (now,))
    state.db.commit()


def ensure_default_admin(state: ServerState) -> None:
    options = state.config.options
    username = (options.default_admin_username or "admin").strip() or "admin"
    email = (options.default_admin_email or f"{username}@example.com").strip().lower()
    password = options.default_admin_password or "admin"
    existing = state.db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        return
    password_hash = hash_password(password)
    state.db.execute(
        "INSERT INTO users (email, username, password_hash, tier, is_active) VALUES (?, ?, ?, ?, 1)",
        (email, username, password_hash, "admin"),
    )
    state.db.commit()
    logging.info("Created default admin user '%s'", username)


def ensure_default_test_users(state: ServerState) -> None:
    defaults = [
        ("free", "free"),
        ("player", "player"),
        ("gm", "gm"),
        ("creator", "creator"),
    ]
    created = False
    for username, tier in defaults:
        existing = state.db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if existing:
            continue
        email = f"{username}@example.com"
        password_hash = hash_password(username)
        state.db.execute(
            "INSERT INTO users (email, username, password_hash, tier, is_active) VALUES (?, ?, ?, ?, 1)",
            (email, username, password_hash, tier),
        )
        logging.info("Created default %s user '%s'", tier, username)
        created = True
    if created:
        state.db.commit()
