from __future__ import annotations

import copy
import json
import secrets
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .auth import AuthError, User
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
# A Group IS a Library kind now (undercroft/common/data/kind/group.json,
# library_items row + undercroft/common/data/group/{id}.json flat file —
# same generic model System/Character/Map already use; see
# storage.py's _migrate_groups_to_library_items for the one-time migration
# off the old bespoke `groups` table). `storage` is imported lazily inside
# each function below rather than at module level — storage.py itself
# imports a handful of functions FROM this module (accessible_group_ids,
# user_can_access_group, get_active_spotlights), so a top-level import on
# both sides would cycle; storage.py's own side of that already made its
# imports of this module function-local for the same reason.
#
# GM tier, not Creator: Creator is about authoring reusable CONTENT (Systems,
# Templates, ...) for others to use, while a Campaign Group is a GM's own
# session-running tool — setting one up is exactly what "being a GM" means,
# not a content-authoring action. This is expressed as group.json's own
# writeTier: "gm" (enforced generically by storage.save_item's
# ensure_write_role), not a bespoke check here.

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

# Kinds allowed to post a `spotlight-update` entry — a strict superset of
# _INLINE_SPOTLIGHT_KINDS above, NOT the same set. "encounter" is a real,
# Library-backed kind (content_exists() IS still enforced for it on initial
# `spotlight` creation, below) — it's here only because combat-tracker.js's
# own hideFromTable deliberately patches `data.hidden` on an
# already-announced spotlight via updateSpotlightData instead of clearing it
# outright, so the encounter stays "the active encounter" (still findable by
# character-sheet.js's pushInitiativeToActiveEncounter) while merely hidden
# from table display. Folding "encounter" into _INLINE_SPOTLIGHT_KINDS
# itself instead of a separate set would have also skipped THAT kind's
# content_exists() check at spotlight-creation time (the branch just above
# this comment's own home), which is real, wanted validation for a
# Library-backed record — this set exists so expanding "who can patch" never
# has to loosen "who gets validated on the way in."
_SPOTLIGHT_UPDATE_ALLOWED_KINDS = _INLINE_SPOTLIGHT_KINDS | {"encounter"}


def _generate_group_id(state: ServerState) -> str:
    while True:
        candidate = f"{_GROUP_ID_PREFIX}{secrets.token_hex(6)}"
        row = state.db.execute(
            "SELECT 1 FROM library_items WHERE kind = 'group' AND id = ?", (candidate,)
        ).fetchone()
        if not row:
            return candidate


def _normalize_group_type(raw: Optional[str]) -> str:
    value = (raw or "").strip().lower()
    return value or "campaign"


def _load_group_row(state: ServerState, group_id: str) -> Optional[Dict[str, Any]]:
    """The Group-document-shaped equivalent of the old `SELECT * FROM groups
    WHERE id = ?` — a Group is a generic Library kind now (a library_items
    row for owner_id/timestamps, plus its own JSON file for everything else
    — see storage.py's _migrate_groups_to_library_items), so this reads both
    and reshapes them back into the exact field names every caller in this
    file already expects (name/system_id/setting_id, not the JSON's own
    title/systemId/settingId) so nothing downstream of this function has to
    change. `properties`/`property_values` (the new Group Properties
    mechanism) are included here too, for _serialize_group and the new
    property-value endpoints to read straight off this same row. Returns
    None if no such group exists, same as a missing SELECT row would.
    """
    from . import storage

    meta_row = state.db.execute(
        "SELECT owner_id, created_at, modified_at FROM library_items WHERE kind = 'group' AND id = ?",
        (group_id,),
    ).fetchone()
    if not meta_row:
        return None
    try:
        payload = storage.load_item_raw(state, "group", group_id)
    except FileNotFoundError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return {
        "id": group_id,
        "owner_id": meta_row["owner_id"],
        "name": payload.get("title") or group_id,
        "type": payload.get("type") or "campaign",
        "system_id": payload.get("systemId"),
        "setting_id": payload.get("settingId"),
        "template_id": payload.get("templateId"),
        # The campaign's own tracked "what date is it in the fiction"
        # state — same conceptual tier as system_id/setting_id above (a
        # GM advances it over time, every tool reads the same value via
        # this one Group). dayIndex mirrors the Calendar widget's own
        # existing day-count representation (0 = an arbitrary campaign-
        # start epoch, negative = before it); minutesOfDay is 0-1439.
        # Both None until a GM actually sets one — no forced default.
        "campaign_day_index": payload.get("campaignDayIndex"),
        "campaign_minutes_of_day": payload.get("campaignMinutesOfDay"),
        "properties": payload.get("properties") or [],
        "property_values": payload.get("propertyValues") or {},
        "created_at": meta_row["created_at"],
        "modified_at": meta_row["modified_at"],
    }


