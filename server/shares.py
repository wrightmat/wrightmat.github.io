from __future__ import annotations

import secrets
from datetime import datetime
from typing import Dict, List, Optional

from .auth import AuthError, User
from .kinds import load_kind_policy, normalize_kind
from .state import ServerState
from .roles import role_rank


ALL_USERS_DISPLAY = "All Users"
ALL_USERS_SPECIAL = "all-users"
ALL_USERS_ALIASES = {alias.lower(): ALL_USERS_SPECIAL for alias in ["all users", "all-users", "allusers"]}


ALLOWED_PERMISSIONS = {"view", "edit"}


def _normalize_permissions(value: str) -> str:
    normalized = (value or "").strip().lower()
    return normalized if normalized in ALLOWED_PERMISSIONS else "view"


# "Share with All Users" is really just "make it public" — every Library kind
# supports is_public now (library_items), so there's no fixed allowlist of
# which content types this shortcut works for anymore.
def _is_all_users_username(username: str) -> bool:
    if not username:
        return False
    return username.strip().lower() in ALL_USERS_ALIASES


def _record_is_public(state: ServerState, content_type: str, content_id: str) -> bool:
    if not content_id:
        return False
    row = state.db.execute(
        "SELECT is_public FROM library_items WHERE kind = ? AND id = ?",
        (content_type, content_id),
    ).fetchone()
    if not row:
        return False
    return bool(row["is_public"])


def _set_record_public(state: ServerState, content_type: str, content_id: str, is_public: bool) -> None:
    if not content_id:
        raise AuthError("Invalid content type")
    cursor = state.db.execute(
        "UPDATE library_items SET is_public = ? WHERE kind = ? AND id = ?",
        (1 if is_public else 0, content_type, content_id),
    )
    if cursor.rowcount == 0:
        raise AuthError("Content not found")
    state.db.commit()


def list_shares(state: ServerState, content_type: str, content_id: str, user: User) -> List[Dict[str, str]]:
    user_rows = state.db.execute(
        """
        SELECT shares.id, users.username, shares.permissions
        FROM shares JOIN users ON users.id = shares.shared_with_user_id
        WHERE shares.content_type = ? AND shares.content_id = ?
        ORDER BY users.username COLLATE NOCASE
        """,
        (content_type, content_id),
    ).fetchall()
    group_rows = state.db.execute(
        """
        SELECT shares.id, groups.id AS group_id, groups.name AS group_name, shares.permissions
        FROM shares JOIN groups ON groups.id = shares.shared_with_group_id
        WHERE shares.content_type = ? AND shares.content_id = ?
        ORDER BY groups.name COLLATE NOCASE
        """,
        (content_type, content_id),
    ).fetchall()
    shares = [dict(row) for row in user_rows]
    shares.extend({**dict(row), "type": "group"} for row in group_rows)
    if _record_is_public(state, content_type, content_id):
        shares.append({
            "username": ALL_USERS_DISPLAY,
            "permissions": "view",
            "special": ALL_USERS_SPECIAL,
        })
    return shares


def list_shareable_targets(state: ServerState, content_type: str, user: Optional[User]) -> List[Dict[str, str]]:
    # The bar for "can this user usefully receive this content" is the same
    # bar as reading it, so this reuses the kind's readTier rather than a
    # separate, easy-to-drift policy dimension. Groups are listed alongside
    # users in one merged list (a `type` field distinguishes them) so every
    # tool's existing "share with..." picker can offer both without a
    # separate UI surface — sharing "with a group" grants every member's
    # owning user access at once via the group-membership resolution in
    # storage.py's is_shared()/list_bucket().
    threshold = load_kind_policy(state, content_type)["readTier"]
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
        eligible.append({"type": "user", "username": username, "tier": tier})
    all_users_entry = {"type": "user", "username": ALL_USERS_DISPLAY, "tier": "", "special": ALL_USERS_SPECIAL}
    groups: List[Dict[str, str]] = []
    if user:
        group_rows = state.db.execute(
            "SELECT id, name FROM groups WHERE owner_id = ? ORDER BY name COLLATE NOCASE",
            (user.id,),
        ).fetchall()
        groups = [{"type": "group", "id": row["id"], "name": row["name"]} for row in group_rows]
    return [all_users_entry, *eligible, *groups]


# Exported (not just used internally by share_with_user/share_with_group):
# groups.py's create_group_log_entry reuses this too, for the same "spotlight
# payload references a real record" check — a share and a spotlight log
# entry should never be creatable against content that was never actually
# saved.
def content_exists(state: ServerState, content_type: str, content_id: str) -> bool:
    row = state.db.execute(
        "SELECT 1 FROM library_items WHERE kind = ? AND id = ?",
        (normalize_kind(content_type), content_id),
    ).fetchone()
    return bool(row)


