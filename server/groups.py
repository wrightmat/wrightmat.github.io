from __future__ import annotations

import json
import secrets
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .auth import AuthError, User
from .shares import (
    create_share_link,
    get_share_link,
    resolve_share_token,
    revoke_share_link,
    touch_share_link,
)
from .state import ServerState

_GROUP_ID_PREFIX = "grp_"


def _generate_group_id(state: ServerState) -> str:
    while True:
        candidate = f"{_GROUP_ID_PREFIX}{secrets.token_hex(6)}"
        row = state.db.execute("SELECT 1 FROM groups WHERE id = ?", (candidate,)).fetchone()
        if not row:
            return candidate


def _normalize_group_type(raw: Optional[str]) -> str:
    value = (raw or "").strip().lower()
    return value or "campaign"


def _require_owner(state: ServerState, group_id: str, owner: Optional[User]):
    if not owner:
        raise AuthError("Authentication required")
    row = state.db.execute(
        """
        SELECT id, owner_id, name, type, created_at, modified_at
        FROM groups
        WHERE id = ?
        """,
        (group_id,),
    ).fetchone()
    if not row:
        raise AuthError("Group not found")
    if row["owner_id"] != owner.id:
        raise AuthError("Access denied")
    return row


def _fetch_group_members(state: ServerState, group_id: str) -> List[Dict[str, Any]]:
    rows = state.db.execute(
        """
        SELECT gm.content_type,
               gm.content_id,
               gm.added_at,
               c.name AS character_name,
               c.system AS character_system,
               c.template AS character_template,
               s.title AS system_title,
               t.title AS template_title,
               c.owner_id AS character_owner_id,
               u.username AS owner_username
        FROM group_members AS gm
        LEFT JOIN characters AS c ON gm.content_type = 'character' AND c.id = gm.content_id
        LEFT JOIN systems AS s ON c.system = s.id
        LEFT JOIN templates AS t ON c.template = t.id
        LEFT JOIN users AS u ON u.id = c.owner_id
        WHERE gm.group_id = ?
        ORDER BY COALESCE(c.name, gm.content_id) COLLATE NOCASE
        """,
        (group_id,),
    ).fetchall()
    members: List[Dict[str, Any]] = []
    for row in rows:
        content_type = row["content_type"]
        content_id = row["content_id"]
        if not content_type or not content_id:
            continue
        entry: Dict[str, Any] = {
            "content_type": content_type,
            "content_id": content_id,
            "added_at": row["added_at"],
        }
        if content_type == "character":
            entry.update(
                {
                    "label": row["character_name"] or content_id,
                    "system": row["character_system"] or "",
                    "system_name": row["system_title"] or row["character_system"] or "",
                    "template": row["character_template"] or "",
                    "template_title": row["template_title"] or "",
                    "owner_id": row["character_owner_id"],
                    "owner_username": row["owner_username"] or "",
                    "missing": row["character_name"] is None,
                }
            )
        members.append(entry)
    return members


def _attach_member_status(members: Iterable[Dict[str, Any]], owner_id: Optional[int]) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for member in members:
        entry = dict(member)
        if entry.get("content_type") == "character":
            owner_matches = owner_id is not None and entry.get("owner_id") == owner_id
            entry["is_claimed"] = not owner_matches and not entry.get("missing", False)
        results.append(entry)
    return results


def _serialize_group(row, members: List[Dict[str, Any]], share_link: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "type": row["type"],
        "created_at": row["created_at"],
        "modified_at": row["modified_at"],
        "share_link": share_link,
        "members": members,
    }


def _sanitize_log_limit(raw: Optional[int]) -> int:
    try:
        value = int(raw) if raw is not None else 100
    except (TypeError, ValueError):
        return 100
    return max(1, min(value, 200))


def _serialize_log_entries(rows: Iterable) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for row in rows:
        if not row:
            continue
        payload = None
        payload_raw = row["payload"] if "payload" in row.keys() else None
        if payload_raw:
            try:
                payload = json.loads(payload_raw)
            except json.JSONDecodeError:
                payload = None
        entries.append(
            {
                "id": row["id"],
                "type": row["entry_type"],
                "message": row["message"] or "",
                "payload": payload,
                "author": {
                    "id": row["author_id"],
                    "name": row["author_name"] or "",
                },
                "created_at": row["created_at"],
            }
        )
    return entries