def _require_owner(state: ServerState, group_id: str, owner: Optional[User]) -> Dict[str, Any]:
    if not owner:
        raise AuthError("Authentication required")
    row = _load_group_row(state, group_id)
    if not row:
        raise AuthError("Group not found")
    # Admin-or-owner — same rule _resolve_group_access/user_can_access_group
    # already enforce for read access to a group; this is the write-side
    # (rename/delete/manage members/share link) equivalent, previously
    # missing the admin bypass those two already had.
    if row["owner_id"] != owner.id and owner.tier != "admin":
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
    # `row["system_id"]`/`row["setting_id"]` — verified actually present in
    # every caller's own SELECT (not assumed), per this project's own
    # established caution around _serialize_group previously shipping with a
    # field silently missing from its returned dict. `properties`/
    # `propertyValues` (the Group Properties mechanism — see
    # _load_group_row) are optional on `row` since not every caller loads
    # the full document (e.g. list_character_groups' own lighter query never
    # needs them) — default to the same "no properties defined yet" shape a
    # brand-new group's own JSON file already starts with.
    return {
        "id": row["id"],
        "owner_id": row["owner_id"],
        "name": row["name"],
        "type": row["type"],
        "system_id": row["system_id"] if "system_id" in row.keys() else None,
        "setting_id": row["setting_id"] if "setting_id" in row.keys() else None,
        "template_id": row["template_id"] if "template_id" in row.keys() else None,
        "campaign_day_index": row["campaign_day_index"] if "campaign_day_index" in row.keys() else None,
        "campaign_minutes_of_day": row["campaign_minutes_of_day"] if "campaign_minutes_of_day" in row.keys() else None,
        "properties": row["properties"] if "properties" in row.keys() else [],
        "propertyValues": row["property_values"] if "property_values" in row.keys() else {},
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


def _load_group_access_row(state: ServerState, group_id: str) -> Optional[Dict[str, Any]]:
    """Lightweight group lookup for access-control checks — owner_id/name/
    type only, read straight off library_items (the `title` column, plus
    `type` from its own denormalized `metadata` — see group.json's
    metadataFields) without ever touching the group's JSON file. Distinct
    from the fuller _load_group_row (which does read the file, for anything
    that actually needs system_id/settingId/properties) since this sits on
    the hot path for every single game log read/post.
    """
    row = state.db.execute(
        "SELECT owner_id, title, metadata FROM library_items WHERE kind = 'group' AND id = ?",
        (group_id,),
    ).fetchone()
    if not row:
        return None
    metadata: Dict[str, Any] = {}
    if row["metadata"]:
        try:
            metadata = json.loads(row["metadata"])
        except json.JSONDecodeError:
            metadata = {}
    return {
        "id": group_id,
        "owner_id": row["owner_id"],
        "name": row["title"] or group_id,
        "type": metadata.get("type") or "campaign",
    }


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
    row = _load_group_access_row(state, resolved_id)
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
    # Pure read — called (via storage.py's is_shared) from both unlocked
    # routes and still-locked write paths. See is_owner's own comment
    # (storage.py) on why read_db is safe from either.
    if not user or not group_id:
        return False
    row = state.read_db.execute(
        "SELECT owner_id FROM library_items WHERE kind = 'group' AND id = ?", (group_id,)
    ).fetchone()
    if not row:
        return False
    if user.tier == "admin" or row["owner_id"] == user.id:
        return True
    membership = state.read_db.execute(
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
    # Pure read — called (via storage.py's list_bucket) from an unlocked
    # route. See is_owner's own comment (storage.py) on why read_db is safe.
    if not user:
        return []
    owned = [
        row["id"]
        for row in state.read_db.execute(
            "SELECT id FROM library_items WHERE kind = 'group' AND owner_id = ?", (user.id,)
        )
    ]
    member_of = [
        row["group_id"]
        for row in state.read_db.execute(
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
    # Pure read — only ever called from storage.py's get_item, an unlocked
    # route. See is_owner's own comment (storage.py) on why read_db is safe.
    rows = state.read_db.execute(
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
        # A silent data refresh on an already-shown spotlight — usually a
        # content refresh for an inline-kind widget (a clock tick, a Browser
        # URL edit), whose content already lives in, and is always re-fetched
        # from, the log entry itself rather than a record. "encounter" is the
        # one Library-backed exception, allowed here only to patch
        # `data.hidden` without re-announcing — see
        # _SPOTLIGHT_UPDATE_ALLOWED_KINDS' own comment for why.
        if not payload_value or not payload_value.get("kind") or not payload_value.get("id"):
            raise AuthError("Spotlight update payload requires kind and id")
        kind_value = str(payload_value["kind"])
        if kind_value not in _SPOTLIGHT_UPDATE_ALLOWED_KINDS:
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
    # Same "bump the group's own modified_at on log activity" behavior the
    # old `groups` table always had (used for list_groups' own recency
    # sort) — now targeting library_items directly, same as
    # update_group_members' identical comment on this same pattern.
    state.db.execute(
        "UPDATE library_items SET modified_at = ? WHERE kind = 'group' AND id = ?",
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


# A map "ping" — a transient pointer broadcast (Orrery's click-to-ping tool),
# never written to group_logs/library_items at all (see
# ServerState.pending_pings' own comment for why). Reuses the exact same
# membership check create_group_log_entry does via _resolve_group_access —
# only an actual member (or the owner/admin) of a real campaign group can
# post one, same as posting to the group's own log.
def record_group_ping(
    state: ServerState,
    group_id: Optional[str],
    user: Optional[User],
    *,
    share_token: Optional[str] = None,
    position: Optional[Dict[str, Any]] = None,
) -> None:
    # `position` is opaque here — {x,y} for an image/canvas base map, {lat,lng}
    # for a tile one, same as a marker element's own `.position` (see
    # orrery/js/lib/map-viewer.js's markerPositionToLocalPixel) — stored and
    # relayed through the SSE stream as-is, never interpreted server-side.
    if not isinstance(position, dict) or not position:
        raise AuthError("Ping requires a position")
    row, _ = _resolve_group_access(state, group_id, user, share_token=share_token)
    by = (user.username if user else "") or "A visitor"
    state.record_ping(row["id"], {"position": position, "by": by})


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
    # `g` here is library_items filtered to kind='group' — a Group is a
    # generic Library kind now (see _load_group_row's own comment), not a
    # dedicated `groups` table to JOIN against.
    if owner_id != user.id and user.tier != "admin":
        ownership = state.db.execute(
            """
            SELECT g.owner_id
            FROM group_members AS gm
            JOIN library_items AS g ON g.kind = 'group' AND g.id = gm.group_id
            WHERE gm.content_type = 'character' AND gm.content_id = ? AND g.owner_id = ?
            LIMIT 1
            """,
            (character_id, user.id),
        ).fetchone()
        if not ownership and owner_id != user.id:
            raise AuthError("Access denied")
    rows = state.db.execute(
        """
        SELECT g.id, g.title, g.metadata, g.owner_id
        FROM group_members AS gm
        JOIN library_items AS g ON g.kind = 'group' AND g.id = gm.group_id
        WHERE gm.content_type = 'character' AND gm.content_id = ?
        ORDER BY g.modified_at DESC
        """,
        (character_id,),
    ).fetchall()
    groups: List[Dict[str, Any]] = []
    for row in rows:
        if user.tier == "admin" or row["owner_id"] == user.id or owner_id == user.id:
            metadata: Dict[str, Any] = {}
            if row["metadata"]:
                try:
                    metadata = json.loads(row["metadata"])
                except json.JSONDecodeError:
                    metadata = {}
            groups.append(
                {
                    "id": row["id"],
                    "name": row["title"] or row["id"],
                    "type": metadata.get("type") or "campaign",
                    "owner_id": row["owner_id"],
                }
            )
    return {"groups": groups}


def _access_row_to_group_fields(row) -> Dict[str, Any]:
    """Shapes a library_items(+metadata) row into the same field names
    _serialize_group expects (name/type/system_id/setting_id) — used by list
    views, which (like every other kind's own list_bucket/list_owned_content)
    read only the cheap library_items/metadata columns, never the full JSON
    file, to avoid an N-file-reads cost for what's usually a short list.
    Deliberately omits properties/propertyValues (not in metadataFields, so
    not available this way at all) — _serialize_group already defaults those
    to []/{} when absent, which is correct here: a list view has no need for
    a group's full Properties schema+values, only get_item (a single group)
    does.
    """
    metadata: Dict[str, Any] = {}
    if row["metadata"]:
        try:
            metadata = json.loads(row["metadata"])
        except json.JSONDecodeError:
            metadata = {}
    return {
        "id": row["id"],
        "owner_id": row["owner_id"],
        "name": row["title"] or row["id"],
        "type": metadata.get("type") or "campaign",
        "system_id": metadata.get("systemId"),
        "setting_id": metadata.get("settingId"),
        "template_id": metadata.get("templateId"),
        # Available here (the cheap metadata-column path list_groups uses)
        # because group.json's own metadataFields lists these two — the
        # same reason systemId/settingId above are readable without a full
        # JSON-file fetch. This is the path resolveGroupContext's own
        # listGroups() call actually reads.
        "campaign_day_index": metadata.get("campaignDayIndex"),
        "campaign_minutes_of_day": metadata.get("campaignMinutesOfDay"),
        "created_at": row["created_at"],
        "modified_at": row["modified_at"],
    }


def list_groups(state: ServerState, owner: Optional[User], scope: str = "owned") -> Dict[str, Any]:
    if not owner:
        raise AuthError("Authentication required")
    if scope == "member":
        # Owned groups PLUS any group where a character this user owns has
        # been added as a member — e.g. a GM added the user's own character
        # to their campaign. This is the account menu's "pick your active
        # campaign" selector (auth-ui.js's own refreshUserMenu) — a
        # read-only listing, so surfacing a group here you don't own is
        # fine. Deliberately NOT the default scope: Loom's own group-
        # management tab calls this same function with the default "owned"
        # scope, which must stay owner-only — that UI offers rename/delete/
        # member-editing controls _require_owner would reject for anything
        # you don't own, so it should never even list those groups. `g` is
        # library_items filtered to kind='group' — see _load_group_row's own
        # comment on why there's no dedicated `groups` table any more.
        rows = state.db.execute(
            """
            SELECT DISTINCT g.id, g.owner_id, g.title, g.metadata, g.created_at, g.modified_at
            FROM library_items AS g
            LEFT JOIN group_members AS gm ON gm.group_id = g.id AND gm.content_type = 'character'
            LEFT JOIN library_items AS li ON li.id = gm.content_id AND li.kind = 'character'
            WHERE g.kind = 'group' AND (g.owner_id = ? OR li.owner_id = ?)
            ORDER BY g.modified_at DESC
            """,
            (owner.id, owner.id),
        ).fetchall()
    else:
        rows = state.db.execute(
            """
            SELECT id, owner_id, title, metadata, created_at, modified_at
            FROM library_items
            WHERE kind = 'group' AND owner_id = ?
            ORDER BY modified_at DESC
            """,
            (owner.id,),
        ).fetchall()
    group_fields = [_access_row_to_group_fields(row) for row in rows]
    group_ids = [fields["id"] for fields in group_fields]
    members_by_group = _fetch_group_members_batch(state, group_ids)
    share_links = get_share_links_batch(state, "group", group_ids)
    groups: List[Dict[str, Any]] = []
    for fields in group_fields:
        members = _attach_member_status(members_by_group.get(fields["id"], []), fields["owner_id"])
        share_link = share_links.get(fields["id"])
        groups.append(_serialize_group(fields, members, share_link))
    return {"groups": groups}


# Party Inventory — every campaign's starting Group Property, seeded once
# at create_group, upgraded once more in update_group the first time a
# System actually gets assigned (see that function's own comment for why
# create_group itself can never mirror a System — Loom's "New Group"
# dialog only ever collects a name), and backfilled onto every
# pre-existing campaign by storage.py's own migration. No hardcoded
# per-system item shape (see this project's own standing "avoid hardcoding
# in Undercroft tools" convention) — mirrors whatever the associated
# System's own top-level "inventory" field already looks like (the exact
# convention a Character's own Inventory already follows for that System),
# verbatim, so a Repeater bound to "@group.inventory" behaves identically
# to one bound to "@inventory" on that System's own characters. Falls back
# to a minimal generic Name/Quantity shape only for a System with no such
# field of its own (or no System chosen yet).
_GENERIC_INVENTORY_PROPERTY: Dict[str, Any] = {
    "key": "inventory",
    "label": "Inventory",
    "type": "array",
    "item": {
        "type": "object",
        "label": "Item",
        "displayField": "inventory[].name",
        "children": [
            {"type": "string", "key": "inventory[].name", "label": "Item Name", "required": True},
            {"type": "number", "key": "inventory[].quantity", "label": "Quantity", "minimum": 0},
        ],
    },
}


def _find_system_inventory_field(system_payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Same candidate-set walk common/js/lib/system-schema.js's own
    collectSystemFields uses (system.fields / system.schema.fields /
    system.definition.fields, whichever exists) — just far enough to find
    ONE top-level field by key, not the full recursive flatten that module
    needs for binding autocomplete."""
    candidate_sets: List[List[Any]] = []
    fields = system_payload.get("fields")
    if isinstance(fields, list):
        candidate_sets.append(fields)
    elif isinstance(fields, dict):
        candidate_sets.append(list(fields.values()))
    schema = system_payload.get("schema")
    if isinstance(schema, dict):
        schema_fields = schema.get("fields")
        if isinstance(schema_fields, list):
            candidate_sets.append(schema_fields)
        elif isinstance(schema_fields, dict):
            candidate_sets.append(list(schema_fields.values()))
    definition = system_payload.get("definition")
    if isinstance(definition, dict):
        definition_fields = definition.get("fields")
        if isinstance(definition_fields, list):
            candidate_sets.append(definition_fields)
        elif isinstance(definition_fields, dict):
            candidate_sets.append(list(definition_fields.values()))
    for fields_list in candidate_sets:
        for field in fields_list:
            if isinstance(field, dict) and field.get("key") == "inventory":
                return field
    return None


def _default_inventory_property(state: ServerState, system_id: Optional[str]) -> Dict[str, Any]:
    from . import storage

    field = None
    if system_id:
        try:
            system_payload = storage.load_item_raw(state, "system", system_id)
        except FileNotFoundError:
            system_payload = None
        if isinstance(system_payload, dict):
            field = _find_system_inventory_field(system_payload)
    property_field = copy.deepcopy(field) if field else copy.deepcopy(_GENERIC_INVENTORY_PROPERTY)
    # Public by design, not left to the usual GM-decides-per-property
    # default — the whole point of a Party Inventory is that any party
    # member can add/remove/edit items, same as D&D Beyond's own party
    # inventory this feature was originally modeled on.
    property_field["public"] = True
    return property_field


def create_group(state: ServerState, owner: Optional[User], name: str, type_: Optional[str] = None) -> Dict[str, Any]:
    from . import storage

    if not owner:
        raise AuthError("Authentication required")
    label = (name or "").strip()
    if not label:
        raise AuthError("Group name is required")
    group_id = _generate_group_id(state)
    normalized_type = _normalize_group_type(type_)
    payload = {
        "title": label,
        "type": normalized_type,
        "systemId": None,
        "settingId": None,
        "templateId": None,
        # No System exists yet at creation time (Loom's own "New Group"
        # dialog only ever collects a name — see _default_inventory_property's
        # own comment), so this always starts as the generic fallback shape;
        # update_group below upgrades it to match whatever System the GM
        # assigns next, as long as it's still untouched.
        "properties": [_default_inventory_property(state, None)],
        "propertyValues": {},
    }
    # storage.save_item's own ensure_write_role (group.json's own
    # writeTier: "gm") enforces the "GM tier or higher" rule that used to be
    # a bespoke check here — Group is a generic Library kind now, so
    # kind-wide creation gating is exactly what that shared mechanism
    # already does for every other kind, no bespoke duplicate needed.
    storage.save_item(state, "group", group_id, payload, owner)
    row = _load_group_row(state, group_id)
    members: List[Dict[str, Any]] = []
    return _serialize_group(row, _attach_member_status(members, owner.id), None)


def update_group(
    state: ServerState,
    owner: Optional[User],
    group_id: str,
    name: Optional[str] = None,
    system_id: Optional[str] = None,
    setting_id: Optional[str] = None,
    template_id: Optional[str] = None,
    properties: Optional[List[Dict[str, Any]]] = None,
    campaign_day_index: Optional[int] = None,
    campaign_minutes_of_day: Optional[int] = None,
) -> Dict[str, Any]:
    from . import storage

    row = _require_owner(state, group_id, owner)
    previous_system_id = row["system_id"]
    updated = False
    if name is not None:
        label = name.strip()
        if not label:
            raise AuthError("Group name is required")
        row["name"] = label
        updated = True
    if system_id is not None:
        # Blank clears it (a campaign that stops declaring a System falls
        # back to Section 2's next tier — the character's own systemIds,
        # then the standard 7) — matches this project's "optional fields
        # start absent, no forced backfill" convention.
        row["system_id"] = system_id.strip() or None
        updated = True
    if setting_id is not None:
        # Same "blank clears it" convention as system_id above.
        row["setting_id"] = setting_id.strip() or None
        updated = True
    if template_id is not None:
        # Same "blank clears it" convention — the campaign's own "Party
        # Data" template (Workbench's own no-character mode), independent
        # of a Character's own `metadata.template`.
        row["template_id"] = template_id.strip() or None
        updated = True
    if properties is not None:
        # The Group Properties SCHEMA (Loom's own Group tab, same
        # PROPERTY_TYPES/row editor as System's own Properties) — GM-only,
        # consistent with the rest of this function already being owner-
        # gated via _require_owner above. No shape validation here, same
        # "trust the editor, not the wire" convention System's own fields
        # save follows (storage.save_item never validates a kind's own
        # payload shape either) — a malformed entry just doesn't do
        # anything useful client-side, it can't corrupt anything else.
        row["properties"] = properties if isinstance(properties, list) else []
        updated = True
    # No "blank clears it" here — these are integers (0 is a real, valid
    # day index: the campaign's own start epoch), not strings, so the only
    # signal available is "was this argument passed at all" — same as
    # every other field above, just without a string to strip.
    if campaign_day_index is not None:
        row["campaign_day_index"] = campaign_day_index
        updated = True
    if campaign_minutes_of_day is not None:
        row["campaign_minutes_of_day"] = campaign_minutes_of_day
        updated = True
    # The Party Inventory property starts as a generic placeholder (no
    # System exists yet at create_group time) — the first time a GM
    # actually assigns a System to this campaign, upgrade it to mirror
    # that System's own "inventory" field, but ONLY if it's still exactly
    # the untouched placeholder. Runs after both system_id and properties
    # may have already been applied above (a single combined Loom save
    # sends both together), so this always sees the final state rather
    # than a value about to be overwritten by the properties branch above.
    # A GM who already customized it (renamed columns, added fields, ...)
    # keeps their own version untouched, same as it would if they'd picked
    # the System first and customized Inventory afterward.
    if not previous_system_id and row["system_id"]:
        current_properties = row["properties"] if isinstance(row["properties"], list) else []
        inventory_index = next(
            (i for i, p in enumerate(current_properties) if isinstance(p, dict) and p.get("key") == "inventory"),
            None,
        )
        if inventory_index is not None and current_properties[inventory_index] == _default_inventory_property(state, None):
            current_properties[inventory_index] = _default_inventory_property(state, row["system_id"])
            row["properties"] = current_properties
            updated = True
    if updated:
        # Re-saves the WHOLE document (fetched fresh by _require_owner just
        # above, in this same request) — propertyValues always passes
        # through untouched here (this function only ever changes the
        # Properties SCHEMA, never a value), so renaming a group or editing
        # its Properties never clobbers value data a player may be
        # concurrently writing via the separate property-value endpoint.
        payload = {
            "title": row["name"],
            "type": row["type"],
            "systemId": row["system_id"],
            "settingId": row["setting_id"],
            "templateId": row["template_id"],
            "campaignDayIndex": row["campaign_day_index"],
            "campaignMinutesOfDay": row["campaign_minutes_of_day"],
            "properties": row["properties"],
            "propertyValues": row["property_values"],
        }
        storage.save_item(state, "group", group_id, payload, owner)
        row = _load_group_row(state, group_id)
    members = _attach_member_status(_fetch_group_members(state, group_id), row["owner_id"])
    share_link = get_share_link(state, "group", group_id)
    return _serialize_group(row, members, share_link)


def delete_group(state: ServerState, owner: Optional[User], group_id: str) -> None:
    from . import storage

    _require_owner(state, group_id, owner)
    # Clears the group's own library_items row + JSON file, and (same as
    # every other kind) its shares/share_links rows. group_members/
    # group_logs have no FK-cascade to rely on (this codebase never enables
    # SQLite FK enforcement, so the old `groups` table's own ON DELETE
    # CASCADE never actually fired either), so they're cleaned up
    # explicitly here, matching delete_item's own explicit-cleanup style.
    storage.delete_item(state, "group", group_id, owner)
    state.db.execute("DELETE FROM group_members WHERE group_id = ?", (group_id,))
    state.db.execute("DELETE FROM group_logs WHERE group_id = ?", (group_id,))
    state.db.commit()


def update_group_members(state: ServerState, owner: Optional[User], group_id: str, character_ids: Iterable[str]) -> Dict[str, Any]:
    _require_owner(state, group_id, owner)
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
        # No longer requires character.owner_id == group.owner_id — a
        # campaign group's whole point is to hold the PLAYERS' characters,
        # which the GM (this group's owner) doesn't own. _require_owner
        # above already confirmed the caller is this group's owner (or an
        # admin); that's the actual authorization boundary for "who may
        # decide which characters belong to this group," not who owns each
        # individual character.
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
    # Touches library_items.modified_at directly (not a full storage.save_item
    # call — nothing about the group's own JSON document changed here, just
    # its membership) — this is also what the "group" live-stream kind polls
    # against (server/app.py's _handle_live_stream watches library_items.
    # modified_at per kind), so a membership change is picked up the same
    # way a document change would be.
    state.db.execute(
        "UPDATE library_items SET modified_at = ? WHERE kind = 'group' AND id = ?",
        (timestamp, group_id),
    )
    state.db.commit()
    refreshed = _load_group_row(state, group_id)
    members = _attach_member_status(_fetch_group_members(state, group_id), refreshed["owner_id"])
    share_link = get_share_link(state, "group", group_id)
    return _serialize_group(refreshed, members, share_link)


# Group Properties — a value write (e.g. a player adding a party inventory
# item) is a fundamentally different permission shape than everything else
# in this file: the caller may be neither the group's owner nor an
# edit-shared collaborator, yet still be allowed to write ONE specific
# property whose schema marks it `public` (the GM's own per-property
# checkbox, set via Loom's Group Properties editor — see PROPERTY_TYPES/
# property-schema-editor.js). storage.save_item's generic owner-or-edit-
# share gate has no way to express "this one field, for this one class of
# caller" — hence this bespoke endpoint/permission-check pair instead of
# routing property values through the generic /content/group/{id} route
# Loom's own document edits (create_group/update_group) already use.
def update_group_property_value(state: ServerState, user: Optional[User], group_id: str, key: str, value: Any) -> Dict[str, Any]:
    from . import storage

    if not user:
        raise AuthError("Authentication required")
    key = (key or "").strip()
    if not key:
        raise AuthError("Property key is required")
    row = _load_group_row(state, group_id)
    if not row:
        raise AuthError("Group not found")
    is_owner_or_admin = user.tier == "admin" or row["owner_id"] == user.id
    if not is_owner_or_admin:
        if not user_can_access_group(state, group_id, user):
            raise AuthError("Access denied")
        schema = row["properties"] if isinstance(row["properties"], list) else []
        prop = next((p for p in schema if isinstance(p, dict) and p.get("key") == key), None)
        if not prop or not prop.get("public"):
            raise AuthError("This property isn't editable by players")
    # Fetch-fresh immediately before mutating (not the `row` above, which
    # only exists for the permission check) — same concurrency-safety
    # reasoning as every fetch-fresh/mutate/save write in
    # common/js/lib/map-live-sync.js, just server-side: another writer
    # (the GM renaming the group, or another player editing a different
    # property) could have saved in between.
    payload = storage.load_item_raw(state, "group", group_id)
    if not isinstance(payload, dict):
        payload = {}
    property_values = payload.get("propertyValues")
    if not isinstance(property_values, dict):
        property_values = {}
    property_values[key] = value
    payload["propertyValues"] = property_values
    storage.write_item_raw(state, "group", group_id, payload)
    # write_item_raw deliberately skips library_items entirely (it has no
    # ownership/tier check to make that safe generically) — bump
    # modified_at here by hand, the same one-line touch update_group_members
    # above already does, so the "group" live-stream kind (server/app.py's
    # _handle_live_stream, which polls library_items.modified_at per kind)
    # notices this write.
    timestamp = datetime.utcnow().isoformat()
    state.db.execute(
        "UPDATE library_items SET modified_at = ? WHERE kind = 'group' AND id = ?",
        (timestamp, group_id),
    )
    state.db.commit()
    return {"ok": True, "key": key, "value": value, "propertyValues": property_values}


def get_group_share_details(state: ServerState, token: str) -> Dict[str, Any]:
    info = resolve_share_token(state, token)
    if not info or info.get("content_type") != "group":
        raise AuthError("Invalid or expired share link")
    touch_share_link(state, token)
    group_id = info["content_id"]
    row = _load_group_row(state, group_id)
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
            "system_id": row["system_id"],
            "setting_id": row["setting_id"],
            "template_id": row["template_id"],
            "campaign_day_index": row["campaign_day_index"],
            "campaign_minutes_of_day": row["campaign_minutes_of_day"],
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
    group_row = _load_group_access_row(state, group_id)
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
