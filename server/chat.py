from __future__ import annotations

import json
import re
import secrets
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from .auth import AuthError, User
from .groups import PLAYER_GROUP_TYPE, _group_member_user_ids, _resolve_group_access, accessible_group_ids
from .shares import content_exists
from .state import ServerState

MESSAGE_BODY_LIMIT = 2000
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
MAX_REFS = 50
CHANNEL_MODES = ("ic", "ooc")
VOICE_TYPES = ("user", "character", "npc", "monster")

# A reply is a message whose body opens with a reference to its parent.
_REPLY_PATTERN = re.compile(r"^\s*\[\[msg:(\d+)(?:\|[^\]]*)?\]\]")


def _now() -> str:
    return datetime.utcnow().isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


def _is_gm(row: Dict[str, Any], user: Optional[User]) -> bool:
    return bool(user) and (user.tier == "admin" or row["owner_id"] == user.id)


def _reaction_emoji(state: ServerState) -> List[str]:
    path = state.read_path("common", "data", "chat-reactions.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    entries = data.get("emoji") if isinstance(data, dict) else data
    return [entry["emoji"] for entry in entries if isinstance(entry, dict) and entry.get("emoji")] if isinstance(entries, list) else []


def _reaction_descriptions(state: ServerState) -> Dict[str, str]:
    """The tooltip text for each reaction emoji."""
    path = state.read_path("common", "data", "chat-reactions.json")
    try:
        entries = json.loads(path.read_text(encoding="utf-8")).get("emoji") or []
    except (OSError, json.JSONDecodeError, AttributeError):
        return {}
    return {entry["emoji"]: entry.get("description") or "" for entry in entries if isinstance(entry, dict) and entry.get("emoji")}


def _json_list(raw: Optional[str]) -> List[Any]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _json_object(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _access(
    state: ServerState, group_id: Optional[str], user: Optional[User], share_token: Optional[str]
) -> Tuple[Dict[str, Any], bool]:
    """Group access (owner/admin/member/share link) plus a guarantee that the
    group has its default channel and thread. Lazy because a Group is a
    generic Library kind and can be created through the generic save route
    without ever passing through groups.create_group."""
    row, share_mode = _resolve_group_access(state, group_id, user, share_token=share_token)
    ensure_default_chat(state, row["id"], row.get("owner_id"))
    return row, share_mode


def _require_poster(user: Optional[User]) -> User:
    if not user:
        raise AuthError("Sign in to post")
    return user


# --- Channels and threads --------------------------------------------------


def ensure_default_chat(state: ServerState, group_id: str, created_by: Optional[int] = None) -> None:
    if state.db.execute("SELECT 1 FROM chat_channels WHERE group_id = ? LIMIT 1", (group_id,)).fetchone():
        return
    channel_id = _new_id("chn")
    timestamp = _now()
    state.db.execute(
        """
        INSERT INTO chat_channels (id, group_id, name, mode, sort_order, is_default, created_by, created_at)
        VALUES (?, ?, 'General', NULL, 0, 1, ?, ?)
        """,
        (channel_id, group_id, created_by, timestamp),
    )
    state.db.execute(
        """
        INSERT INTO chat_threads (id, channel_id, group_id, title, created_by, created_at, is_default)
        VALUES (?, ?, ?, 'General', ?, ?, 1)
        """,
        (_new_id("thr"), channel_id, group_id, created_by, timestamp),
    )
    state.db.commit()


def ensure_default_chat_for_all_groups(state: ServerState) -> None:
    for row in state.db.execute("SELECT id, owner_id, metadata FROM library_items WHERE kind = 'group'").fetchall():
        metadata = _json_object(row["metadata"]) or {}
        if str(metadata.get("type") or PLAYER_GROUP_TYPE).lower() != PLAYER_GROUP_TYPE:
            continue
        ensure_default_chat(state, row["id"], row["owner_id"])


def _serialize_channel(row: Any) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "groupId": row["group_id"],
        "name": row["name"],
        "category": row["category"] or "",
        "linked": {"kind": row["linked_kind"], "id": row["linked_id"]} if row["linked_kind"] and row["linked_id"] else None,
        "mode": row["mode"] if row["mode"] in CHANNEL_MODES else None,
        "threadCreatorIds": [int(v) for v in _json_list(row["thread_creator_ids"]) if isinstance(v, (int, float))],
        "sortOrder": row["sort_order"] or 0,
        "isDefault": bool(row["is_default"]),
    }


def _serialize_thread(row: Any) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "channelId": row["channel_id"],
        "groupId": row["group_id"],
        "title": row["title"],
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
        "archivedAt": row["archived_at"],
        "archivePageId": row["archive_page_id"],
        "isDefault": bool(row["is_default"]),
    }


def _unread_by_thread(state: ServerState, group_id: str, user: Optional[User]) -> Dict[str, int]:
    if not user:
        return {}
    rows = state.db.execute(
        """
        SELECT m.thread_id AS thread_id, COUNT(*) AS unread
        FROM chat_messages AS m
        LEFT JOIN chat_thread_state AS s ON s.thread_id = m.thread_id AND s.user_id = ?
        WHERE m.group_id = ? AND m.deleted_at IS NULL AND m.author_id IS NOT ?
          AND m.id > COALESCE(s.last_read_message_id, 0)
        GROUP BY m.thread_id
        """,
        (user.id, group_id, user.id),
    ).fetchall()
    return {row["thread_id"]: row["unread"] for row in rows}


def chat_overview(
    state: ServerState, group_id: Optional[str], user: Optional[User], *, share_token: Optional[str] = None
) -> Dict[str, Any]:
    row, share_mode = _access(state, group_id, user, share_token)
    unread = _unread_by_thread(state, row["id"], user)
    channels = [
        _serialize_channel(c)
        for c in state.db.execute(
            "SELECT * FROM chat_channels WHERE group_id = ? ORDER BY sort_order, created_at, id", (row["id"],)
        )
    ]
    threads_by_channel: Dict[str, List[Dict[str, Any]]] = {}
    default_thread_id = None
    for t in state.db.execute(
        "SELECT * FROM chat_threads WHERE group_id = ? ORDER BY created_at, id", (row["id"],)
    ):
        entry = _serialize_thread(t)
        entry["unread"] = unread.get(t["id"], 0)
        threads_by_channel.setdefault(t["channel_id"], []).append(entry)
        if t["is_default"]:
            default_thread_id = t["id"]
    for channel in channels:
        channel["threads"] = threads_by_channel.get(channel["id"], [])
        channel["unread"] = sum(t["unread"] for t in channel["threads"] if not t["archivedAt"])
    gm = _is_gm(row, user)
    return {
        "group": {"id": row["id"], "name": row["name"], "ownerId": row["owner_id"]},
        "channels": channels,
        "defaultThreadId": default_thread_id,
        "reactionEmoji": _reaction_emoji(state),
        "reactionDescriptions": _reaction_descriptions(state),
        "viewer": {
            "userId": user.id if user else None,
            "isGm": gm,
            "canPost": bool(user),
            "readOnly": not user,
        },
        "share": {"token": share_token} if share_mode and share_token else None,
    }