def _resolve_group_access(
    state: ServerState,
    group_id: Optional[str],
    user: Optional[User],
    *,
    share_token: Optional[str] = None,
) -> Tuple[Any, bool]:
    resolved_id = (group_id or "").strip()
    share_mode = False
    token = (share_token or "").strip()
    if token:
        info = resolve_share_token(state, token)
        if not info or info.get("content_type") != "group":
            raise AuthError("Invalid or expired share link")
        resolved_id = info.get("content_id", "").strip() or resolved_id
        if not resolved_id:
            raise AuthError("Group not found")
        touch_share_link(state, token)
        share_mode = True
    if not resolved_id:
        raise AuthError("Group not found")
    row = state.db.execute(
        """
        SELECT id, owner_id, name, type
        FROM groups
        WHERE id = ?
        """,
        (resolved_id,),
    ).fetchone()
    if not row:
        raise AuthError("Group not found")
    if row["type"] and row["type"].lower() != "campaign":
        raise AuthError("Game log is only available for campaign groups")
    if share_mode:
        return row, True
    if not user:
        raise AuthError("Authentication required")
    if user.tier == "admin" or row["owner_id"] == user.id:
        return row, False
    membership = state.db.execute(
        """
        SELECT 1
        FROM group_members AS gm
        JOIN characters AS c
          ON gm.content_type = 'character' AND gm.content_id = c.id
        WHERE gm.group_id = ?
          AND c.owner_id = ?
        LIMIT 1
        """,
        (resolved_id, user.id),
    ).fetchone()
    if membership:
        return row, False
    raise AuthError("Access denied")


def _fetch_group_log_entries(state: ServerState, group_id: str, limit: int) -> List[Dict[str, Any]]:
    rows = state.db.execute(
        """
        SELECT id, entry_type, author_id, author_name, message, payload, created_at
        FROM group_logs
        WHERE group_id = ?
        ORDER BY id DESC
        LIMIT ?
        """,
        (group_id, limit),
    ).fetchall()
    ordered = list(rows)
    ordered.reverse()
    return _serialize_log_entries(ordered)


def list_group_log(
    state: ServerState,
    group_id: Optional[str],
    user: Optional[User],
    *,
    share_token: Optional[str] = None,
    limit: Optional[int] = None,
) -> Dict[str, Any]:
    row, share_mode = _resolve_group_access(state, group_id, user, share_token=share_token)
    limit_value = _sanitize_log_limit(limit)
    entries = _fetch_group_log_entries(state, row["id"], limit_value)
    payload: Dict[str, Any] = {
        "group": {"id": row["id"], "name": row["name"], "type": row["type"]},
        "entries": entries,
    }
    if share_mode and share_token:
        payload["share"] = {"token": share_token}
    return payload


