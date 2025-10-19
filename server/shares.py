from __future__ import annotations

import secrets
from datetime import datetime
from typing import Dict, List, Optional

from .auth import AuthError, User
from .state import ServerState
from .roles import role_rank


ALLOWED_PERMISSIONS = {"view", "edit"}
SHARE_ROLE_THRESHOLDS = {
    "character": "free",
    "template": "gm",
    "system": "creator",
}


def _normalize_permissions(value: str) -> str:
    normalized = (value or "").strip().lower()
    return normalized if normalized in ALLOWED_PERMISSIONS else "view"


def list_shares(state: ServerState, content_type: str, content_id: str, user: User) -> List[Dict[str, str]]:
    rows = state.db.execute(
        """
        SELECT shares.id, users.username, shares.permissions
        FROM shares JOIN users ON users.id = shares.shared_with_user_id
        WHERE shares.content_type = ? AND shares.content_id = ?
        ORDER BY users.username COLLATE NOCASE
        """,
        (content_type, content_id),
    ).fetchall()
    return [dict(row) for row in rows]


def list_shareable_users(state: ServerState, content_type: str) -> List[Dict[str, str]]:
    threshold = SHARE_ROLE_THRESHOLDS.get(content_type, "free")
    min_rank = role_rank(threshold) if threshold else -1
    rows = state.db.execute(
        """
        SELECT username, tier
        FROM users
        WHERE is_active = 1
        ORDER BY username COLLATE NOCASE
        """,
    ).fetchall()
    eligible: List[Dict[str, str]] = []
    for row in rows:
        username = row["username"]
        tier = (row["tier"] or "free").strip().lower()
        if min_rank >= 0 and role_rank(tier) < min_rank:
            continue
        eligible.append({"username": username, "tier": tier})
    return eligible


def share_with_user(
    state: ServerState, content_type: str, content_id: str, username: str, permissions: str
) -> Dict[str, str]:
    user_row = state.db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if not user_row:
        raise AuthError("User not found")
    normalized_permissions = _normalize_permissions(permissions)
    state.db.execute(
        """
        INSERT INTO shares (content_type, content_id, shared_with_user_id, permissions)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(content_type, content_id, shared_with_user_id)
        DO UPDATE SET permissions=excluded.permissions
        """,
        (content_type, content_id, user_row["id"], normalized_permissions),
    )
    state.db.commit()
    return {
        "content_type": content_type,
        "content_id": content_id,
        "username": username,
        "permissions": normalized_permissions,
    }


def revoke_share(state: ServerState, content_type: str, content_id: str, username: str) -> None:
    user_row = state.db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if not user_row:
        raise AuthError("User not found")
    state.db.execute(
        "DELETE FROM shares WHERE content_type = ? AND content_id = ? AND shared_with_user_id = ?",
        (content_type, content_id, user_row["id"]),
    )
    state.db.commit()


def _generate_token() -> str:
    # 192 bits of entropy encoded as URL-safe text (~32 chars)
    return secrets.token_urlsafe(24)


def create_share_link(
    state: ServerState, content_type: str, content_id: str, permissions: str = "view"
) -> Dict[str, str]:
    normalized_permissions = _normalize_permissions(permissions)
    token = _generate_token()
    timestamp = datetime.utcnow().isoformat()
    state.db.execute(
        """
        INSERT INTO share_links (content_type, content_id, token, permissions, created_at, last_accessed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(content_type, content_id) DO UPDATE SET
            token=excluded.token,
            permissions=excluded.permissions,
            created_at=excluded.created_at,
            last_accessed_at=excluded.last_accessed_at
        """,
        (content_type, content_id, token, normalized_permissions, timestamp, timestamp),
    )
    state.db.commit()
    return {
        "content_type": content_type,
        "content_id": content_id,
        "token": token,
        "permissions": normalized_permissions,
        "created_at": timestamp,
        "last_accessed_at": timestamp,
    }


def revoke_share_link(state: ServerState, content_type: str, content_id: str) -> None:
    state.db.execute(
        "DELETE FROM share_links WHERE content_type = ? AND content_id = ?",
        (content_type, content_id),
    )
    state.db.commit()


def get_share_link(state: ServerState, content_type: str, content_id: str) -> Optional[Dict[str, str]]:
    row = state.db.execute(
        """
        SELECT token, permissions, created_at, last_accessed_at
        FROM share_links
        WHERE content_type = ? AND content_id = ?
        """,
        (content_type, content_id),
    ).fetchone()
    if not row:
        return None
    return {
        "content_type": content_type,
        "content_id": content_id,
        "token": row["token"],
        "permissions": row["permissions"],
        "created_at": row["created_at"],
        "last_accessed_at": row["last_accessed_at"],
    }


def resolve_share_token(state: ServerState, token: str) -> Optional[Dict[str, str]]:
    if not token:
        return None
    row = state.db.execute(
        """
        SELECT content_type, content_id, permissions
        FROM share_links
        WHERE token = ?
        """,
        (token,),
    ).fetchone()
    if not row:
        return None
    return {
        "content_type": row["content_type"],
        "content_id": row["content_id"],
        "permissions": row["permissions"],
        "token": token,
    }


def touch_share_link(state: ServerState, token: str) -> None:
    if not token:
        return
    timestamp = datetime.utcnow().isoformat()
    state.db.execute(
        "UPDATE share_links SET last_accessed_at = ? WHERE token = ?",
        (timestamp, token),
    )
    state.db.commit()
