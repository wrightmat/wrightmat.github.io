from __future__ import annotations

from typing import Dict, List

from .auth import AuthError, User
from .state import ServerState


def list_shares(state: ServerState, content_type: str, content_id: str, user: User) -> List[Dict[str, str]]:
    rows = state.db.execute(
        """
        SELECT shares.id, users.username, shares.permissions
        FROM shares JOIN users ON users.id = shares.shared_with_user_id
        WHERE shares.content_type = ? AND shares.content_id = ?
        """,
        (content_type, content_id),
    ).fetchall()
    return [dict(row) for row in rows]


def share_with_user(state: ServerState, content_type: str, content_id: str, username: str, permissions: str) -> Dict[str, str]:
    user_row = state.db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if not user_row:
        raise AuthError("User not found")
    state.db.execute(
        """
        INSERT INTO shares (content_type, content_id, shared_with_user_id, permissions)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(content_type, content_id, shared_with_user_id) DO UPDATE SET permissions=excluded.permissions
        """,
        (content_type, content_id, user_row["id"], permissions),
    )
    state.db.commit()
    return {"content_type": content_type, "content_id": content_id, "username": username, "permissions": permissions}


def revoke_share(state: ServerState, content_type: str, content_id: str, username: str) -> None:
    user_row = state.db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if not user_row:
        raise AuthError("User not found")
    state.db.execute(
        "DELETE FROM shares WHERE content_type = ? AND content_id = ? AND shared_with_user_id = ?",
        (content_type, content_id, user_row["id"]),
    )
    state.db.commit()
