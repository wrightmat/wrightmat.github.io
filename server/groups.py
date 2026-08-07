from __future__ import annotations

import json
import secrets
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .auth import AuthError, User
from .roles import role_rank
from .shares import (
    content_exists,
    create_share_link,
    get_share_link,
    get_share_links_batch,
    resolve_share_token,
    revoke_share_link,
    touch_share_link,
)
from .state import ServerState

_GROUP_ID_PREFIX = "grp_"
# Groups aren't a Library kind (no kind-registry file, no readTier/writeTier
# entry — see server/storage.py's library_items/load_kind_policy system).
# GM tier, not Creator: Creator is about authoring reusable CONTENT (Systems,
# Templates, ...) for others to use, while a Campaign Group is a GM's own
# session-running tool — setting one up is exactly what "being a GM" means,
# not a content-authoring action. Unlike every Library kind, this was
# previously not gated at all.
_CREATE_GROUP_MIN_TIER = "gm"

# Spotlight kinds whose entire "content" is inline in the spotlight log entry
# itself (a `data` payload — undercroft/common/js/lib/data-manager.js's own
# spotlightToGroup/updateSpotlightData) rather than a real, persisted Library
# record — deliberately NOT a Library kind (no common/data/kind/browser.json
# or clock.json, nothing for Loom's Library tab to list/manage), so there's
# nothing here for content_exists() to check the existence of. The spotlight
# log entry for one of these only ever needs to answer "is this specific
# widget instance currently toggled on, and with what data" (kind+id+data,
# same shape every other spotlight uses minus the Library-record dependency)
# — a follower (another player who accepted this onto their own dashboard, or
# the GM's own second-screen mirror) reads that data straight from the log
# entry via spotlight.js's resolveSpotlightData, never from a fetched record.
#
# "calendar" and "soundboard" are both partial exceptions worth noting: the
# WIDGET INSTANCE itself (kind+id here) still has no Library record of its
# own, same as browser/clock — but Calendar's own widget separately shares
# and references a real "setting" record for its vocabulary (a normal
# share_with_group call, validated the ordinary way, nothing to do with this
# set) alongside its own inline spotlight entry.
_INLINE_SPOTLIGHT_KINDS = {"browser", "clock", "calendar", "soundboard"}


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
    return _fetch_group_members_batch(state, [group_id]).get(group_id, [])


