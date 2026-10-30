from __future__ import annotations

import hashlib
import json
import re
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

from .roles import role_rank
from .state import ServerState
from .metrics import METRICS
from .throttle import Throttle

PBKDF2_ITERATIONS = 240_000
PBKDF2_ALGO = "sha256"
SALT_BYTES = 16
VERIFICATION_CODE_TTL_MINUTES = 15
MIN_PASSWORD_LENGTH = 10
# A verification code that is guessed wrong this many times is burned; a new one must be requested.
CODE_ATTEMPT_LIMIT = 5
# At most one verification email per account per minute.
RESEND_COOLDOWN_SECONDS = 60

_code_attempts = Throttle(limit=CODE_ATTEMPT_LIMIT, window_seconds=VERIFICATION_CODE_TTL_MINUTES * 60)
_resend_cooldown = Throttle(limit=1, window_seconds=RESEND_COOLDOWN_SECONDS)

# The most common passwords seen in public breach lists; a short guard, not a full dictionary.
_COMMON_PASSWORDS = frozenset(
    """password password1 password12 password123 passw0rd p@ssw0rd p@ssword 1234567890 12345678 123456789
    1234567 qwertyuiop qwerty123 qwertyuiop1 1q2w3e4r5t iloveyou123 letmein123 welcome123 admin12345
    administrator changeme123 abc123456 abcdefghij 0123456789 1111111111 0000000000 football123 monkey1234
    dragon1234 baseball123 sunshine123 princess123 trustno1234 undercroft""".split()
)