def create_group_log_entry(
    state: ServerState,
    group_id: Optional[str],
    user: Optional[User],
    *,
    share_token: Optional[str] = None,
    entry_type: str = "message",
    message: str = "",
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not user:
        raise AuthError("Sign in to post to the game log")
    row, _ = _resolve_group_access(state, group_id, user, share_token=share_token)
    normalized_type = (entry_type or "").strip().lower() or "message"
    if normalized_type not in {"message", "roll"}:
        raise AuthError("Unsupported log entry type")
    text = (message or "").strip()
    if text:
        text = text[:2000]
    payload_value: Optional[Dict[str, Any]] = None
    if isinstance(payload, dict) and payload:
        payload_value = payload
    if normalized_type == "message" and not text and not payload_value:
        raise AuthError("Message cannot be empty")
    if normalized_type == "roll":
        if not payload_value:
            raise AuthError("Roll payload is required")
    payload_data = None
    if payload_value is not None:
        try:
            payload_data = json.dumps(payload_value)
        except (TypeError, ValueError) as exc:
            raise AuthError("Invalid payload") from exc
    timestamp = datetime.utcnow().isoformat()
    cursor = state.db.execute(
        """
        INSERT INTO group_logs (group_id, entry_type, author_id, author_name, message, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (row["id"], normalized_type, user.id, user.username or "", text or None, payload_data, timestamp),
    )
    state.db.execute(
        "UPDATE groups SET modified_at = ? WHERE id = ?",
        (timestamp, row["id"]),
    )
    state.db.commit()
    entry_row = state.db.execute(
        """
        SELECT id, entry_type, author_id, author_name, message, payload, created_at
        FROM group_logs
        WHERE id = ?
        """,
        (cursor.lastrowid,),
    ).fetchone()
    serialized = _serialize_log_entries([entry_row])
    return serialized[0] if serialized else {}


def list_character_groups(state: ServerState, user: Optional[User], character_id: str) -> Dict[str, Any]:
    if not user:
        raise AuthError("Authentication required")
    if not character_id:
        raise AuthError("Character id is required")
    character_row = state.db.execute(
        "SELECT id, owner_id FROM characters WHERE id = ?",
        (character_id,),
    ).fetchone()
    if not character_row:
        raise AuthError("Character not found")
    owner_id = character_row["owner_id"]
    if owner_id != user.id and user.tier != "admin":
        ownership = state.db.execute(
            """
            SELECT g.owner_id
            FROM group_members AS gm
            JOIN groups AS g ON g.id = gm.group_id
            WHERE gm.content_type = 'character' AND gm.content_id = ? AND g.owner_id = ?
            LIMIT 1
            """,
            (character_id, user.id),
        ).fetchone()
        if not ownership and owner_id != user.id:
            raise AuthError("Access denied")
    rows = state.db.execute(
        """
        SELECT g.id, g.name, g.type, g.owner_id
        FROM group_members AS gm
        JOIN groups AS g ON g.id = gm.group_id
        WHERE gm.content_type = 'character' AND gm.content_id = ?
        ORDER BY g.modified_at DESC
        """,
        (character_id,),
    ).fetchall()
    groups: List[Dict[str, Any]] = []
    for row in rows:
        if user.tier == "admin" or row["owner_id"] == user.id or owner_id == user.id:
            groups.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "type": row["type"],
                    "owner_id": row["owner_id"],
                }
            )
    return {"groups": groups}


def list_groups(state: ServerState, owner: Optional[User]) -> Dict[str, Any]:
    if not owner:
        raise AuthError("Authentication required")
    rows = state.db.execute(
        """
        SELECT id, owner_id, name, type, created_at, modified_at
        FROM groups
        WHERE owner_id = ?
        ORDER BY modified_at DESC
        """,
        (owner.id,),
    ).fetchall()
    groups: List[Dict[str, Any]] = []
    for row in rows:
        members = _attach_member_status(_fetch_group_members(state, row["id"]), row["owner_id"])
        share_link = get_share_link(state, "group", row["id"])
        groups.append(_serialize_group(row, members, share_link))
    return {"groups": groups}


def create_group(state: ServerState, owner: Optional[User], name: str, type_: Optional[str] = None) -> Dict[str, Any]:
    if not owner:
        raise AuthError("Authentication required")
    label = (name or "").strip()
    if not label:
        raise AuthError("Group name is required")
    group_id = _generate_group_id(state)
    normalized_type = _normalize_group_type(type_)
    timestamp = datetime.utcnow().isoformat()
    state.db.execute(
        """
        INSERT INTO groups (id, owner_id, name, type, created_at, modified_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (group_id, owner.id, label, normalized_type, timestamp, timestamp),
    )
    state.db.commit()
    row = state.db.execute(
        "SELECT id, owner_id, name, type, created_at, modified_at FROM groups WHERE id = ?",
        (group_id,),
    ).fetchone()
    members: List[Dict[str, Any]] = []
    return _serialize_group(row, _attach_member_status(members, owner.id), None)


def update_group(state: ServerState, owner: Optional[User], group_id: str, name: Optional[str] = None) -> Dict[str, Any]:
    row = _require_owner(state, group_id, owner)
    updates: Dict[str, Any] = {}
    if name is not None:
        label = name.strip()
        if not label:
            raise AuthError("Group name is required")
        updates["name"] = label
    if not updates:
        members = _attach_member_status(_fetch_group_members(state, group_id), row["owner_id"])
        share_link = get_share_link(state, "group", group_id)
        return _serialize_group(row, members, share_link)
    updates["modified_at"] = datetime.utcnow().isoformat()
    assignments = ", ".join(f"{column} = ?" for column in updates)
    params = list(updates.values())
    params.append(group_id)
    state.db.execute(f"UPDATE groups SET {assignments} WHERE id = ?", params)
    state.db.commit()
    refreshed = state.db.execute(
        "SELECT id, owner_id, name, type, created_at, modified_at FROM groups WHERE id = ?",
        (group_id,),
    ).fetchone()
    members = _attach_member_status(_fetch_group_members(state, group_id), refreshed["owner_id"])
    share_link = get_share_link(state, "group", group_id)
    return _serialize_group(refreshed, members, share_link)


def delete_group(state: ServerState, owner: Optional[User], group_id: str) -> None:
    _require_owner(state, group_id, owner)
    state.db.execute("DELETE FROM groups WHERE id = ?", (group_id,))
    state.db.execute("DELETE FROM share_links WHERE content_type = ? AND content_id = ?", ("group", group_id))
    state.db.commit()


def update_group_members(state: ServerState, owner: Optional[User], group_id: str, character_ids: Iterable[str]) -> Dict[str, Any]:
    group_row = _require_owner(state, group_id, owner)
    normalized_ids = []
    seen = set()
    for raw in character_ids:
        if not raw:
            continue
        value = str(raw).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        normalized_ids.append(value)
    if normalized_ids:
        placeholders = ",".join("?" for _ in normalized_ids)
        query = f"SELECT id, owner_id FROM characters WHERE id IN ({placeholders})"
        rows = state.db.execute(query, normalized_ids).fetchall()
        existing = {row["id"] for row in rows}
        missing = [value for value in normalized_ids if value not in existing]
        if missing:
            raise AuthError("One or more characters could not be found")
        for row in rows:
            if row["owner_id"] != group_row["owner_id"]:
                raise AuthError("Characters must be owned by this account to add to the group")
    state.db.execute("DELETE FROM group_members WHERE group_id = ? AND content_type = 'character'", (group_id,))
    timestamp = datetime.utcnow().isoformat()
    for character_id in normalized_ids:
        state.db.execute(
            """
            INSERT OR REPLACE INTO group_members (group_id, content_type, content_id, added_at)
            VALUES (?, 'character', ?, ?)
            """,
            (group_id, character_id, timestamp),
        )
    state.db.execute(
        "UPDATE groups SET modified_at = ? WHERE id = ?",
        (timestamp, group_id),
    )
    state.db.commit()
    refreshed = state.db.execute(
        "SELECT id, owner_id, name, type, created_at, modified_at FROM groups WHERE id = ?",
        (group_id,),
    ).fetchone()
    members = _attach_member_status(_fetch_group_members(state, group_id), refreshed["owner_id"])
    share_link = get_share_link(state, "group", group_id)
    return _serialize_group(refreshed, members, share_link)


def get_group_share_details(state: ServerState, token: str) -> Dict[str, Any]:
    info = resolve_share_token(state, token)
    if not info or info.get("content_type") != "group":
        raise AuthError("Invalid or expired share link")
    touch_share_link(state, token)
    group_id = info["content_id"]
    row = state.db.execute(
        """
        SELECT id, owner_id, name, type, created_at, modified_at
        FROM groups
        WHERE id = ?
        """,
        (group_id,),
    ).fetchone()
    if not row:
        raise AuthError("Group not found")
    members = _attach_member_status(_fetch_group_members(state, group_id), row["owner_id"])
    available = [member for member in members if member.get("content_type") == "character" and not member.get("is_claimed")]
    return {
        "token": token,
        "group": {
            "id": row["id"],
            "name": row["name"],
            "type": row["type"],
        },
        "members": members,
        "available": available,
    }


def claim_group_character(state: ServerState, token: str, character_id: str, user: Optional[User]) -> Dict[str, Any]:
    if not user:
        raise AuthError("Sign in to claim a character")
    info = resolve_share_token(state, token)
    if not info or info.get("content_type") != "group":
        raise AuthError("Invalid or expired share link")
    group_id = info["content_id"]
    group_row = state.db.execute(
        "SELECT id, owner_id, name FROM groups WHERE id = ?",
        (group_id,),
    ).fetchone()
    if not group_row:
        raise AuthError("Group not found")
    membership = state.db.execute(
        """
        SELECT content_id
        FROM group_members
        WHERE group_id = ? AND content_type = 'character' AND content_id = ?
        """,
        (group_id, character_id),
    ).fetchone()
    if not membership:
        raise AuthError("Character is not part of this group")
    character_row = state.db.execute(
        """
        SELECT id, name, owner_id, system
        FROM characters
        WHERE id = ?
        """,
        (character_id,),
    ).fetchone()
    if not character_row:
        raise AuthError("Character not found")
    if character_row["owner_id"] != group_row["owner_id"]:
        raise AuthError("This character has already been claimed")
    timestamp = datetime.utcnow().isoformat()
    state.db.execute(
        """
        UPDATE characters
        SET owner_id = ?, modified_at = ?, last_accessed_at = ?
        WHERE id = ?
        """,
        (user.id, timestamp, timestamp, character_id),
    )
    state.db.commit()
    touch_share_link(state, token)
    return {
        "character": {
            "id": character_row["id"],
            "name": character_row["name"],
            "system": character_row["system"],
        },
        "group": {
            "id": group_row["id"],
            "name": group_row["name"],
        },
    }


def ensure_group_share_link(state: ServerState, owner: Optional[User], group_id: str) -> Dict[str, Any]:
    _require_owner(state, group_id, owner)
    return create_share_link(state, "group", group_id)


def revoke_group_share_link(state: ServerState, owner: Optional[User], group_id: str) -> None:
    _require_owner(state, group_id, owner)
    revoke_share_link(state, "group", group_id)


def get_group_share_link(state: ServerState, owner: Optional[User], group_id: str) -> Optional[Dict[str, Any]]:
    _require_owner(state, group_id, owner)
    return get_share_link(state, "group", group_id)