def _load_channel(state: ServerState, group_id: str, channel_id: str) -> Any:
    channel = state.db.execute(
        "SELECT * FROM chat_channels WHERE id = ? AND group_id = ?", (channel_id, group_id)
    ).fetchone()
    if not channel:
        raise AuthError("Channel not found")
    return channel


def _load_thread(state: ServerState, group_id: str, thread_id: str) -> Any:
    thread = state.db.execute(
        "SELECT * FROM chat_threads WHERE id = ? AND group_id = ?", (thread_id, group_id)
    ).fetchone()
    if not thread:
        raise AuthError("Thread not found")
    return thread


def _clean_linked(state: ServerState, kind: Any, id_: Any) -> Tuple[Optional[str], Optional[str]]:
    kind_value = str(kind or "").strip()
    id_value = str(id_ or "").strip()
    if not kind_value or not id_value:
        return None, None
    if not content_exists(state, kind_value, id_value):
        raise AuthError("Linked record not found")
    return kind_value, id_value


def _clean_mode(raw: Any) -> Optional[str]:
    value = str(raw or "").strip().lower()
    if value and value not in CHANNEL_MODES:
        raise AuthError("Channel mode must be in-character or out-of-character")
    return value or None


def create_channel(
    state: ServerState,
    group_id: Optional[str],
    user: Optional[User],
    *,
    name: str,
    category: str = "",
    linked_kind: Any = None,
    linked_id: Any = None,
    mode: Any = None,
    thread_title: str = "",
) -> Dict[str, Any]:
    row, _ = _access(state, group_id, user, None)
    if not _is_gm(row, user):
        raise AuthError("Only the GM can create channels")
    label = (name or "").strip()[:80]
    if not label:
        raise AuthError("Channel name is required")
    first_thread = (thread_title or "").strip()[:120] or "General"
    kind_value, id_value = _clean_linked(state, linked_kind, linked_id)
    next_order = (
        state.db.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM chat_channels WHERE group_id = ?", (row["id"],)).fetchone()["n"]
    )
    channel_id = _new_id("chn")
    state.db.execute(
        """
        INSERT INTO chat_channels
            (id, group_id, name, category, linked_kind, linked_id, mode, sort_order, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (channel_id, row["id"], label, (category or "").strip()[:80] or None, kind_value, id_value,
         _clean_mode(mode), next_order, user.id, _now()),
    )
    thread_id = _new_id("thr")
    state.db.execute(
        "INSERT INTO chat_threads (id, channel_id, group_id, title, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (thread_id, channel_id, row["id"], first_thread, user.id, _now()),
    )
    _touch_group(state, row["id"])
    state.db.commit()
    return _serialize_channel(_load_channel(state, row["id"], channel_id))


def update_channel(
    state: ServerState, group_id: Optional[str], channel_id: str, user: Optional[User], fields: Dict[str, Any]
) -> Dict[str, Any]:
    row, _ = _access(state, group_id, user, None)
    if not _is_gm(row, user):
        raise AuthError("Only the GM can edit channels")
    channel = _load_channel(state, row["id"], channel_id)
    updates: Dict[str, Any] = {}
    if "name" in fields:
        label = str(fields["name"] or "").strip()[:80]
        if not label:
            raise AuthError("Channel name is required")
        updates["name"] = label
    if "category" in fields:
        updates["category"] = str(fields["category"] or "").strip()[:80] or None
    if "linked" in fields:
        linked = fields["linked"] if isinstance(fields["linked"], dict) else {}
        updates["linked_kind"], updates["linked_id"] = _clean_linked(state, linked.get("kind"), linked.get("id"))
    # A channel's mode is creator-set but changing it later doesn't rewrite
    # existing messages; it only gates future posts.
    if "mode" in fields:
        updates["mode"] = _clean_mode(fields["mode"])
    if "threadCreatorIds" in fields:
        members = _group_member_user_ids(state, row["id"], row.get("owner_id"))
        ids = sorted({int(v) for v in (fields["threadCreatorIds"] or []) if isinstance(v, (int, float))} & members)
        updates["thread_creator_ids"] = json.dumps(ids) if ids else None
    if "sortOrder" in fields and isinstance(fields["sortOrder"], (int, float)):
        updates["sort_order"] = int(fields["sortOrder"])
    if updates:
        assignments = ", ".join(f"{column} = ?" for column in updates)
        state.db.execute(
            f"UPDATE chat_channels SET {assignments} WHERE id = ?", (*updates.values(), channel["id"])
        )
        _touch_group(state, row["id"])
        state.db.commit()
    return _serialize_channel(_load_channel(state, row["id"], channel_id))


def create_thread(
    state: ServerState, group_id: Optional[str], channel_id: str, user: Optional[User], *, title: str
) -> Dict[str, Any]:
    row, _ = _access(state, group_id, user, None)
    user = _require_poster(user)
    channel = _load_channel(state, row["id"], channel_id)
    delegated = {int(v) for v in _json_list(channel["thread_creator_ids"]) if isinstance(v, (int, float))}
    if not (_is_gm(row, user) or user.id in delegated):
        raise AuthError("You can't start threads in this channel")
    label = (title or "").strip()[:120]
    if not label:
        raise AuthError("Thread title is required")
    thread_id = _new_id("thr")
    state.db.execute(
        "INSERT INTO chat_threads (id, channel_id, group_id, title, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (thread_id, channel["id"], row["id"], label, user.id, _now()),
    )
    _touch_group(state, row["id"])
    state.db.commit()
    thread = _serialize_thread(_load_thread(state, row["id"], thread_id))
    thread["unread"] = 0
    return thread


def _touch_group(state: ServerState, group_id: str) -> None:
    # The live stream watches library_items.modified_at for kinds without a
    # dedicated watermark; chat has its own, but structure changes (new
    # channel/thread) ride on this one.
    state.db.execute("UPDATE library_items SET modified_at = ? WHERE kind = 'group' AND id = ?", (_now(), group_id))


# --- Voices ----------------------------------------------------------------


def _validate_voice(
    state: ServerState,
    group_row: Dict[str, Any],
    user: User,
    voice: Any,
    channel_mode: Optional[str],
    *,
    system: bool,
) -> Dict[str, Any]:
    if not isinstance(voice, dict) or not voice:
        voice = {"type": "user", "id": user.id}
    voice_type = str(voice.get("type") or "").strip().lower()
    if voice_type not in VOICE_TYPES:
        raise AuthError("Unknown voice")
    gm = _is_gm(group_row, user)
    if voice_type == "user":
        if str(voice.get("id") or user.id) != str(user.id):
            raise AuthError("You can only speak as yourself")
        resolved = {"type": "user", "id": user.id, "name": user.username}
    elif voice_type == "character":
        char_id = str(voice.get("id") or "")
        character = state.db.execute(
            """
            SELECT li.title AS title FROM group_members AS gm
            JOIN library_items AS li ON li.kind = 'character' AND li.id = gm.content_id
            WHERE gm.group_id = ? AND gm.content_type = 'character' AND gm.content_id = ? AND li.owner_id = ?
            """,
            (group_row["id"], char_id, user.id),
        ).fetchone()
        if not character:
            raise AuthError("You can only speak as your own characters in this group")
        resolved = {"type": "character", "id": char_id, "name": character["title"] or char_id}
    else:
        if not gm:
            raise AuthError("Only the GM can speak as an NPC or monster")
        record_id = str(voice.get("id") or "")
        record = state.db.execute(
            "SELECT title FROM library_items WHERE kind = ? AND id = ?", (voice_type, record_id)
        ).fetchone()
        if not record:
            raise AuthError("That voice no longer exists")
        resolved = {"type": voice_type, "id": record_id, "name": record["title"] or record_id}
    # System messages (rolls, shop lines) are validated for ownership only: a
    # roll made as a character shouldn't be refused for landing in an OOC thread.
    if not system:
        if channel_mode == "ic" and resolved["type"] == "user":
            raise AuthError("This channel is in-character: choose a character to speak as")
        if channel_mode == "ooc" and resolved["type"] != "user":
            raise AuthError("This channel is out-of-character: post as yourself")
    return resolved


# --- References, inbox ------------------------------------------------------


def _clean_refs(state: ServerState, group_row: Dict[str, Any], author: User, body: str, refs: Any) -> List[Dict[str, str]]:
    """Client-supplied references, kept only if the target is real and the body
    actually contains the text that produced them (so a crafted ref can't
    notify someone or plant a backlink the message doesn't visibly make)."""
    if not isinstance(refs, list):
        return []
    lowered = body.lower()
    cleaned: List[Dict[str, str]] = []
    seen: Set[Tuple[str, str, str]] = set()
    members = _group_member_user_ids(state, group_row["id"], group_row.get("owner_id"))
    for ref in refs[:MAX_REFS]:
        if not isinstance(ref, dict):
            continue
        ref_type = str(ref.get("type") or "")
        kind = str(ref.get("kind") or "").strip()
        target = str(ref.get("id") or "").strip()
        label = str(ref.get("label") or "").strip().lower()
        if not target or ref_type not in ("mention", "wikilink", "message"):
            continue
        if ref_type == "message":
            kind = "message"
            if not target.isdigit() or f"[[msg:{target}" not in lowered:
                continue
            if not _message_row(state, int(target), group_row["id"]):
                continue
        else:
            if not kind or not label:
                continue
            marker = f"@{label}" if ref_type == "mention" else f"[[{label}"
            if marker not in lowered:
                continue
            if ref_type == "mention" and kind == "user":
                if not target.isdigit() or int(target) not in members:
                    continue
            elif not content_exists(state, kind, target):
                continue
        key = (ref_type, kind, target)
        if key in seen:
            continue
        seen.add(key)
        cleaned.append({"type": ref_type, "kind": kind, "id": target, "label": str(ref.get("label") or "").strip()[:120]})
    return cleaned


def _message_row(state: ServerState, message_id: int, group_id: str) -> Any:
    return state.db.execute(
        """
        SELECT id, author_id FROM chat_messages WHERE id = ? AND group_id = ?
        UNION ALL
        SELECT id, author_id FROM chat_messages_archive WHERE id = ? AND group_id = ?
        """,
        (message_id, group_id, message_id, group_id),
    ).fetchone()


def _notify(state: ServerState, user_id: int, group_id: str, reason: str, message_id: Optional[int], dm_id: Optional[int] = None) -> None:
    state.db.execute(
        """
        INSERT OR IGNORE INTO inbox_items (user_id, group_id, reason, message_id, dm_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, group_id, reason, message_id, dm_id, _now()),
    )


def _refs_to_inbox(
    state: ServerState, group_row: Dict[str, Any], author: User, message_id: int, refs: List[Dict[str, str]]
) -> None:
    members = _group_member_user_ids(state, group_row["id"], group_row.get("owner_id"))
    for ref in refs:
        recipient: Optional[int] = None
        reason = "mention"
        if ref["type"] == "mention" and ref["kind"] == "user":
            recipient = int(ref["id"])
        elif ref["type"] == "mention" and ref["kind"] == "character":
            owner = state.db.execute(
                "SELECT owner_id FROM library_items WHERE kind = 'character' AND id = ?", (ref["id"],)
            ).fetchone()
            recipient = owner["owner_id"] if owner else None
        elif ref["type"] == "message":
            target = _message_row(state, int(ref["id"]), group_row["id"])
            recipient = target["author_id"] if target else None
            reason = "reference"
        if recipient is not None and recipient != author.id and recipient in members:
            _notify(state, recipient, group_row["id"], reason, message_id)


# --- Messages ----------------------------------------------------------------


def _voice_label(voice: Optional[Dict[str, Any]], fallback: str) -> str:
    return (voice or {}).get("name") or fallback or "Someone"


def _load_messages(state: ServerState, ids: Iterable[int]) -> Dict[int, Any]:
    id_list = [int(i) for i in ids]
    if not id_list:
        return {}
    placeholders = ",".join("?" for _ in id_list)
    rows = state.db.execute(
        f"""
        SELECT *, 0 AS archived FROM chat_messages WHERE id IN ({placeholders})
        UNION ALL
        SELECT *, 1 AS archived FROM chat_messages_archive WHERE id IN ({placeholders})
        """,
        (*id_list, *id_list),
    ).fetchall()
    return {row["id"]: row for row in rows}


def _reactions_for(state: ServerState, ids: List[int], viewer: Optional[User]) -> Dict[int, List[Dict[str, Any]]]:
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = state.db.execute(
        f"""
        SELECT r.message_id, r.emoji, r.user_id, u.username
        FROM chat_reactions AS r LEFT JOIN users AS u ON u.id = r.user_id
        WHERE r.message_id IN ({placeholders})
        ORDER BY r.rowid
        """,
        ids,
    ).fetchall()
    grouped: Dict[int, Dict[str, Dict[str, Any]]] = {}
    for row in rows:
        by_emoji = grouped.setdefault(row["message_id"], {})
        entry = by_emoji.setdefault(row["emoji"], {"emoji": row["emoji"], "count": 0, "users": [], "mine": False})
        entry["count"] += 1
        entry["users"].append(row["username"] or "")
        if viewer and row["user_id"] == viewer.id:
            entry["mine"] = True
    return {message_id: list(by_emoji.values()) for message_id, by_emoji in grouped.items()}


def _excerpt(body: str, limit: int = 160) -> str:
    stripped = _REPLY_PATTERN.sub("", body or "", count=1).strip()
    return stripped if len(stripped) <= limit else stripped[: limit - 1] + "…"


def _serialize_messages(state: ServerState, rows: List[Any], viewer: Optional[User]) -> List[Dict[str, Any]]:
    ids = [row["id"] for row in rows]
    reactions = _reactions_for(state, ids, viewer)
    parent_ids = []
    for row in rows:
        match = _REPLY_PATTERN.match(row["body"] or "") if not row["deleted_at"] else None
        if match:
            parent_ids.append(int(match.group(1)))
    parents = _load_messages(state, parent_ids)
    refs_by_message: Dict[int, List[Dict[str, str]]] = {}
    if ids:
        placeholders = ",".join("?" for _ in ids)
        for ref in state.db.execute(
            f"SELECT message_id, ref_type, target_kind, target_id, label FROM chat_message_refs WHERE message_id IN ({placeholders})",
            ids,
        ):
            refs_by_message.setdefault(ref["message_id"], []).append(
                {"type": ref["ref_type"], "kind": ref["target_kind"], "id": ref["target_id"], "label": ref["label"] or ""}
            )
    messages: List[Dict[str, Any]] = []
    for row in rows:
        deleted = bool(row["deleted_at"])
        voice = _json_object(row["voice"])
        reply = None
        match = _REPLY_PATTERN.match(row["body"] or "") if not deleted else None
        if match:
            parent = parents.get(int(match.group(1)))
            if parent and parent["group_id"] == row["group_id"]:
                parent_voice = _json_object(parent["voice"])
                reply = {
                    "id": parent["id"],
                    "threadId": parent["thread_id"],
                    "voiceName": _voice_label(parent_voice, parent["author_name"]),
                    "excerpt": "" if parent["deleted_at"] else _excerpt(parent["body"]),
                    "deleted": bool(parent["deleted_at"]),
                }
        messages.append(
            {
                "id": row["id"],
                "threadId": row["thread_id"],
                "groupId": row["group_id"],
                "author": {"id": row["author_id"], "name": row["author_name"] or ""},
                "voice": voice,
                "body": "" if deleted else (row["body"] or ""),
                "payload": None if deleted else _json_object(row["payload"]),
                "createdAt": row["created_at"],
                "editedAt": row["edited_at"],
                "deleted": deleted,
                "reply": reply,
                "refs": [] if deleted else refs_by_message.get(row["id"], []),
                "reactions": reactions.get(row["id"], []),
            }
        )
    return messages


def list_messages(
    state: ServerState,
    group_id: Optional[str],
    thread_id: str,
    user: Optional[User],
    *,
    share_token: Optional[str] = None,
    before: Optional[int] = None,
    after: Optional[int] = None,
    limit: Optional[int] = None,
) -> Dict[str, Any]:
    row, _ = _access(state, group_id, user, share_token)
    thread = _load_thread(state, row["id"], thread_id)
    try:
        page_size = max(1, min(int(limit) if limit is not None else DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
    except (TypeError, ValueError):
        page_size = DEFAULT_PAGE_SIZE
    table = "chat_messages_archive" if thread["archived_at"] else "chat_messages"
    if after is not None:
        rows = state.db.execute(
            f"SELECT * FROM {table} WHERE thread_id = ? AND id > ? ORDER BY id ASC LIMIT ?",
            (thread["id"], after, page_size),
        ).fetchall()
    else:
        clause, params = ("AND id < ?", (thread["id"], before, page_size)) if before is not None else ("", (thread["id"], page_size))
        rows = state.db.execute(
            f"SELECT * FROM {table} WHERE thread_id = ? {clause} ORDER BY id DESC LIMIT ?", params
        ).fetchall()
        rows.reverse()
    return {
        "thread": _serialize_thread(thread),
        "messages": _serialize_messages(state, rows, user),
        "hasMore": after is None and len(rows) == page_size,
    }


def post_message(
    state: ServerState,
    group_id: Optional[str],
    thread_id: str,
    user: Optional[User],
    *,
    share_token: Optional[str] = None,
    body: str = "",
    payload: Any = None,
    voice: Any = None,
    refs: Any = None,
) -> Dict[str, Any]:
    user = _require_poster(user)
    row, _ = _access(state, group_id, user, share_token)
    thread = _load_thread(state, row["id"], thread_id)
    if thread["archived_at"]:
        raise AuthError("This thread is archived")
    if not _is_gm(row, user):
        from . import sessions

        if sessions.posting_locked(state, row["id"], thread["id"]):
            raise AuthError("This thread is only open for posting during its session")
    channel = _load_channel(state, row["id"], thread["channel_id"])
    text = (body or "").strip()[:MESSAGE_BODY_LIMIT]
    payload_value = payload if isinstance(payload, dict) and payload else None
    system = bool(payload_value and payload_value.get("kind"))
    if payload_value is not None and not system:
        raise AuthError("A message payload must declare its kind")
    if system and not (isinstance(payload_value.get("summary"), str) and payload_value["summary"].strip()):
        raise AuthError("System messages need a summary")
    if not text and not payload_value:
        raise AuthError("Message cannot be empty")
    if system and not voice:
        # A roll or shop line with no explicit speaker goes out in whichever
        # voice this user last used in the thread, falling back to themself.
        last = state.db.execute(
            "SELECT last_voice FROM chat_thread_state WHERE thread_id = ? AND user_id = ?", (thread["id"], user.id)
        ).fetchone()
        voice = _json_object(last["last_voice"]) if last else None
        try:
            _validate_voice(state, row, user, voice, channel["mode"], system=True)
        except AuthError:
            voice = None
    resolved_voice = _validate_voice(state, row, user, voice, channel["mode"], system=system)
    cleaned_refs = _clean_refs(state, row, user, text, refs) if text else []
    try:
        payload_data = json.dumps(payload_value) if payload_value else None
    except (TypeError, ValueError) as exc:
        raise AuthError("Invalid payload") from exc
    timestamp = _now()
    cursor = state.db.execute(
        """
        INSERT INTO chat_messages (thread_id, group_id, author_id, author_name, voice, body, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (thread["id"], row["id"], user.id, user.username or "", json.dumps(resolved_voice), text or None, payload_data, timestamp),
    )
    message_id = cursor.lastrowid
    for ref in cleaned_refs:
        state.db.execute(
            "INSERT INTO chat_message_refs (message_id, ref_type, target_kind, target_id, label) VALUES (?, ?, ?, ?, ?)",
            (message_id, ref["type"], ref["kind"], ref["id"], ref["label"]),
        )
    _refs_to_inbox(state, row, user, message_id, cleaned_refs)
    state.db.execute(
        """
        INSERT INTO chat_thread_state (thread_id, user_id, last_read_message_id, last_voice) VALUES (?, ?, ?, ?)
        ON CONFLICT(thread_id, user_id) DO UPDATE SET last_voice = excluded.last_voice,
            last_read_message_id = excluded.last_read_message_id
        """,
        (thread["id"], user.id, message_id, json.dumps(resolved_voice)),
    )
    _touch_group(state, row["id"])
    state.db.commit()
    return _serialize_messages(state, list(_load_messages(state, [message_id]).values()), user)[0]


def _editable_message(
    state: ServerState, group_id: Optional[str], message_id: int, user: Optional[User]
) -> Tuple[Dict[str, Any], Any]:
    user = _require_poster(user)
    row, _ = _access(state, group_id, user, None)
    message = state.db.execute(
        "SELECT * FROM chat_messages WHERE id = ? AND group_id = ?", (message_id, row["id"])
    ).fetchone()
    if not message:
        if state.db.execute(
            "SELECT 1 FROM chat_messages_archive WHERE id = ? AND group_id = ?", (message_id, row["id"])
        ).fetchone():
            raise AuthError("Archived messages can't be changed")
        raise AuthError("Message not found")
    if message["deleted_at"]:
        raise AuthError("Message was deleted")
    if not (message["author_id"] == user.id or _is_gm(row, user)):
        raise AuthError("You can't change this message")
    return row, message


def edit_message(
    state: ServerState, group_id: Optional[str], message_id: int, user: Optional[User], *, body: str, refs: Any = None
) -> Dict[str, Any]:
    row, message = _editable_message(state, group_id, message_id, user)
    if message["payload"]:
        raise AuthError("System messages can't be edited")
    text = (body or "").strip()[:MESSAGE_BODY_LIMIT]
    if not text:
        raise AuthError("Message cannot be empty")
    # The reply anchor opens the body; keep refs to the original author's
    # reality: the message's own author is who gets credit for new mentions.
    author = User(id=message["author_id"], email="", username=message["author_name"] or "", tier="free")
    previous = {
        (r["ref_type"], r["target_kind"], r["target_id"])
        for r in state.db.execute("SELECT * FROM chat_message_refs WHERE message_id = ?", (message_id,))
    }
    cleaned_refs = _clean_refs(state, row, author, text, refs)
    state.db.execute("DELETE FROM chat_message_refs WHERE message_id = ?", (message_id,))
    for ref in cleaned_refs:
        state.db.execute(
            "INSERT INTO chat_message_refs (message_id, ref_type, target_kind, target_id, label) VALUES (?, ?, ?, ?, ?)",
            (message_id, ref["type"], ref["kind"], ref["id"], ref["label"]),
        )
    _refs_to_inbox(
        state, row, author, message_id, [r for r in cleaned_refs if (r["type"], r["kind"], r["id"]) not in previous]
    )
    state.db.execute(
        "UPDATE chat_messages SET body = ?, edited_at = ? WHERE id = ?", (text, _now(), message_id)
    )
    _touch_group(state, row["id"])
    state.db.commit()
    return _serialize_messages(state, list(_load_messages(state, [message_id]).values()), user)[0]


def delete_message(state: ServerState, group_id: Optional[str], message_id: int, user: Optional[User]) -> Dict[str, Any]:
    row, _ = _editable_message(state, group_id, message_id, user)
    # Tombstone rather than delete: replies and [[msg:ID]] links keep resolving.
    state.db.execute(
        "UPDATE chat_messages SET body = NULL, payload = NULL, deleted_at = ? WHERE id = ?", (_now(), message_id)
    )
    state.db.execute("DELETE FROM chat_message_refs WHERE message_id = ?", (message_id,))
    state.db.execute("DELETE FROM chat_reactions WHERE message_id = ?", (message_id,))
    state.db.execute("DELETE FROM inbox_items WHERE message_id = ?", (message_id,))
    _touch_group(state, row["id"])
    state.db.commit()
    return _serialize_messages(state, list(_load_messages(state, [message_id]).values()), user)[0]


def toggle_reaction(
    state: ServerState, group_id: Optional[str], message_id: int, user: Optional[User], *, emoji: str
) -> Dict[str, Any]:
    user = _require_poster(user)
    row, _ = _access(state, group_id, user, None)
    if emoji not in _reaction_emoji(state):
        raise AuthError("That reaction isn't available")
    message = _load_messages(state, [message_id]).get(message_id)
    if not message or message["group_id"] != row["id"] or message["deleted_at"]:
        raise AuthError("Message not found")
    existing = state.db.execute(
        "SELECT 1 FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?", (message_id, user.id, emoji)
    ).fetchone()
    if existing:
        state.db.execute(
            "DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?", (message_id, user.id, emoji)
        )
    else:
        state.db.execute(
            "INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)", (message_id, user.id, emoji)
        )
    _touch_group(state, row["id"])
    state.db.commit()
    return {"id": message_id, "reactions": _reactions_for(state, [message_id], user).get(message_id, [])}


def mark_thread_read(state: ServerState, group_id: Optional[str], thread_id: str, user: Optional[User]) -> Dict[str, Any]:
    user = _require_poster(user)
    row, _ = _access(state, group_id, user, None)
    thread = _load_thread(state, row["id"], thread_id)
    latest = state.db.execute(
        "SELECT COALESCE(MAX(id), 0) AS latest FROM chat_messages WHERE thread_id = ?", (thread["id"],)
    ).fetchone()["latest"]
    state.db.execute(
        """
        INSERT INTO chat_thread_state (thread_id, user_id, last_read_message_id) VALUES (?, ?, ?)
        ON CONFLICT(thread_id, user_id) DO UPDATE SET last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id)
        """,
        (thread["id"], user.id, latest),
    )
    state.db.commit()
    return {"threadId": thread["id"], "lastReadMessageId": latest}


def get_last_voice(state: ServerState, group_id: Optional[str], thread_id: str, user: Optional[User]) -> Optional[Dict[str, Any]]:
    if not user:
        return None
    row, _ = _access(state, group_id, user, None)
    thread = _load_thread(state, row["id"], thread_id)
    state_row = state.db.execute(
        "SELECT last_voice FROM chat_thread_state WHERE thread_id = ? AND user_id = ?", (thread["id"], user.id)
    ).fetchone()
    return _json_object(state_row["last_voice"]) if state_row else None


# --- Archive -----------------------------------------------------------------


def _format_archive_body(messages: List[Any]) -> str:
    lines: List[str] = []
    for message in messages:
        if message["deleted_at"]:
            continue
        voice = _json_object(message["voice"])
        who = _voice_label(voice, message["author_name"])
        payload = _json_object(message["payload"])
        text = (payload or {}).get("summary") or message["body"] or ""
        # One message is one paragraph, so its trailing ^m<id> is a single block anchor.
        paragraph = "  \n".join(line.strip() for line in text.splitlines() if line.strip())
        stamp = (message["created_at"] or "")[:16].replace("T", " ")
        lines.append(f"**{who}** ({stamp} UTC): {paragraph} ^m{message['id']}")
    return "\n\n".join(lines)


def _user_from_id(state: ServerState, user_id: Optional[int]) -> Optional[User]:
    if user_id is None:
        return None
    row = state.db.execute("SELECT id, email, username, tier FROM users WHERE id = ?", (user_id,)).fetchone()
    return User(id=row["id"], email=row["email"], username=row["username"], tier=row["tier"]) if row else None


def archive_thread(state: ServerState, group_id: Optional[str], thread_id: str, user: Optional[User]) -> Dict[str, Any]:
    from . import storage
    from .shares import share_with_group

    user = _require_poster(user)
    row, _ = _access(state, group_id, user, None)
    thread = _load_thread(state, row["id"], thread_id)
    if thread["archived_at"]:
        raise AuthError("This thread is already archived")
    if thread["is_default"]:
        raise AuthError("The default thread can't be archived")
    if not (_is_gm(row, user) or thread["created_by"] == user.id):
        raise AuthError("Only the thread's creator or the GM can archive it")
    owner = _user_from_id(state, row["owner_id"])
    if not owner:
        raise AuthError("This group has no owner to hold the archive page")
    channel = _load_channel(state, row["id"], thread["channel_id"])
    messages = state.db.execute(
        "SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY id", (thread["id"],)
    ).fetchall()
    page_id = f"journal_arch_{thread['id']}"
    page = {
        "title": f"{channel['name']} — {thread['title']}",
        "body": _format_archive_body(messages),
        "tags": [],
        "parentId": "",
        "refs": [],
    }
    # Deterministic id: a retry after a partial failure rewrites the same page.
    storage.save_item(state, "journal", page_id, page, owner)
    share_with_group(state, "journal", page_id, row["id"], "view", owner)
    columns = "id, thread_id, group_id, author_id, author_name, voice, body, payload, created_at, edited_at, deleted_at"
    state.db.execute(
        f"INSERT OR REPLACE INTO chat_messages_archive ({columns}) SELECT {columns} FROM chat_messages WHERE thread_id = ?",
        (thread["id"],),
    )
    state.db.execute("DELETE FROM chat_messages WHERE thread_id = ?", (thread["id"],))
    state.db.execute(
        "UPDATE chat_threads SET archived_at = ?, archive_page_id = ? WHERE id = ?", (_now(), page_id, thread["id"])
    )
    _touch_group(state, row["id"])
    state.db.commit()
    return _serialize_thread(_load_thread(state, row["id"], thread["id"]))


# --- Backlinks and message resolution -------------------------------------------


def _visible_group_ids(state: ServerState, user: Optional[User]) -> Optional[Set[str]]:
    """None means unrestricted (admin)."""
    if not user:
        return set()
    if user.tier == "admin":
        return None
    return set(accessible_group_ids(state, user))


def _message_summary(state: ServerState, message: Any, group_names: Dict[str, str]) -> Dict[str, Any]:
    thread = state.db.execute(
        "SELECT t.title, t.archive_page_id, c.name AS channel_name FROM chat_threads t JOIN chat_channels c ON c.id = t.channel_id WHERE t.id = ?",
        (message["thread_id"],),
    ).fetchone()
    voice = _json_object(message["voice"])
    payload = _json_object(message["payload"])
    text = "" if message["deleted_at"] else ((payload or {}).get("summary") or message["body"] or "")
    return {
        "id": message["id"],
        "groupId": message["group_id"],
        "groupName": group_names.get(message["group_id"], ""),
        "threadId": message["thread_id"],
        "threadTitle": thread["title"] if thread else "",
        "channelName": thread["channel_name"] if thread else "",
        "archived": bool(message["archived"]),
        "archivePageId": thread["archive_page_id"] if thread and message["archived"] else None,
        "voiceName": _voice_label(voice, message["author_name"]),
        "excerpt": _excerpt(text, 200),
        "text": text,
        "deleted": bool(message["deleted_at"]),
        "createdAt": message["created_at"],
    }


def _group_names(state: ServerState, ids: Iterable[str]) -> Dict[str, str]:
    id_list = list(set(ids))
    if not id_list:
        return {}
    placeholders = ",".join("?" for _ in id_list)
    return {
        r["id"]: r["title"] or r["id"]
        for r in state.db.execute(
            f"SELECT id, title FROM library_items WHERE kind = 'group' AND id IN ({placeholders})", id_list
        )
    }


def backlinks(state: ServerState, kind: str, target_id: str, user: Optional[User]) -> Dict[str, Any]:
    visible = _visible_group_ids(state, user)
    if visible is not None and not visible:
        return {"items": []}
    message_ids = [
        r["message_id"]
        for r in state.db.execute(
            "SELECT DISTINCT message_id FROM chat_message_refs WHERE target_kind = ? AND target_id = ? ORDER BY message_id DESC LIMIT 200",
            (kind, str(target_id)),
        )
    ]
    messages = [m for m in _load_messages(state, message_ids).values() if visible is None or m["group_id"] in visible]
    messages.sort(key=lambda m: m["id"], reverse=True)
    messages = messages[:50]
    names = _group_names(state, (m["group_id"] for m in messages))
    return {"items": [_message_summary(state, m, names) for m in messages]}


def resolve_messages(state: ServerState, ids: Iterable[int], user: Optional[User]) -> Dict[str, Any]:
    visible = _visible_group_ids(state, user)
    id_list = [i for i in ids][:100]
    messages = [m for m in _load_messages(state, id_list).values() if visible is None or m["group_id"] in visible]
    names = _group_names(state, (m["group_id"] for m in messages))
    return {"messages": {str(m["id"]): _message_summary(state, m, names) for m in messages}}


# --- Direct messages and inbox ---------------------------------------------------


def send_direct_message(
    state: ServerState, group_id: Optional[str], user: Optional[User], *, recipient_ids: Any, body: str
) -> Dict[str, Any]:
    user = _require_poster(user)
    row, _ = _access(state, group_id, user, None)
    members = _group_member_user_ids(state, row["id"], row.get("owner_id"))
    if user.tier != "admin" and user.id not in members:
        raise AuthError("Only group members can send messages")
    text = (body or "").strip()[:MESSAGE_BODY_LIMIT]
    if not text:
        raise AuthError("Message cannot be empty")
    recipients = sorted(
        {int(v) for v in (recipient_ids or []) if isinstance(v, (int, float, str)) and str(v).isdigit()} & members
        - {user.id}
    )
    if not recipients:
        raise AuthError("Choose at least one other group member to message")
    cursor = state.db.execute(
        "INSERT INTO direct_messages (group_id, author_id, recipient_ids, body, created_at) VALUES (?, ?, ?, ?, ?)",
        (row["id"], user.id, json.dumps(recipients), text, _now()),
    )
    for recipient in recipients:
        state.db.execute(
            "INSERT INTO inbox_items (user_id, group_id, reason, dm_id, created_at) VALUES (?, ?, 'direct', ?, ?)",
            (recipient, row["id"], cursor.lastrowid, _now()),
        )
    state.db.commit()
    return {"id": cursor.lastrowid, "recipientIds": recipients}


def _dm_reactions(state: ServerState, dm_ids: List[int], viewer: User) -> Dict[int, List[Dict[str, Any]]]:
    if not dm_ids:
        return {}
    marks = ",".join("?" for _ in dm_ids)
    grouped: Dict[int, Dict[str, Dict[str, Any]]] = {}
    for row in state.db.execute(
        f"""
        SELECT r.dm_id, r.emoji, r.user_id, u.username
        FROM dm_reactions AS r LEFT JOIN users AS u ON u.id = r.user_id
        WHERE r.dm_id IN ({marks}) ORDER BY r.rowid
        """,
        dm_ids,
    ):
        entry = grouped.setdefault(row["dm_id"], {}).setdefault(
            row["emoji"], {"emoji": row["emoji"], "count": 0, "users": [], "mine": False}
        )
        entry["count"] += 1
        entry["users"].append(row["username"] or "")
        if row["user_id"] == viewer.id:
            entry["mine"] = True
    return {dm_id: list(by_emoji.values()) for dm_id, by_emoji in grouped.items()}


def toggle_inbox_reaction(state: ServerState, user: Optional[User], *, item_id: Any, emoji: str) -> Dict[str, Any]:
    """Reacts to the message behind one of the caller's Inbox items. A mention or
    reply item reacts to the chat message itself, so the reaction shows in the
    chat too; a direct message keeps its own reactions. Session notices have none."""
    user = _require_poster(user)
    if emoji not in _reaction_emoji(state):
        raise AuthError("That reaction isn't available")
    if not isinstance(item_id, int) or isinstance(item_id, bool):
        raise AuthError("Choose an Inbox item")
    item = state.db.execute("SELECT * FROM inbox_items WHERE id = ? AND user_id = ?", (item_id, user.id)).fetchone()
    if not item:
        raise AuthError("Inbox item not found")
    if item["message_id"]:
        return toggle_reaction(state, item["group_id"], item["message_id"], user, emoji=emoji)
    if not item["dm_id"]:
        raise AuthError("This kind of notice can't be reacted to")
    exists = state.db.execute(
        "SELECT 1 FROM dm_reactions WHERE dm_id = ? AND user_id = ? AND emoji = ?", (item["dm_id"], user.id, emoji)
    ).fetchone()
    if exists:
        state.db.execute(
            "DELETE FROM dm_reactions WHERE dm_id = ? AND user_id = ? AND emoji = ?", (item["dm_id"], user.id, emoji)
        )
    else:
        state.db.execute("INSERT INTO dm_reactions (dm_id, user_id, emoji) VALUES (?, ?, ?)", (item["dm_id"], user.id, emoji))
    state.db.commit()
    return {"id": item["dm_id"], "reactions": _dm_reactions(state, [item["dm_id"]], user).get(item["dm_id"], [])}


def list_inbox(state: ServerState, user: Optional[User], *, unread_only: bool = False, limit: int = 100) -> Dict[str, Any]:
    user = _require_poster(user)
    rows = state.db.execute(
        f"""
        SELECT * FROM inbox_items WHERE user_id = ? {"AND read_at IS NULL" if unread_only else ""}
        ORDER BY id DESC LIMIT ?
        """,
        (user.id, max(1, min(int(limit), 200))),
    ).fetchall()
    messages = _load_messages(state, [r["message_id"] for r in rows if r["message_id"]])
    message_reactions = _reactions_for(state, [r["message_id"] for r in rows if r["message_id"]], user)
    dm_reactions = _dm_reactions(state, [r["dm_id"] for r in rows if r["dm_id"] and not r["message_id"]], user)
    names = _group_names(state, (r["group_id"] for r in rows))
    items: List[Dict[str, Any]] = []
    for item in rows:
        entry: Dict[str, Any] = {
            "id": item["id"],
            "reason": item["reason"],
            "groupId": item["group_id"],
            "groupName": names.get(item["group_id"], ""),
            "createdAt": item["created_at"],
            "read": item["read_at"] is not None,
        }
        if item["occurrence_id"]:
            from . import sessions

            summary = sessions.inbox_summary(state, item["occurrence_id"], user.id)
            if not summary:
                continue
            entry["session"] = summary
        elif item["application_id"]:
            from . import applications

            application = applications.inbox_entry(state, item, user)
            if not application:
                continue
            entry["application"] = application
        elif item["message_id"]:
            message = messages.get(item["message_id"])
            if not message:
                continue
            entry["message"] = _message_summary(state, message, names)
            entry["reactions"] = [] if message["deleted_at"] else message_reactions.get(item["message_id"], [])
        else:
            dm = state.db.execute(
                "SELECT d.*, u.username FROM direct_messages d LEFT JOIN users u ON u.id = d.author_id WHERE d.id = ?",
                (item["dm_id"],),
            ).fetchone()
            if not dm:
                continue
            entry["direct"] = {
                "id": dm["id"],
                "authorId": dm["author_id"],
                "authorName": dm["username"] or "",
                "body": dm["body"],
                "recipientIds": _json_list(dm["recipient_ids"]),
            }
            entry["reactions"] = dm_reactions.get(dm["id"], [])
        items.append(entry)
    return {"items": items, "reactionEmoji": _reaction_emoji(state), "reactionDescriptions": _reaction_descriptions(state)}


def inbox_count(state: ServerState, user: Optional[User]) -> Dict[str, Any]:
    user = _require_poster(user)
    return {
        "unread": state.db.execute(
            "SELECT COUNT(*) AS c FROM inbox_items WHERE user_id = ? AND read_at IS NULL", (user.id,)
        ).fetchone()["c"]
    }


def mark_inbox_read(state: ServerState, user: Optional[User], *, ids: Any = None, all_items: bool = False) -> Dict[str, Any]:
    user = _require_poster(user)
    if all_items:
        state.db.execute("UPDATE inbox_items SET read_at = ? WHERE user_id = ? AND read_at IS NULL", (_now(), user.id))
    else:
        id_list = [int(v) for v in (ids or []) if str(v).isdigit()]
        if id_list:
            placeholders = ",".join("?" for _ in id_list)
            state.db.execute(
                f"UPDATE inbox_items SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN ({placeholders})",
                (_now(), user.id, *id_list),
            )
    state.db.commit()
    return inbox_count(state, user)


def delete_inbox_items(state: ServerState, user: Optional[User], *, ids: Any = None) -> Dict[str, Any]:
    """Removes the caller's own Inbox items. A session notice stays until its
    session has ended or been cancelled (or no longer exists), so a pending
    invitation can't be thrown away by accident. Returns which ids were
    removed and which were skipped."""
    user = _require_poster(user)
    id_list = [int(v) for v in (ids or []) if str(v).isdigit()]
    deleted: List[int] = []
    skipped: List[int] = []
    now = _now()
    for item_id in id_list:
        item = state.db.execute("SELECT * FROM inbox_items WHERE id = ? AND user_id = ?", (item_id, user.id)).fetchone()
        if not item:
            continue
        if item["occurrence_id"]:
            occurrence = state.db.execute(
                "SELECT status, end_at FROM group_session_occurrences WHERE id = ?", (item["occurrence_id"],)
            ).fetchone()
            if occurrence and occurrence["status"] != "cancelled" and (occurrence["end_at"] or "") > now:
                skipped.append(item_id)
                continue
        if item["application_id"]:
            application = state.db.execute("SELECT status FROM applications WHERE id = ?", (item["application_id"],)).fetchone()
            if application and application["status"] == "pending":
                skipped.append(item_id)
                continue
        state.db.execute("DELETE FROM inbox_items WHERE id = ?", (item_id,))
        deleted.append(item_id)
    state.db.commit()
    return {"deleted": deleted, "skipped": skipped, "unread": inbox_count(state, user)["unread"]}


# --- Cleanup -----------------------------------------------------------------------


def delete_group_chat(state: ServerState, group_id: str) -> None:
    """Foreign keys aren't enforced anywhere, so a deleted group's chat rows
    are cleared explicitly. Archive pages (journal records) stay."""
    message_ids = "SELECT id FROM chat_messages WHERE group_id = ? UNION SELECT id FROM chat_messages_archive WHERE group_id = ?"
    params = (group_id, group_id)
    state.db.execute(f"DELETE FROM chat_message_refs WHERE message_id IN ({message_ids})", params)
    state.db.execute(f"DELETE FROM chat_reactions WHERE message_id IN ({message_ids})", params)
    state.db.execute("DELETE FROM inbox_items WHERE group_id = ?", (group_id,))
    state.db.execute(
        "DELETE FROM dm_reactions WHERE dm_id IN (SELECT id FROM direct_messages WHERE group_id = ?)", (group_id,)
    )
    state.db.execute("DELETE FROM direct_messages WHERE group_id = ?", (group_id,))
    state.db.execute(
        "DELETE FROM chat_thread_state WHERE thread_id IN (SELECT id FROM chat_threads WHERE group_id = ?)", (group_id,)
    )
    for table in ("chat_messages", "chat_messages_archive", "chat_threads", "chat_channels", "group_spotlight"):
        state.db.execute(f"DELETE FROM {table} WHERE group_id = ?", (group_id,))