def validate_password(password: str, username: str = "", email: str = "") -> None:
    value = password or ""
    if len(value) < MIN_PASSWORD_LENGTH:
        raise AuthError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters long")
    lowered = value.lower()
    if lowered in _COMMON_PASSWORDS or len(set(lowered)) < 4:
        raise AuthError("That password is too easy to guess")
    if lowered in {(username or "").strip().lower(), (email or "").strip().lower()}:
        raise AuthError("Password can't be the same as your username or email")


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
    user = {
        "id": row["id"],
        "email": row["email"],
        "username": row["username"],
        "tier": row["tier"],
        "created_at": row["created_at"],
        "last_login": row["last_login"],
        "last_activity": last_activity,
        "is_active": bool(row["is_active"]),
    }
    if "invite_label" in keys:
        user["invite_label"] = row["invite_label"]
        user["invite_code"] = row["invite_code"]
    return user


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
            is_active INTEGER DEFAULT 1,
            settings TEXT,
            invite_code TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS invites (
            code TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            tier TEXT NOT NULL,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            max_uses INTEGER,
            active INTEGER DEFAULT 1,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
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


# `settings` is a small per-user JSON blob (today: {"dashboardLayout": {...}, "profile": {...}}),
# general-purpose so future per-user preferences land in the same column.


def get_user_settings(state: ServerState, user: User) -> Dict[str, Any]:
    row = state.db.execute("SELECT settings FROM users WHERE id = ?", (user.id,)).fetchone()
    if not row or not row["settings"]:
        return {}
    try:
        parsed = json.loads(row["settings"])
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def update_user_settings(state: ServerState, user: User, patch: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(patch, dict):
        raise AuthError("Settings patch must be an object")
    if "profile" in patch:
        raise AuthError("The community profile is saved from the Profile page")
    color = patch.get("playerColor")
    if "playerColor" in patch and not (color == "" or (isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color))):
        raise AuthError("Player color must be a color such as #3366cc")
    current = get_user_settings(state, user)
    current.update(patch)
    state.db.execute(
        "UPDATE users SET settings = ? WHERE id = ?",
        (json.dumps(current), user.id),
    )
    state.db.commit()
    return current


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
    if state.config.options.debug_verification_codes:
        logging.info("Verification code for %s: %s", email, code)
    config = state.config.email
    if not config.enabled or not config.smtp_host or not config.sender:
        logging.info("Email delivery disabled or SMTP not configured; skipping send")
        METRICS.inc("verification_emails_total", "skipped")
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
        METRICS.inc("verification_emails_total", "sent")
    except Exception as exc:  # pragma: no cover - depends on SMTP environment
        logging.exception("Failed to send verification email")
        METRICS.inc("verification_emails_total", "failed")
        raise AuthError("Unable to send verification email") from exc


# Only a hash of each session token is stored, so a copy of the database can't be replayed as logins.
def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(state: ServerState, user_id: int, ip: str, user_agent: str) -> Dict[str, str]:
    expires_at = datetime.utcnow() + timedelta(days=state.config.options.session_ttl_days)
    token = secrets.token_hex(32)
    state.db.execute(
        """
        INSERT INTO sessions (user_id, session_token, ip_address, user_agent, expires_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user_id, hash_session_token(token), ip, user_agent, expires_at.isoformat()),
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


def _parse_expiry(value: Any) -> Optional[datetime]:
    # A stored expires_at should always be a valid isoformat string (every
    # writer in this file uses datetime.isoformat()) — but a single
    # corrupted/malformed row here used to take down EVERY authenticated
    # request with an uncaught ValueError, since get_user_by_session runs on
    # every one of them. Treating an unparseable value as "no valid expiry"
    # instead lets the caller fail safe (session invalid) rather than crash.
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def get_user_by_session(state: ServerState, token: Optional[str]) -> Optional[User]:
    # Runs on EVERY request (current_user(), called at the top of nearly
    # every route handler) — including routes marked unlocked (router.py's
    # Route.unlocked) that no longer hold state.lock around their whole
    # handler. The SELECT below reads via state.read_db (safe for concurrent,
    # lock-free access from any number of threads — see that connection's
    # own comment); the two UPDATE branches still write via state.db, each
    # explicitly wrapped in state.lock here since they can no longer assume
    # an outer caller already holds it. state.lock is an RLock, so this is
    # exactly as safe to call from a route that DOES still hold it (reentrant
    # reacquisition, not a deadlock) as from one that doesn't.
    normalized = _normalize_session_token(token)
    if not normalized:
        return None
    normalized = hash_session_token(normalized)
    try:
        row = state.read_db.execute(
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
    expires_at = _parse_expiry(row["expires_at"])
    if expires_at is None or expires_at < datetime.utcnow():
        # A malformed expires_at is treated the same as an expired one —
        # deactivated here too, so a corrupted row self-heals into a normal
        # "please log in again" instead of crashing on every future request.
        with state.lock:
            state.db.execute("UPDATE sessions SET is_active = 0 WHERE session_token = ?", (normalized,))
            state.db.commit()
        return None
    with state.lock:
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


def get_user_by_id(state: ServerState, user_id: int) -> Optional[User]:
    row = state.db.execute(
        "SELECT id, email, username, tier FROM users WHERE id = ? AND is_active = 1", (user_id,)
    ).fetchone()
    return User(id=row["id"], email=row["email"], username=row["username"], tier=row["tier"]) if row else None


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
            u.invite_code,
            i.label AS invite_label,
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
        LEFT JOIN invites AS i ON i.code = u.invite_code
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


def admin_set_user_status(state: ServerState, target_username: str, is_active: bool) -> Dict[str, Any]:
    row = state.db.execute("SELECT id, tier FROM users WHERE username = ?", (target_username,)).fetchone()
    if not row:
        raise AuthError("User not found")
    if not is_active and row["tier"] == "admin" and count_active_admins(state, exclude_user_id=row["id"]) == 0:
        raise AuthError("At least one administrator must remain active")
    state.db.execute("UPDATE users SET is_active = ? WHERE id = ?", (1 if is_active else 0, row["id"]))
    if not is_active:
        # Deactivating only blocks future logins otherwise — get_user_by_session
        # checks sessions.is_active, not the user's, so an already-signed-in
        # session would keep working until it naturally expired without this.
        state.db.execute("UPDATE sessions SET is_active = 0 WHERE user_id = ?", (row["id"],))
    state.db.commit()
    updated = state.db.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
    return {"user": sanitize_user_row(updated)}


def admin_update_user_email(state: ServerState, target_username: str, new_email: str) -> Dict[str, Any]:
    email = (new_email or "").strip().lower()
    if not email:
        raise AuthError("Email is required")
    row = state.db.execute("SELECT id FROM users WHERE username = ?", (target_username,)).fetchone()
    if not row:
        raise AuthError("User not found")
    existing = state.db.execute(
        "SELECT id FROM users WHERE email = ? AND id != ?",
        (email, row["id"]),
    ).fetchone()
    if existing:
        raise AuthError("Email already in use")
    state.db.execute("UPDATE users SET email = ? WHERE id = ?", (email, row["id"]))
    state.db.commit()
    updated = state.db.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
    return {"user": sanitize_user_row(updated)}


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


# The password check and the new hash are slow on purpose, so both happen before the database lock is taken.
def update_password(
    state: ServerState, user: User, current_password: str, new_password: str, keep_token: Optional[str] = None
) -> Dict[str, Any]:
    current = (current_password or "").strip()
    new = (new_password or "").strip()
    validate_password(new, user.username, user.email)
    row = state.read_db.execute("SELECT password_hash FROM users WHERE id = ?", (user.id,)).fetchone()
    if not row:
        raise AuthError("User not found")
    if not verify_password(current, row["password_hash"]):
        raise AuthError("Incorrect current password")
    new_hash = hash_password(new)
    with state.lock:
        state.db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user.id))
        state.db.commit()
        revoke_other_sessions(state, user.id, keep_token)
    return {"ok": True}


# Self-service tiers only — "admin" is deliberately excluded here and can
# only ever be granted by an existing admin via upgrade_user() above. No
# payment integration exists yet, so this applies the tier change immediately;
# once real billing lands, that step slots in before the UPDATE below without
# changing this function's shape.
SELF_SERVICE_TIERS = ["free", "player", "gm", "creator"]


def upgrade_own_tier(state: ServerState, user: User, new_tier: str) -> Dict[str, Any]:
    tier_value = (new_tier or "").strip().lower()
    if tier_value not in SELF_SERVICE_TIERS:
        raise AuthError("Unknown tier")
    row = state.db.execute("SELECT id, tier FROM users WHERE id = ?", (user.id,)).fetchone()
    if not row:
        raise AuthError("User not found")
    # Downgrading isn't offered through this free, self-service flow (also
    # rules out an admin quietly demoting themselves this way, so the old
    # last-active-admin guard that used to live here is now unreachable and
    # was removed) — enforced here, not just by disabling the picker
    # client-side, since a direct API call would otherwise bypass that.
    if role_rank(tier_value) < role_rank(row["tier"]):
        raise AuthError("Downgrading isn't available through self-service upgrade")
    state.db.execute("UPDATE users SET tier = ? WHERE id = ?", (tier_value, row["id"]))
    state.db.commit()
    updated = state.db.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
    return {"user": sanitize_user_row(updated)}


def admin_create_user(state: ServerState, username: str, email: str, password: str, tier: str) -> Dict[str, Any]:
    tiers = ["free", "player", "gm", "creator", "admin"]
    username = (username or "").strip()
    email_value = (email or "").strip().lower()
    tier_value = (tier or "free").strip().lower()
    if not username or not email_value or not password:
        raise AuthError("username, email, and password are required")
    if tier_value not in tiers:
        raise AuthError("Unknown tier")
    validate_password(password, username, email_value)
    password_hash = hash_password(password)
    try:
        # is_active=1 unconditionally — an admin creating the account directly
        # is a stronger trust signal than self-registration, so this skips the
        # email-verification step register_user() otherwise requires.
        state.db.execute(
            "INSERT INTO users (email, username, password_hash, tier, is_active) VALUES (?, ?, ?, ?, 1)",
            (email_value, username, password_hash, tier_value),
        )
        state.db.commit()
    except sqlite3.IntegrityError as exc:
        raise AuthError("email or username already exists") from exc
    user_row = state.db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    return {"user": sanitize_user_row(user_row)}


REGISTRATION_NOTICE = "If that address can be used, a verification code is on its way."


def _has_unfinished_signup(state: ServerState, user_id: int) -> bool:
    # An account that was never verified is a pending signup; one an admin has switched off
    # (it did verify once) is not, and registering can't bring it back.
    verified = state.db.execute(
        "SELECT 1 FROM email_verifications WHERE user_id = ? AND verified_at IS NOT NULL LIMIT 1", (user_id,)
    ).fetchone()
    return verified is None


# Hashing and the verification email (SMTP can take seconds) both happen outside the database lock.
def register_user(state: ServerState, payload: Dict[str, str]) -> Dict[str, str]:
    email = payload.get("email", "").strip().lower()
    username = payload.get("username", "").strip()
    password = payload.get("password", "")
    if not email or not username or not password:
        raise AuthError("email, username, and password are required")
    # Checked first, so a bad code never says anything about which accounts exist.
    from .invites import validate_invite

    invite_code = str(payload.get("invite") or "").strip().lower()
    if state.config.options.require_invite and not invite_code:
        raise AuthError("You need an invite code to create an account")
    if invite_code:
        validate_invite(state, invite_code)
    validate_password(password, username, email)
    require_verification = state.config.options.require_email_verification
    password_hash = hash_password(password)
    to_send = None
    with state.lock:
        existing = state.db.execute(
            "SELECT * FROM users WHERE email = ? OR username = ?",
            (email, username),
        ).fetchone()
        if existing:
            if not require_verification:
                raise AuthError("email or username already exists")
            # Existing accounts are never touched and the reply is the same as for a new one, so this
            # route can't be used to learn who has an account. A pending signup just gets a fresh code.
            if (
                not existing["is_active"]
                and _has_unfinished_signup(state, existing["id"])
                and not _resend_cooldown.wait_seconds([f"user:{existing['id']}"])
            ):
                _resend_cooldown.record([f"user:{existing['id']}"])
                to_send = (existing["email"], create_verification_record(state, existing["id"]))
            result = {"requires_verification": True, "message": REGISTRATION_NOTICE}
        else:
            is_active = 0 if require_verification else 1
            # Checked again under the lock that inserts the account, so two sign-ups can't both take the last seat.
            invite = validate_invite(state, invite_code) if invite_code else None
            state.db.execute(
                "INSERT INTO users (email, username, password_hash, tier, is_active, invite_code) VALUES (?, ?, ?, ?, ?, ?)",
                (email, username, password_hash, invite["tier"] if invite else "free", is_active, invite["code"] if invite else None),
            )
            state.db.commit()
            user_row = state.db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            if require_verification:
                _resend_cooldown.record([f"user:{user_row['id']}"])
                code = create_verification_record(state, user_row["id"])
                to_send = (email, code)
                result = {"requires_verification": True, "message": REGISTRATION_NOTICE}
                if state.config.options.debug_verification_codes:
                    result["verification_code"] = code
            else:
                session = create_session(state, user_row["id"], payload.get("ip", ""), payload.get("user_agent", ""))
                result = {"token": session["token"], "expires_at": session["expires_at"], "user": sanitize_user_row(user_row)}
    if to_send:
        send_verification_email(state, *to_send)
    return result


# The slow password check runs on the lock-free read connection; only the writes take the database lock.
def login_user(state: ServerState, payload: Dict[str, str], ip: str, user_agent: str) -> Dict[str, str]:
    username = payload.get("username", "").strip()
    if not username:
        username = payload.get("username_or_email", "").strip()
    password = payload.get("password", "")
    row = state.read_db.execute(
        "SELECT id, password_hash FROM users WHERE (username = ? OR email = ?) AND is_active = 1",
        (username, username),
    ).fetchone()
    if not row:
        raise AuthError("Invalid credentials")
    if not verify_password(password, row["password_hash"]):
        raise AuthError("Invalid credentials")
    with state.lock:
        state.db.execute("UPDATE users SET last_login = ? WHERE id = ?", (datetime.utcnow().isoformat(), row["id"]))
        state.db.commit()
        cleanup_sessions(state)
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
    if not record:
        raise AuthError("No verification code found")
    expires_at = _parse_expiry(record["expires_at"])
    if expires_at is None or expires_at < datetime.utcnow():
        state.db.execute("UPDATE email_verifications SET is_used = 1 WHERE id = ?", (record["id"],))
        state.db.commit()
        raise AuthError("Verification code expired")
    attempt_key = f"code:{record['id']}"
    if record["code"].strip() != code:
        _code_attempts.record([attempt_key])
        if _code_attempts.wait_seconds([attempt_key]):
            state.db.execute("UPDATE email_verifications SET is_used = 1 WHERE id = ?", (record["id"],))
            state.db.commit()
            raise AuthError("Too many incorrect codes. Request a new code.")
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
    state.db.execute("UPDATE sessions SET is_active = 0 WHERE session_token = ?", (hash_session_token(token),))
    state.db.commit()


def revoke_other_sessions(state: ServerState, user_id: int, keep_token: Optional[str]) -> None:
    keep = hash_session_token(keep_token) if keep_token else ""
    state.db.execute(
        "UPDATE sessions SET is_active = 0 WHERE user_id = ? AND session_token != ?",
        (user_id, keep),
    )
    state.db.commit()


def cleanup_sessions(state: ServerState) -> None:
    now = datetime.utcnow().isoformat()
    state.db.execute("DELETE FROM sessions WHERE is_active = 0 OR expires_at < ?", (now,))
    state.db.commit()


def has_active_admin(state: ServerState) -> bool:
    return count_active_admins(state) > 0


def create_admin_user(state: ServerState, username: str, email: str, password: str) -> None:
    result = admin_create_user(state, username, email, password, "admin")
    logging.info("Created admin user '%s'", result["user"]["username"])


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