# Batched form of the same lookup, used by list_groups so an owner with N
# groups costs a handful of queries total instead of up to 3×N (one JOIN plus
# up to two title lookups, per group, previously run inside a per-group
# loop). Single-group callers go through _fetch_group_members above, which is
# just this with a one-element id list — same query, same result shape,
# kept as one implementation so the two paths can't drift.
def _fetch_group_members_batch(state: ServerState, group_ids: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    if not group_ids:
        return {}
    # Characters/systems/templates all live in the one generic library_items
    # table now (see server/storage.py) — system/template are id references
    # tucked inside a character's own `metadata` JSON, not a joinable column,
    # so their titles are resolved in a second pass here rather than via a
    # brittle multi-table SQL JOIN keyed off a JSON blob's contents.
    group_placeholders = ",".join("?" for _ in group_ids)
    rows = state.db.execute(
        f"""
        SELECT gm.group_id,
               gm.content_type,
               gm.content_id,
               gm.added_at,
               li.title AS character_title,
               li.metadata AS character_metadata,
               li.owner_id AS character_owner_id,
               u.username AS owner_username
        FROM group_members AS gm
        LEFT JOIN library_items AS li ON li.kind = 'character' AND li.id = gm.content_id
        LEFT JOIN users AS u ON u.id = li.owner_id
        WHERE gm.group_id IN ({group_placeholders})
        ORDER BY gm.group_id, COALESCE(li.title, gm.content_id) COLLATE NOCASE
        """,
        tuple(group_ids),
    ).fetchall()

    parsed_metadata: Dict[str, Dict[str, Any]] = {}
    referenced_ids: Dict[str, set] = {"system": set(), "template": set()}
    for row in rows:
        raw_metadata = row["character_metadata"]
        metadata: Dict[str, Any] = {}
        if raw_metadata:
            try:
                metadata = json.loads(raw_metadata)
            except json.JSONDecodeError:
                metadata = {}
        parsed_metadata[row["content_id"]] = metadata
        # Assigned Systems (systemIds, a list — the same "Assigned Systems"
        # mechanism every Library kind uses in Loom now) replaces the old
        # singular `system` field. `system` is still read as a fallback for
        # any character not yet resaved since the migration (see
        # common/data/kind/character.json's metadataFields).
        for system_id in metadata.get("systemIds") or ([metadata["system"]] if metadata.get("system") else []):
            if system_id:
                referenced_ids["system"].add(system_id)
        if metadata.get("template"):
            referenced_ids["template"].add(metadata["template"])

    titles: Dict[Tuple[str, str], str] = {}
    for kind, ids in referenced_ids.items():
        if not ids:
            continue
        placeholders = ",".join("?" for _ in ids)
        for title_row in state.db.execute(
            f"SELECT id, title FROM library_items WHERE kind = ? AND id IN ({placeholders})",
            (kind, *ids),
        ):
            titles[(kind, title_row["id"])] = title_row["title"]

    members_by_group: Dict[str, List[Dict[str, Any]]] = {group_id: [] for group_id in group_ids}
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
            metadata = parsed_metadata.get(content_id, {})
            system_ids = metadata.get("systemIds") or ([metadata["system"]] if metadata.get("system") else [])
            system_ids = [sid for sid in system_ids if sid]
            system_names = [titles.get(("system", sid), sid) for sid in system_ids]
            template_id = metadata.get("template") or ""
            entry.update(
                {
                    "label": row["character_title"] or content_id,
                    "system_ids": system_ids,
                    "system_names": system_names,
                    # Scalar fallbacks (first assigned System) for any
                    # caller not yet updated to the systemIds/system_ids
                    # array — see Workbench's Assigned Systems migration.
                    "system": system_ids[0] if system_ids else "",
                    "system_name": system_names[0] if system_names else "",
                    "template": template_id,
                    "template_title": titles.get(("template", template_id), ""),
                    "owner_id": row["character_owner_id"],
                    "owner_username": row["owner_username"] or "",
                    "missing": row["character_title"] is None,
                }
            )
        members_by_group[row["group_id"]].append(entry)
    return members_by_group


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
        JOIN library_items AS li
          ON gm.content_type = 'character' AND gm.content_id = li.id AND li.kind = 'character'
        WHERE gm.group_id = ?
          AND li.owner_id = ?
        LIMIT 1
        """,
        (resolved_id, user.id),
    ).fetchone()
    if membership:
        return row, False
    raise AuthError("Access denied")


def user_can_access_group(state: ServerState, group_id: str, user: Optional[User]) -> bool:
    """Owner-or-member-via-character-ownership check — the same access rule
    _resolve_group_access enforces for the game log, extracted standalone
    (no share-token handling, no campaign-type restriction, returns a bool
    instead of raising) so shares.py can reuse it to resolve "does this user
    have access via this group" for a share that targets the group itself.
    """
    if not user or not group_id:
        return False
    row = state.db.execute("SELECT owner_id FROM groups WHERE id = ?", (group_id,)).fetchone()
    if not row:
        return False
    if user.tier == "admin" or row["owner_id"] == user.id:
        return True
    membership = state.db.execute(
        """
        SELECT 1
        FROM group_members AS gm
        JOIN library_items AS li
          ON gm.content_type = 'character' AND gm.content_id = li.id AND li.kind = 'character'
        WHERE gm.group_id = ?
          AND li.owner_id = ?
        LIMIT 1
        """,
        (group_id, user.id),
    ).fetchone()
    return bool(membership)


def accessible_group_ids(state: ServerState, user: Optional[User]) -> List[str]:
    """Every group id `user` can access — owns it, or owns a character that's
    a member of it. Used by storage.py's list_bucket to resolve the "shared"
    bucket for group-targeted shares (a SQL-side per-row access check isn't
    practical there, so this precomputes the accessible set once instead).
    """
    if not user:
        return []
    owned = [row["id"] for row in state.db.execute("SELECT id FROM groups WHERE owner_id = ?", (user.id,))]
    member_of = [
        row["group_id"]
        for row in state.db.execute(
            """
            SELECT DISTINCT gm.group_id
            FROM group_members AS gm
            JOIN library_items AS li
              ON gm.content_type = 'character' AND gm.content_id = li.id AND li.kind = 'character'
            WHERE li.owner_id = ?
            """,
            (user.id,),
        )
    ]
    return list({*owned, *member_of})


def _fetch_group_log_entries(
    state: ServerState, group_id: str, limit: int, entry_types: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    # entry_types (optional) restricts the LIMIT-bounded window to specific
    # types instead of the group's raw, most-recent-N-of-everything log —
    # needed because ordinary chat/roll entries and a single chatty
    # inline-kind widget's own spotlight-update refreshes (a Clock ticking,
    # a Browser URL edit — every one of those is its own row, see
    # create_group_log_entry's own comment) all share this same bounded
    # window. Without this, enough of either can silently push an unrelated
    # widget's still-active `spotlight` entry outside the fetched window,
    # making resolveIsSpotlighted (spotlight.js) wrongly conclude it's no
    # longer shown even though nothing ever cleared it — confirmed as the
    # cause of the second-screen mirror going completely blank whenever a
    # Clock widget had been ticked/edited enough times. Callers resolving
    # "what's currently spotlighted" pass the three spotlight-related types;
    # the Game Log widget's own read (wanting everything, unfiltered) omits
    # this entirely.
    if entry_types:
        placeholders = ",".join("?" for _ in entry_types)
        rows = state.db.execute(
            f"""
            SELECT id, entry_type, author_id, author_name, message, payload, created_at
            FROM group_logs
            WHERE group_id = ? AND entry_type IN ({placeholders})
            ORDER BY id DESC
            LIMIT ?
            """,
            (group_id, *entry_types, limit),
        ).fetchall()
    else:
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


def get_active_spotlights(state: ServerState, group_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    """Every (kind, id) pair currently spotlighted in this group — replayed
    forward through the group's own `spotlight`/`spotlight-clear` history,
    same per-instance resolution spotlight.js's own resolveIsSpotlighted
    applies client-side (a later entry, scoped by kind+id, kind-only, or
    fully global, supersedes an earlier one), just computed for every kind
    at once rather than one at a time — storage.py's get_item (the
    share-token special case that lets an anonymous share-link visitor read
    exactly whatever's currently shown, and nothing else) needs to check an
    arbitrary requested (kind, id) — or, for a template fetch, match against
    any currently-active entry's own templateId — without knowing in advance
    which kind is actually active. No access check here by design — only
    ever called from a context that has already resolved group access.
    Bounded to the most recent `limit` spotlight/spotlight-clear entries
    (chronological order, oldest first, so a later clear is correctly
    applied after the spotlight it clears) — same practical "recent window,
    not full unbounded history" tradeoff resolveIsSpotlighted's own default
    `limit` makes client-side; a GM realistically never has anywhere close
    to this many simultaneously-relevant show/hide toggles outstanding."""
    rows = state.db.execute(
        """
        SELECT entry_type, payload
        FROM group_logs
        WHERE group_id = ? AND entry_type IN ('spotlight', 'spotlight-clear')
        ORDER BY id DESC
        LIMIT ?
        """,
        (group_id, limit),
    ).fetchall()
    active: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for row in reversed(rows):
        if not row["payload"]:
            continue
        try:
            payload = json.loads(row["payload"])
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        if row["entry_type"] == "spotlight":
            kind_value = str(payload.get("kind") or "")
            id_value = str(payload.get("id") or "")
            if kind_value and id_value:
                active[(kind_value, id_value)] = payload
        else:  # spotlight-clear
            clear_kind = payload.get("kind")
            if not clear_kind:
                active.clear()  # Global clear.
                continue
            clear_kind = str(clear_kind)
            clear_id = payload.get("id")
            if clear_id:
                active.pop((clear_kind, str(clear_id)), None)
            else:
                for key in [k for k in active if k[0] == clear_kind]:
                    active.pop(key, None)
    return list(active.values())


_VALID_LOG_ENTRY_TYPES = {"message", "roll", "spotlight", "spotlight-clear", "spotlight-update"}


def list_group_log(
    state: ServerState,
    group_id: Optional[str],
    user: Optional[User],
    *,
    share_token: Optional[str] = None,
    limit: Optional[int] = None,
    entry_types: Optional[List[str]] = None,
) -> Dict[str, Any]:
    row, share_mode = _resolve_group_access(state, group_id, user, share_token=share_token)
    limit_value = _sanitize_log_limit(limit)
    # Silently drops anything not a real entry_type rather than erroring —
    # this is a read-side filter, not user input worth rejecting a whole
    # request over.
    types_value = [t for t in entry_types if t in _VALID_LOG_ENTRY_TYPES] if entry_types else None
    entries = _fetch_group_log_entries(state, row["id"], limit_value, types_value)
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
    if normalized_type not in {"message", "roll", "spotlight", "spotlight-clear", "spotlight-update"}:
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
    if normalized_type == "spotlight":
        # {kind, id, templateId, data} — templateId is optional (the "Now
        # showing" viewer can fall back to a generic display if the GM didn't
        # pick a print template), but kind/id are required to know what to
        # fetch. `data` is only meaningful for _INLINE_SPOTLIGHT_KINDS (see
        # that set's own comment) — ignored otherwise, since a real
        # Library-backed kind's content always comes from its own record.
        if not payload_value or not payload_value.get("kind") or not payload_value.get("id"):
            raise AuthError("Spotlight payload requires kind and id")
        kind_value = str(payload_value["kind"])
        if kind_value not in _INLINE_SPOTLIGHT_KINDS:
            # Defense in depth: spotlightToGroup (data-manager.js) always
            # shares the entity first via share_with_group, which already
            # enforces this same check — but that's a client-side
            # convention, not something this route itself relies on. Without
            # checking again here, posting a spotlight entry straight to
            # this endpoint (bypassing the share step) could reference a
            # generated-but-never-saved record, which then fails later —
            # and confusingly, on a viewer's screen — instead of immediately
            # telling the GM to save it first.
            if not content_exists(state, kind_value, str(payload_value["id"])):
                raise AuthError("Save this record before showing it to the table")
            template_id = payload_value.get("templateId")
            if template_id and not content_exists(state, "template", str(template_id)):
                raise AuthError("Save this template before showing it to the table")
    if normalized_type == "spotlight-update":
        # A silent data refresh on an already-shown inline-kind spotlight (a
        # clock tick, a Browser URL edit) — never posted for a real
        # Library-backed kind, whose content already lives in, and is always
        # re-fetched from, its own record.
        if not payload_value or not payload_value.get("kind") or not payload_value.get("id"):
            raise AuthError("Spotlight update payload requires kind and id")
        kind_value = str(payload_value["kind"])
        if kind_value not in _INLINE_SPOTLIGHT_KINDS:
            raise AuthError("This kind does not support inline spotlight updates")
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
        "SELECT id, owner_id FROM library_items WHERE kind = 'character' AND id = ?",
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
    group_ids = [row["id"] for row in rows]
    members_by_group = _fetch_group_members_batch(state, group_ids)
    share_links = get_share_links_batch(state, "group", group_ids)
    groups: List[Dict[str, Any]] = []
    for row in rows:
        members = _attach_member_status(members_by_group.get(row["id"], []), row["owner_id"])
        share_link = share_links.get(row["id"])
        groups.append(_serialize_group(row, members, share_link))
    return {"groups": groups}


def create_group(state: ServerState, owner: Optional[User], name: str, type_: Optional[str] = None) -> Dict[str, Any]:
    if not owner:
        raise AuthError("Authentication required")
    if role_rank(owner.tier) < role_rank(_CREATE_GROUP_MIN_TIER):
        raise AuthError("GM tier or higher required to create a campaign group")
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
        query = f"SELECT id, owner_id FROM library_items WHERE kind = 'character' AND id IN ({placeholders})"
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
        SELECT id, title, owner_id, metadata
        FROM library_items
        WHERE kind = 'character' AND id = ?
        """,
        (character_id,),
    ).fetchone()
    if not character_row:
        raise AuthError("Character not found")
    if character_row["owner_id"] != group_row["owner_id"]:
        raise AuthError("This character has already been claimed")
    metadata: Dict[str, Any] = {}
    if character_row["metadata"]:
        try:
            metadata = json.loads(character_row["metadata"])
        except json.JSONDecodeError:
            metadata = {}
    timestamp = datetime.utcnow().isoformat()
    state.db.execute(
        """
        UPDATE library_items
        SET owner_id = ?, modified_at = ?, last_accessed_at = ?
        WHERE kind = 'character' AND id = ?
        """,
        (user.id, timestamp, timestamp, character_id),
    )
    state.db.commit()
    touch_share_link(state, token)
    claimed_system_ids = metadata.get("systemIds") or ([metadata["system"]] if metadata.get("system") else [])
    return {
        "character": {
            "id": character_row["id"],
            "name": character_row["title"],
            "system_ids": [sid for sid in claimed_system_ids if sid],
            "system": claimed_system_ids[0] if claimed_system_ids else "",
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