def share_with_user(
    state: ServerState, content_type: str, content_id: str, username: str, permissions: str
) -> Dict[str, str]:
    if not content_exists(state, content_type, content_id):
        raise AuthError("Save this record before sharing it")
    if _is_all_users_username(username):
        _set_record_public(state, content_type, content_id, True)
        return {
            "content_type": content_type,
            "content_id": content_id,
            "username": ALL_USERS_DISPLAY,
            "permissions": "view",
            "special": ALL_USERS_SPECIAL,
        }
    user_row = state.db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if not user_row:
        raise AuthError("User not found")
    normalized_permissions = _normalize_permissions(permissions)
    state.db.execute(
        """
        INSERT INTO shares (content_type, content_id, shared_with_user_id, permissions)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(content_type, content_id, shared_with_user_id) WHERE shared_with_user_id IS NOT NULL
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
    if _is_all_users_username(username):
        _set_record_public(state, content_type, content_id, False)
        return
    user_row = state.db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if not user_row:
        raise AuthError("User not found")
    state.db.execute(
        "DELETE FROM shares WHERE content_type = ? AND content_id = ? AND shared_with_user_id = ?",
        (content_type, content_id, user_row["id"]),
    )
    state.db.commit()


def _group_belongs_to(state: ServerState, group_id: str, user: User) -> bool:
    # Only a group's own owner (or admin) can use it as a share target —
    # sharing "with a group" grants every member's owner access, which should
    # only ever be the acting GM's own call for their own campaign, not
    # something any user can do to an arbitrary group they merely know the
    # id of.
    if user.tier == "admin":
        return True
    row = state.db.execute("SELECT owner_id FROM groups WHERE id = ?", (group_id,)).fetchone()
    return bool(row) and row["owner_id"] == user.id


def share_with_group(
    state: ServerState, content_type: str, content_id: str, group_id: str, permissions: str, user: User
) -> Dict[str, str]:
    # ensure_share_permission's is_owner check unconditionally passes for
    # admin-tier callers regardless of whether content_id is a real, saved
    # record (is_owner short-circuits to True for admins before ever
    # querying library_items) — this is the one path that actually needs its
    # own existence check as a result, since nothing upstream of here
    # enforces it for that tier. Without this, "Show this item" on a
    # generated-but-never-saved record would silently create a share + a
    # spotlight log entry pointing at nothing, only failing later (and
    # confusingly) when a viewer tries to actually fetch it.
    if not content_exists(state, content_type, content_id):
        raise AuthError("Save this record before sharing it")
    group_row = state.db.execute("SELECT id, name FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not group_row or not _group_belongs_to(state, group_id, user):
        raise AuthError("Group not found")
    normalized_permissions = _normalize_permissions(permissions)
    state.db.execute(
        """
        INSERT INTO shares (content_type, content_id, shared_with_group_id, permissions)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(content_type, content_id, shared_with_group_id) WHERE shared_with_group_id IS NOT NULL
        DO UPDATE SET permissions=excluded.permissions
        """,
        (content_type, content_id, group_id, normalized_permissions),
    )
    state.db.commit()
    return {
        "content_type": content_type,
        "content_id": content_id,
        "group_id": group_id,
        "group_name": group_row["name"],
        "permissions": normalized_permissions,
    }


def revoke_group_share(state: ServerState, content_type: str, content_id: str, group_id: str) -> None:
    state.db.execute(
        "DELETE FROM shares WHERE content_type = ? AND content_id = ? AND shared_with_group_id = ?",
        (content_type, content_id, group_id),
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


def get_share_links_batch(state: ServerState, content_type: str, content_ids: List[str]) -> Dict[str, Dict[str, str]]:
    if not content_ids:
        return {}
    placeholders = ",".join("?" for _ in content_ids)
    rows = state.db.execute(
        f"""
        SELECT content_id, token, permissions, created_at, last_accessed_at
        FROM share_links
        WHERE content_type = ? AND content_id IN ({placeholders})
        """,
        (content_type, *content_ids),
    ).fetchall()
    return {
        row["content_id"]: {
            "content_type": content_type,
            "content_id": row["content_id"],
            "token": row["token"],
            "permissions": row["permissions"],
            "created_at": row["created_at"],
            "last_accessed_at": row["last_accessed_at"],
        }
        for row in rows
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
