from __future__ import annotations

import secrets
import string
from datetime import datetime
from typing import Any, Dict, List, Optional

from .auth import AuthError
from .state import ServerState

# An invite starts an account at one of these tiers; admin is never grantable this way.
INVITE_TIERS = ("free", "player", "gm", "creator")
CODE_LENGTH = 10
_ALPHABET = string.ascii_lowercase + string.digits
LABEL_LENGTH = 80


def _clean_tier(value: Any) -> str:
    tier = str(value or "").strip().lower()
    if tier == "admin":
        raise AuthError("An invite can't create an admin account")
    if tier not in INVITE_TIERS:
        raise AuthError("Choose the tier an invited account starts at: free, player, gm or creator")
    return tier


def _clean_label(value: Any) -> str:
    label = str(value or "").strip()[:LABEL_LENGTH]
    if not label:
        raise AuthError("Give the invite a label so you can tell where sign-ups came from")
    return label


def _clean_max_uses(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise AuthError("The use limit must be a whole number") from None
    if number < 1:
        raise AuthError("The use limit must be at least 1, or left empty for no limit")
    return number


def _clean_expires(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", ""))
    except ValueError:
        raise AuthError("The expiry must be a date and time") from None
    return parsed.replace(microsecond=0).isoformat()


def _uses(state: ServerState, code: str) -> int:
    row = state.db.execute("SELECT COUNT(*) AS n FROM users WHERE invite_code = ?", (code,)).fetchone()
    return int(row["n"]) if row else 0


def _serialize(state: ServerState, row, *, with_members: bool = False) -> Dict[str, Any]:
    item = {
        "code": row["code"],
        "label": row["label"],
        "tier": row["tier"],
        "createdAt": row["created_at"],
        "expiresAt": row["expires_at"],
        "maxUses": row["max_uses"],
        "active": bool(row["active"]),
        "uses": _uses(state, row["code"]),
    }
    if with_members:
        members = state.db.execute(
            "SELECT username FROM users WHERE invite_code = ? ORDER BY created_at, username", (row["code"],)
        ).fetchall()
        item["members"] = [member["username"] for member in members]
    return item


def create_invite(state: ServerState, admin_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
    label = _clean_label(data.get("label"))
    tier = _clean_tier(data.get("tier"))
    max_uses = _clean_max_uses(data.get("maxUses"))
    expires_at = _clean_expires(data.get("expiresAt"))
    code = "".join(secrets.choice(_ALPHABET) for _ in range(CODE_LENGTH))
    with state.lock:
        state.db.execute(
            "INSERT INTO invites (code, label, tier, created_by, expires_at, max_uses, active) VALUES (?, ?, ?, ?, ?, ?, 1)",
            (code, label, tier, admin_id, expires_at, max_uses),
        )
        state.db.commit()
        row = state.db.execute("SELECT * FROM invites WHERE code = ?", (code,)).fetchone()
        return _serialize(state, row, with_members=True)


def list_invites(state: ServerState) -> List[Dict[str, Any]]:
    rows = state.db.execute("SELECT * FROM invites ORDER BY created_at DESC, code").fetchall()
    return [_serialize(state, row, with_members=True) for row in rows]


def update_invite(state: ServerState, code: str, data: Dict[str, Any]) -> Dict[str, Any]:
    with state.lock:
        row = state.db.execute("SELECT * FROM invites WHERE code = ?", (code,)).fetchone()
        if not row:
            raise AuthError("That invite doesn't exist")
        label = _clean_label(data["label"]) if "label" in data else row["label"]
        tier = _clean_tier(data["tier"]) if "tier" in data else row["tier"]
        max_uses = _clean_max_uses(data["maxUses"]) if "maxUses" in data else row["max_uses"]
        expires_at = _clean_expires(data["expiresAt"]) if "expiresAt" in data else row["expires_at"]
        active = (1 if data["active"] else 0) if "active" in data else row["active"]
        state.db.execute(
            "UPDATE invites SET label = ?, tier = ?, max_uses = ?, expires_at = ?, active = ? WHERE code = ?",
            (label, tier, max_uses, expires_at, active, code),
        )
        state.db.commit()
        return _serialize(state, state.db.execute("SELECT * FROM invites WHERE code = ?", (code,)).fetchone(), with_members=True)


def delete_invite(state: ServerState, code: str) -> None:
    with state.lock:
        state.db.execute("DELETE FROM invites WHERE code = ?", (code,))
        state.db.commit()


def validate_invite(state: ServerState, code: str) -> Dict[str, Any]:
    """The invite for `code`, or an AuthError saying why it can't be used."""
    normalized = str(code or "").strip().lower()
    with state.lock:
        row = state.db.execute("SELECT * FROM invites WHERE code = ?", (normalized,)).fetchone()
        if not row:
            raise AuthError("That invite code isn't valid")
        if not row["active"]:
            raise AuthError("That invite has been switched off")
        if row["expires_at"] and datetime.fromisoformat(row["expires_at"]) < datetime.utcnow():
            raise AuthError("That invite has expired")
        if row["max_uses"] is not None and _uses(state, normalized) >= row["max_uses"]:
            raise AuthError("That invite has been used up")
        return {"code": row["code"], "label": row["label"], "tier": row["tier"]}
