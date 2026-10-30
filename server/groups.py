from __future__ import annotations

import copy
import json
import secrets
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

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
# The only kind of group: the people playing together. (A Campaign is a named run
# of sessions inside one, never a group of its own.)
PLAYER_GROUP_TYPE = "player-group"
# A Group IS a Library kind now (undercroft/common/data/kind/group.json,
# library_items row + undercroft/common/data/group/{id}.json flat file —
# same generic model System/Character/Map already use; see
# storage.py's _migrate_groups_to_library_items for the one-time migration
# off the old bespoke `groups` table). `storage` is imported lazily inside
# each function below rather than at module level — storage.py itself
# imports a handful of functions FROM this module (accessible_group_ids,
# user_can_access_group), so a top-level import on
# both sides would cycle; storage.py's own side of that already made its
# imports of this module function-local for the same reason.
#
# GM tier, not Creator: Creator is about authoring reusable CONTENT (Systems,
# Templates, ...) for others to use, while a Player Group is a GM's own
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
#
# "shop" is a different kind of exception again: its own `id` IS a real,
# permanent Location id (not an ephemeral widget-instance id the way
# browser/clock/calendar/soundboard's own ids are), and its live state
# genuinely is a persisted, shared record — just a Group Property
# (server-side, this same group's own `properties`/`propertyValues`), not a
# Library-kind record. There's still no "shop" Library kind/bucket for
# content_exists() to check here, so it belongs in this set for that reason
# alone — undercroft/common/js/lib/widgets/shop.js's own header explains why
# a Shop widget reads this spotlight's `id` straight as a Location id rather
# than treating it as an instance to follow.
_INLINE_SPOTLIGHT_KINDS = {"browser", "clock", "calendar", "soundboard", "shop"}

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
    return value or PLAYER_GROUP_TYPE


# A group's members are polymorphic rows in `group_members`: `character` (the
# roster), `player` (content_id = user id; joined = added_at) and `campaign`
# (content_id = campaign id; label = its name; status = active / on_hiatus /
# completed). The queries below always name the content_type they mean.
def _is_player(db, group_id: str, user_id: Optional[int]) -> bool:
    if user_id is None:
        return False
    return (
        db.execute(
            "SELECT 1 FROM group_members WHERE group_id = ? AND content_type = 'player' AND content_id = ? LIMIT 1",
            (group_id, str(user_id)),
        ).fetchone()
        is not None
    )


def ensure_player(state: ServerState, group_id: str, user_id: Optional[int]) -> None:
    """Makes `user_id` a player of the group (a no-op for the GM). The caller commits."""
    if user_id is None:
        return
    owner_row = state.db.execute(
        "SELECT owner_id FROM library_items WHERE kind = 'group' AND id = ?", (group_id,)
    ).fetchone()
    if not owner_row or owner_row["owner_id"] == user_id:
        return
    state.db.execute(
        "INSERT OR IGNORE INTO group_members (group_id, content_type, content_id, added_at) VALUES (?, 'player', ?, ?)",
        (group_id, str(user_id), datetime.utcnow().isoformat()),
    )


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
        "type": payload.get("type") or PLAYER_GROUP_TYPE,
        "system_id": payload.get("systemId"),
        "setting_id": payload.get("settingId"),
        "template_id": payload.get("templateId"),
        # The group's own tracked "what date is it in the fiction"
        # state — same conceptual tier as system_id/setting_id above (a
        # GM advances it over time, every tool reads the same value via
        # this one Group). dayIndex mirrors the Calendar widget's own
        # existing day-count representation (0 = an arbitrary campaign-
        # start epoch, negative = before it); minutesOfDay is 0-1439.
        # Both None until a GM actually sets one — no forced default.
        "group_day_index": payload.get("groupDayIndex"),
        "group_minutes_of_day": payload.get("groupMinutesOfDay"),
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
               gm.active AS member_active,
               li.title AS character_title,
               li.metadata AS character_metadata,
               li.owner_id AS character_owner_id,
               u.username AS owner_username
        FROM group_members AS gm
        LEFT JOIN library_items AS li ON li.kind = 'character' AND li.id = gm.content_id
        LEFT JOIN users AS u ON u.id = li.owner_id
        WHERE gm.group_id IN ({group_placeholders}) AND gm.content_type = 'character'
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
            # A NULL (a row written before the flag existed and never backfilled)
            # reads as active, the same as the migration's own treatment.
            "active": row["member_active"] != 0,
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


def _group_extras(state: ServerState, group_ids: List[str]) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """The non-character `group_members` rows of each group: its players (with
    usernames) and its campaigns."""
    extras: Dict[str, Dict[str, List[Dict[str, Any]]]] = {gid: {"players": [], "campaigns": []} for gid in group_ids}
    if not group_ids:
        return extras
    marks = ",".join("?" for _ in group_ids)
    for row in state.db.execute(
        f"""
        SELECT gm.group_id, gm.content_type, gm.content_id, gm.added_at, gm.label, gm.status, u.username
        FROM group_members AS gm
        LEFT JOIN users AS u ON gm.content_type = 'player' AND u.id = CAST(gm.content_id AS INTEGER)
        WHERE gm.group_id IN ({marks}) AND gm.content_type IN ('player', 'campaign')
        ORDER BY gm.added_at, gm.content_id
        """,
        tuple(group_ids),
    ):
        if row["content_type"] == "player":
            extras[row["group_id"]]["players"].append(
                {"user_id": int(row["content_id"]), "username": row["username"] or "", "joined_at": row["added_at"]}
            )
        else:
            extras[row["group_id"]]["campaigns"].append(
                {"id": row["content_id"], "name": row["label"] or "", "status": row["status"], "created_at": row["added_at"]}
            )
    return extras


def _serialize_group(row, members: List[Dict[str, Any]], share_link: Optional[Dict[str, Any]], extras: Optional[Dict[str, List[Dict[str, Any]]]] = None) -> Dict[str, Any]:
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
        "group_day_index": row["group_day_index"] if "group_day_index" in row.keys() else None,
        "group_minutes_of_day": row["group_minutes_of_day"] if "group_minutes_of_day" in row.keys() else None,
        "properties": row["properties"] if "properties" in row.keys() else [],
        "propertyValues": row["property_values"] if "property_values" in row.keys() else {},
        "created_at": row["created_at"],
        "modified_at": row["modified_at"],
        "share_link": share_link,
        "members": members,
        "players": (extras or {}).get("players", []),
        "campaigns": (extras or {}).get("campaigns", []),
    }


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
        "type": metadata.get("type") or PLAYER_GROUP_TYPE,
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
    if row["type"] and row["type"].lower() != PLAYER_GROUP_TYPE:
        raise AuthError("Group chat is only available for player groups")
    if share_mode:
        return row, True
    if not user:
        raise AuthError("Authentication required")
    if user.tier == "admin" or row["owner_id"] == user.id:
        return row, False
    if _is_player(state.db, resolved_id, user.id):
        return row, False
    raise AuthError("Access denied")


def user_can_access_group(state: ServerState, group_id: str, user: Optional[User]) -> bool:
    """Owner-or-member-via-character-ownership check — the same access rule
    _resolve_group_access enforces for the game log, extracted standalone
    (no share-token handling, no player-group-type restriction, returns a bool
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
    return _is_player(state.read_db, group_id, user.id)


def _group_member_user_ids(state: ServerState, group_id: str, owner_id: Optional[int]) -> Set[int]:
    """Every user id with real access to this group — the GM (owner_id) plus
    every distinct account that owns a character currently a member of it.
    Used by chat.py to validate a direct message's requested
    recipient ids against actual membership (same query shape
    _resolve_group_access/user_can_access_group already run for a single
    user at a time, just widened to return the whole set at once) — an id
    that isn't in this set gets silently dropped from the recipient list
    rather than failing the whole post, since a stale roster on the client
    (a player who's since left the group) shouldn't block sending the
    rest of a message.
    """
    ids: Set[int] = set()
    if owner_id is not None:
        ids.add(owner_id)
    for row in state.db.execute(
        "SELECT content_id FROM group_members WHERE group_id = ? AND content_type = 'player'", (group_id,)
    ):
        ids.add(int(row["content_id"]))
    return ids


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
            "SELECT group_id FROM group_members WHERE content_type = 'player' AND content_id = ?", (str(user.id),)
        )
    ]
    return list({*owned, *member_of})


# A map "ping" — a transient pointer broadcast (Orrery's click-to-ping tool),
# never written to the chat tables/library_items at all (see
# ServerState.pending_pings' own comment for why). Reuses the exact same
# membership check chat posting does via _resolve_group_access —
# only an actual member (or the owner/admin) of a real player group can
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


# Same transient-broadcast shape as record_group_ping above, but GM-only —
# confirmed explicit design call (Cards/Decks plan, Part 1): only the GM can
# roll dice that everyone sees animate on their own screen. Same owner-or-
# admin check _resolve_group_access itself uses to decide "owner" access
# elsewhere, applied here explicitly since ping's own membership-only check
# is deliberately looser than what this needs.
def record_dice_roll_broadcast(
    state: ServerState,
    group_id: Optional[str],
    user: Optional[User],
    *,
    share_token: Optional[str] = None,
    label: str = "",
    total: Any = "",
    die_results: Optional[List[Any]] = None,
) -> None:
    if not user:
        raise AuthError("Sign in to broadcast a roll")
    # die_results (the REAL settled per-die values, dice-roll.js's own
    # tryOverlayRoll) is what dice-reveal.js's tiles actually need — trusted
    # client-side data, same "the server verifies SOMETHING was sent, not
    # that it's fair/real" precedent chat.py's own roll
    # handling already establishes; there's no more an independent way to
    # verify a client's own physically-rolled dice-box values server-side
    # than there is for a plain roll's own total.
    cleaned = [entry for entry in (die_results or []) if isinstance(entry, dict) and "sides" in entry and "value" in entry]
    if not cleaned:
        raise AuthError("Real die results are required to broadcast a roll")
    row, _ = _resolve_group_access(state, group_id, user, share_token=share_token)
    if user.tier != "admin" and row["owner_id"] != user.id:
        raise AuthError("Only the GM can broadcast a roll to the table")
    # `by` (the poster's own user id) lets a client skip replaying the
    # animation on the SAME tab that just played it locally already — see
    # game-log.js's own "diceRoll" subscribe handler.
    state.record_dice_roll_broadcast(
        row["id"],
        {
            "label": (label or "").strip()[:200],
            "total": total if isinstance(total, (int, float, str)) else "",
            "dieResults": cleaned[:100],
            "by": user.id,
        },
    )


def record_card_broadcast(
    state: ServerState,
    group_id: Optional[str],
    user: Optional[User],
    *,
    share_token: Optional[str] = None,
    deck_label: str = "",
    back_image: str = "",
    cards: Optional[List[Any]] = None,
) -> None:
    # Mirrors record_dice_roll_broadcast above exactly, same "transient
    # 'animate this now' signal, not a saved record" reasoning (the draw's
    # own group_log entry — deck.js's own handleDraw, type "card" — is the
    # separate, persisted record of what happened).
    if not user:
        raise AuthError("Sign in to broadcast a draw")
    cleaned = [
        entry
        for entry in (cards or [])
        if isinstance(entry, dict) and isinstance(entry.get("label"), str) and entry.get("label").strip()
    ]
    if not cleaned:
        raise AuthError("At least one card is required to broadcast a draw")
    row, _ = _resolve_group_access(state, group_id, user, share_token=share_token)
    if user.tier != "admin" and row["owner_id"] != user.id:
        raise AuthError("Only the GM can broadcast a draw to the table")
    state.record_card_broadcast(
        row["id"],
        {
            "deckLabel": (deck_label or "").strip()[:200],
            "backImage": (back_image or "").strip()[:2000],
            "cards": [
                {
                    "label": entry["label"].strip()[:200],
                    "image": entry.get("image", "").strip()[:2000] if isinstance(entry.get("image"), str) else "",
                }
                for entry in cleaned[:20]
            ],
            "by": user.id,
        },
    )


def record_effect_broadcast(
    state: ServerState,
    group_id: Optional[str],
    user: Optional[User],
    *,
    share_token: Optional[str] = None,
    map_id: str = "",
    element_id: str = "",
) -> None:
    # Mirrors record_dice_roll_broadcast/record_card_broadcast above exactly
    # — same "transient 'do this now' signal, not a saved record" reasoning.
    # Deliberately thin: unlike a roll's dieResults or a draw's cards, there
    # is no payload to validate here beyond "which element" — every viewer
    # with this map open already has the element's own full data (preset,
    # color, everything) from the map itself, so this is purely a pointer.
    if not user:
        raise AuthError("Sign in to trigger an effect")
    map_id = (map_id or "").strip()
    element_id = (element_id or "").strip()
    if not map_id or not element_id:
        raise AuthError("A map and element are required to trigger an effect")
    row, _ = _resolve_group_access(state, group_id, user, share_token=share_token)
    if user.tier != "admin" and row["owner_id"] != user.id:
        raise AuthError("Only the GM can trigger an effect for the table")
    state.record_effect_broadcast(
        row["id"],
        {
            "mapId": map_id[:200],
            "elementId": element_id[:200],
            "by": user.id,
        },
    )


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
                    "type": metadata.get("type") or PLAYER_GROUP_TYPE,
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
        "type": metadata.get("type") or PLAYER_GROUP_TYPE,
        "system_id": metadata.get("systemId"),
        "setting_id": metadata.get("settingId"),
        "template_id": metadata.get("templateId"),
        # Available here (the cheap metadata-column path list_groups uses)
        # because group.json's own metadataFields lists these two — the
        # same reason systemId/settingId above are readable without a full
        # JSON-file fetch. This is the path resolveGroupContext's own
        # listGroups() call actually reads.
        "group_day_index": metadata.get("groupDayIndex"),
        "group_minutes_of_day": metadata.get("groupMinutesOfDay"),
        "created_at": row["created_at"],
        "modified_at": row["modified_at"],
    }


def list_groups(state: ServerState, owner: Optional[User], scope: str = "owned") -> Dict[str, Any]:
    if not owner:
        raise AuthError("Authentication required")
    if scope == "member":
        # Owned groups PLUS any group where a character this user owns has
        # been added as a member — e.g. a GM added the user's own character
        # to their group. This is the account menu's "pick your active
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
            SELECT g.id, g.owner_id, g.title, g.metadata, g.created_at, g.modified_at
            FROM library_items AS g
            WHERE g.kind = 'group'
              AND (g.owner_id = ? OR EXISTS (
                SELECT 1 FROM group_members AS gp
                WHERE gp.group_id = g.id AND gp.content_type = 'player' AND gp.content_id = ?
              ))
            ORDER BY g.modified_at DESC
            """,
            (owner.id, str(owner.id)),
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
    extras_by_group = _group_extras(state, group_ids)
    groups: List[Dict[str, Any]] = []
    for fields in group_fields:
        members = _attach_member_status(members_by_group.get(fields["id"], []), fields["owner_id"])
        share_link = share_links.get(fields["id"])
        groups.append(_serialize_group(fields, members, share_link, extras_by_group.get(fields["id"])))
    return {"groups": groups}


# Party Inventory — every group's starting Group Property, seeded once
# at create_group, upgraded once more in update_group the first time a
# System actually gets assigned (see that function's own comment for why
# create_group itself can never mirror a System — Loom's "New Group"
# dialog only ever collects a name), and backfilled onto every
# pre-existing group by storage.py's own migration. No hardcoded
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
    if normalized_type == PLAYER_GROUP_TYPE:
        from . import chat

        chat.ensure_default_chat(state, group_id, owner.id)
    row = _load_group_row(state, group_id)
    members: List[Dict[str, Any]] = []
    return _serialize_group(row, _attach_member_status(members, owner.id), None, _group_extras(state, [group_id])[group_id])


def update_group(
    state: ServerState,
    owner: Optional[User],
    group_id: str,
    name: Optional[str] = None,
    system_id: Optional[str] = None,
    setting_id: Optional[str] = None,
    template_id: Optional[str] = None,
    properties: Optional[List[Dict[str, Any]]] = None,
    group_day_index: Optional[int] = None,
    group_minutes_of_day: Optional[int] = None,
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
        # Blank clears it (a group that stops declaring a System falls
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
        # Same "blank clears it" convention — the group's own "Party
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
    # day index: the group's own start epoch), not strings, so the only
    # signal available is "was this argument passed at all" — same as
    # every other field above, just without a string to strip.
    if group_day_index is not None:
        row["group_day_index"] = group_day_index
        updated = True
    if group_minutes_of_day is not None:
        row["group_minutes_of_day"] = group_minutes_of_day
        updated = True
    # The Party Inventory property starts as a generic placeholder (no
    # System exists yet at create_group time) — the first time a GM
    # actually assigns a System to this group, upgrade it to mirror
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
            "groupDayIndex": row["group_day_index"],
            "groupMinutesOfDay": row["group_minutes_of_day"],
            "properties": row["properties"],
            "propertyValues": row["property_values"],
        }
        storage.save_item(state, "group", group_id, payload, owner)
        row = _load_group_row(state, group_id)
    members = _attach_member_status(_fetch_group_members(state, group_id), row["owner_id"])
    share_link = get_share_link(state, "group", group_id)
    return _serialize_group(row, members, share_link, _group_extras(state, [group_id])[group_id])


def delete_group(state: ServerState, owner: Optional[User], group_id: str) -> None:
    from . import storage

    _require_owner(state, group_id, owner)
    # Clears the group's own library_items row + JSON file, and (same as
    # every other kind) its shares/share_links rows. group_members/
    # group_members and the chat tables have no FK-cascade to rely on (this
    # codebase never enables SQLite FK enforcement, so the old `groups`
    # table's own ON DELETE CASCADE never actually fired either), so they're
    # cleaned up explicitly here, matching delete_item's own explicit-cleanup
    # style. Archive pages (journal records) are user content and stay.
    from . import chat

    storage.delete_item(state, "group", group_id, owner)
    state.db.execute("DELETE FROM group_members WHERE group_id = ?", (group_id,))
    chat.delete_group_chat(state, group_id)
    from . import sessions

    sessions.delete_group_sessions(state, group_id)
    from . import listings

    listings.delete_for_group(state, group_id)
    state.db.commit()


def _owner_of_character(state: ServerState, character_id: str) -> Optional[int]:
    row = state.db.execute(
        "SELECT owner_id FROM library_items WHERE kind = 'character' AND id = ?", (character_id,)
    ).fetchone()
    return row["owner_id"] if row else None


def _owner_has_active(state: ServerState, group_id: str, owner_id: Optional[int], *, excluding: str = "") -> bool:
    if owner_id is None:
        return False
    row = state.db.execute(
        """
        SELECT 1 FROM group_members AS gm
        JOIN library_items AS li ON li.kind = 'character' AND li.id = gm.content_id
        WHERE gm.group_id = ? AND gm.content_type = 'character' AND li.owner_id = ?
          AND COALESCE(gm.active, 1) != 0 AND gm.content_id != ?
        LIMIT 1
        """,
        (group_id, owner_id, excluding),
    ).fetchone()
    return bool(row)


def _default_active_for_new_member(state: ServerState, group_id: str, character_id: str) -> int:
    """A newly rostered character is the player's active one unless that player
    already has another active character in this group."""
    return 0 if _owner_has_active(state, group_id, _owner_of_character(state, character_id), excluding=character_id) else 1


def _ensure_one_active(state: ServerState, group_id: str, owner_ids: Iterable[int]) -> None:
    """After a roster change, a player who still has characters here but no
    active one gets their earliest-added character made active."""
    for owner_id in owner_ids:
        if _owner_has_active(state, group_id, owner_id):
            continue
        row = state.db.execute(
            """
            SELECT gm.content_id FROM group_members AS gm
            JOIN library_items AS li ON li.kind = 'character' AND li.id = gm.content_id
            WHERE gm.group_id = ? AND gm.content_type = 'character' AND li.owner_id = ?
            ORDER BY gm.added_at, gm.content_id LIMIT 1
            """,
            (group_id, owner_id),
        ).fetchone()
        if row:
            state.db.execute(
                "UPDATE group_members SET active = 1 WHERE group_id = ? AND content_type = 'character' AND content_id = ?",
                (group_id, row["content_id"]),
            )


def set_member_active(
    state: ServerState, user: Optional[User], group_id: str, character_id: str, active: bool
) -> Dict[str, Any]:
    """Marks one rostered character active or inactive. The group's GM (or an
    admin) can change any of them; a player can change their own. Activating a
    character deactivates that player's other characters in the group."""
    if not user:
        raise AuthError("Authentication required")
    row = _load_group_row(state, group_id)
    if not row:
        raise AuthError("Group not found")
    member = state.db.execute(
        "SELECT 1 FROM group_members WHERE group_id = ? AND content_type = 'character' AND content_id = ?",
        (group_id, character_id),
    ).fetchone()
    if not member:
        raise AuthError("That character isn't in this group")
    character_owner = _owner_of_character(state, character_id)
    is_gm = user.tier == "admin" or row["owner_id"] == user.id
    if not (is_gm or character_owner == user.id):
        raise AuthError("You can only change your own characters")
    if active and character_owner is not None:
        state.db.execute(
            """
            UPDATE group_members SET active = 0
            WHERE group_id = ? AND content_type = 'character' AND content_id IN (
                SELECT gm.content_id FROM group_members AS gm
                JOIN library_items AS li ON li.kind = 'character' AND li.id = gm.content_id
                WHERE gm.group_id = ? AND gm.content_type = 'character' AND li.owner_id = ?
            )
            """,
            (group_id, group_id, character_owner),
        )
    state.db.execute(
        "UPDATE group_members SET active = ? WHERE group_id = ? AND content_type = 'character' AND content_id = ?",
        (1 if active else 0, group_id, character_id),
    )
    state.db.execute(
        "UPDATE library_items SET modified_at = ? WHERE kind = 'group' AND id = ?",
        (datetime.utcnow().isoformat(), group_id),
    )
    state.db.commit()
    from . import sessions

    sessions.on_roster_changed(state, group_id)
    refreshed = _load_group_row(state, group_id)
    members = _attach_member_status(_fetch_group_members(state, group_id), refreshed["owner_id"])
    return _serialize_group(refreshed, members, get_share_link(state, "group", group_id), _group_extras(state, [group_id])[group_id])


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
        # player group's whole point is to hold the PLAYERS' characters,
        # which the GM (this group's owner) doesn't own. _require_owner
        # above already confirmed the caller is this group's owner (or an
        # admin); that's the actual authorization boundary for "who may
        # decide which characters belong to this group," not who owns each
        # individual character.
    # A diff, not delete-and-reinsert: a kept character keeps its added_at and
    # its active flag, and only genuinely new characters get a fresh row.
    current = {
        row["content_id"]
        for row in state.db.execute(
            "SELECT content_id FROM group_members WHERE group_id = ? AND content_type = 'character'", (group_id,)
        )
    }
    wanted = set(normalized_ids)
    removed_owner_ids = set()
    for character_id in current - wanted:
        owner_row = state.db.execute(
            "SELECT owner_id FROM library_items WHERE kind = 'character' AND id = ?", (character_id,)
        ).fetchone()
        if owner_row and owner_row["owner_id"] is not None:
            removed_owner_ids.add(owner_row["owner_id"])
        state.db.execute(
            "DELETE FROM group_members WHERE group_id = ? AND content_type = 'character' AND content_id = ?",
            (group_id, character_id),
        )
    timestamp = datetime.utcnow().isoformat()
    for character_id in normalized_ids:
        if character_id in current:
            continue
        state.db.execute(
            """
            INSERT INTO group_members (group_id, content_type, content_id, added_at, active)
            VALUES (?, 'character', ?, ?, ?)
            """,
            (group_id, character_id, timestamp, _default_active_for_new_member(state, group_id, character_id)),
        )
        ensure_player(state, group_id, _owner_of_character(state, character_id))
    _ensure_one_active(state, group_id, removed_owner_ids)
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
    from . import sessions

    sessions.on_roster_changed(state, group_id)
    refreshed = _load_group_row(state, group_id)
    members = _attach_member_status(_fetch_group_members(state, group_id), refreshed["owner_id"])
    share_link = get_share_link(state, "group", group_id)
    return _serialize_group(refreshed, members, share_link, _group_extras(state, [group_id])[group_id])


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


def get_group_properties(state: ServerState, user: Optional[User], group_id: str) -> Dict[str, Any]:
    """Read-side counterpart to update_group_property_value above, for a
    caller with no share token — the generic GET /content/group/{id} route
    (storage.get_item) only ever grants a non-owner reader via a share
    token or Character-linked share, which a genuine group MEMBER
    browsing their own character in Workbench simply doesn't have.
    Confirmed real gap this fixes: mountGroupPropertyContext
    (workbench-character-view.js) silently 401'd for every real player,
    every time, since it had no other way to read the Party
    Wallet/Inventory schema+values a GM might have put on the group; a
    second caller (loadGroupPartyView, same file) hit the identical 401
    just to read templateId, surfaced there as a visible "Unable to load
    this group" toast for a real member of a group they'd just
    picked from their own Character Selection dropdown.

    Same owner-or-member gate update_group_property_value already
    establishes for WRITES, mirrored for reads: the owner/admin gets the
    full properties/propertyValues untouched; a mere member gets ONLY the
    entries whose schema marks `public: true` — the exact same flag that
    already gates whether they could ever WRITE that property, so nothing
    a member can read here is data they couldn't already have asked the
    GM to hand them via a property write round-trip. A GM-private property
    (a secret tracker stored as a property, say) never reaches a member's
    client at all, unlike a "return everything, restrict editing only"
    shape would.

    templateId/systemId/settingId ride along unconditionally, for EVERY
    caller regardless of owner/member — these are the same non-sensitive
    "what kind of group is this" facts list_groups already hands any
    member with zero filtering (_access_row_to_group_fields), not Property
    data, so the public-only gate above never applied to them anyway.
    """
    if not user:
        raise AuthError("Authentication required")
    row = _load_group_row(state, group_id)
    if not row:
        raise AuthError("Group not found")
    is_owner_or_admin = user.tier == "admin" or row["owner_id"] == user.id
    schema = row["properties"] if isinstance(row["properties"], list) else []
    values = row["property_values"] if isinstance(row["property_values"], dict) else {}
    metadata = {
        "templateId": row["template_id"],
        "systemId": row["system_id"],
        "settingId": row["setting_id"],
    }
    if is_owner_or_admin:
        return {"properties": schema, "propertyValues": values, **metadata}
    if not user_can_access_group(state, group_id, user):
        raise AuthError("Access denied")
    public_schema = [p for p in schema if isinstance(p, dict) and p.get("public")]
    public_keys = {p.get("key") for p in public_schema}
    public_values = {key: value for key, value in values.items() if key in public_keys}
    return {"properties": public_schema, "propertyValues": public_values, **metadata}


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
            "group_day_index": row["group_day_index"],
            "group_minutes_of_day": row["group_minutes_of_day"],
        },
        "members": members,
        "available": available,
    }


def _claim_character(
    state: ServerState, group_id: str, group_row: Dict[str, Any], character_id: str, user: User
) -> Dict[str, Any]:
    """Moves an unclaimed roster character (still owned by the GM) to `user` and
    makes them a player. Shared by the share-link claim and the member claim."""
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
    ensure_player(state, group_id, user.id)
    # A player can have only one active character per group: the claimed one
    # starts active only if they have no other active one here.
    state.db.execute(
        "UPDATE group_members SET active = ? WHERE group_id = ? AND content_type = 'character' AND content_id = ?",
        (0 if _owner_has_active(state, group_id, user.id, excluding=character_id) else 1, group_id, character_id),
    )
    state.db.commit()
    from . import sessions

    sessions.on_roster_changed(state, group_id)
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
    result = _claim_character(state, group_id, group_row, character_id, user)
    touch_share_link(state, token)
    return result


def _require_player(state: ServerState, user: Optional[User], group_id: str) -> Dict[str, Any]:
    if not user:
        raise AuthError("Authentication required")
    row = _load_group_access_row(state, group_id)
    if not row:
        raise AuthError("Group not found")
    if row["owner_id"] == user.id or not _is_player(state.db, group_id, user.id):
        raise AuthError("Only a player of this group can do that")
    return row


def claim_roster_character(state: ServerState, user: Optional[User], group_id: str, character_id: str) -> Dict[str, Any]:
    """A player claims one of the GM's unclaimed characters without a share link."""
    row = _require_player(state, user, group_id)
    return _claim_character(state, group_id, row, character_id, user)


def add_own_character(state: ServerState, user: Optional[User], group_id: str, character_id: str) -> Dict[str, Any]:
    """A player puts a character they own on the roster (the 'create a new one'
    half of joining)."""
    _require_player(state, user, group_id)
    owned = state.db.execute(
        "SELECT 1 FROM library_items WHERE kind = 'character' AND id = ? AND owner_id = ?", (character_id, user.id)
    ).fetchone()
    if not owned:
        raise AuthError("You can only add a character you own")
    already = state.db.execute(
        "SELECT 1 FROM group_members WHERE group_id = ? AND content_type = 'character' AND content_id = ?",
        (group_id, character_id),
    ).fetchone()
    if not already:
        state.db.execute(
            """
            INSERT INTO group_members (group_id, content_type, content_id, added_at, active)
            VALUES (?, 'character', ?, ?, ?)
            """,
            (group_id, character_id, datetime.utcnow().isoformat(), _default_active_for_new_member(state, group_id, character_id)),
        )
        state.db.execute(
            "UPDATE library_items SET modified_at = ? WHERE kind = 'group' AND id = ?",
            (datetime.utcnow().isoformat(), group_id),
        )
    state.db.commit()
    from . import sessions

    sessions.on_roster_changed(state, group_id)
    return {"ok": True}


def _drop_player(state: ServerState, group_id: str, user_id: int) -> None:
    """Removes the player row and takes that player's characters off the roster."""
    state.db.execute(
        """
        DELETE FROM group_members
        WHERE group_id = ? AND content_type = 'character' AND content_id IN (
            SELECT li.id FROM library_items AS li WHERE li.kind = 'character' AND li.owner_id = ?
        )
        """,
        (group_id, user_id),
    )
    state.db.execute(
        "DELETE FROM group_members WHERE group_id = ? AND content_type = 'player' AND content_id = ?",
        (group_id, str(user_id)),
    )
    state.db.execute(
        "UPDATE library_items SET modified_at = ? WHERE kind = 'group' AND id = ?",
        (datetime.utcnow().isoformat(), group_id),
    )


def leave_group(state: ServerState, user: Optional[User], group_id: str) -> Dict[str, Any]:
    """A player leaves on their own."""
    _require_player(state, user, group_id)
    from . import signals

    signals.on_player_left(state, group_id, user.id, datetime.utcnow())
    _drop_player(state, group_id, user.id)
    state.db.commit()
    return {"ok": True}


def add_player(state: ServerState, owner: Optional[User], group_id: str, username: str) -> Dict[str, Any]:
    """The GM (or an admin) adds a player by username. The player is told in their Inbox and can leave."""
    row = _require_owner(state, group_id, owner)
    target = state.db.execute(
        "SELECT id, username FROM users WHERE username = ? AND is_active = 1", (str(username or "").strip(),)
    ).fetchone()
    if not target:
        raise AuthError("No account has that username")
    if target["id"] == row["owner_id"]:
        raise AuthError("That person is the GM of this group")
    if _is_player(state.db, group_id, target["id"]):
        raise AuthError(f"{target['username']} is already a player of this group")
    ensure_player(state, group_id, target["id"])
    state.db.execute(
        "UPDATE library_items SET modified_at = ? WHERE kind = 'group' AND id = ?",
        (datetime.utcnow().isoformat(), group_id),
    )
    state.db.commit()
    # Local import: chat.py imports this module.
    from . import chat

    try:
        chat.send_direct_message(
            state,
            group_id,
            owner,
            recipient_ids=[target["id"]],
            body=(
                f'You were added to "{row["name"]}" by {owner.username}. '
                "You can leave the group any time from Account Settings, under Groups I play in."
            ),
        )
    except AuthError:
        pass  # the player is added either way; the notice is a courtesy
    return {"ok": True, "player": {"user_id": target["id"], "username": target["username"]}}


def addable_players(state: ServerState, owner: Optional[User], group_id: str) -> Dict[str, Any]:
    """Active accounts that are neither the GM nor already players, for the Add player picker."""
    row = _require_owner(state, group_id, owner)
    rows = state.db.execute(
        """
        SELECT username FROM users
        WHERE is_active = 1 AND id IS NOT ?
          AND CAST(id AS TEXT) NOT IN (
              SELECT content_id FROM group_members WHERE group_id = ? AND content_type = 'player'
          )
        ORDER BY username COLLATE NOCASE
        """,
        (row["owner_id"], group_id),
    ).fetchall()
    return {"players": [item["username"] for item in rows]}


def addable_characters(state: ServerState, owner: Optional[User], group_id: str) -> Dict[str, Any]:
    """Characters that belong to the GM or to a player already in the group and are not on the roster yet."""
    row = _require_owner(state, group_id, owner)
    owner_ids = {row["owner_id"]} if row["owner_id"] is not None else set()
    for member in state.db.execute(
        "SELECT content_id FROM group_members WHERE group_id = ? AND content_type = 'player'", (group_id,)
    ):
        owner_ids.add(int(member["content_id"]))
    if not owner_ids:
        return {"characters": []}
    marks = ",".join("?" for _ in owner_ids)
    rows = state.db.execute(
        f"""
        SELECT li.id, li.title, li.owner_id, li.metadata, u.username
        FROM library_items AS li LEFT JOIN users AS u ON u.id = li.owner_id
        WHERE li.kind = 'character' AND li.owner_id IN ({marks})
          AND li.id NOT IN (
              SELECT content_id FROM group_members WHERE group_id = ? AND content_type = 'character'
          )
        ORDER BY u.username COLLATE NOCASE, li.title COLLATE NOCASE
        """,
        [*owner_ids, group_id],
    ).fetchall()
    characters = []
    for item in rows:
        try:
            metadata = json.loads(item["metadata"]) if item["metadata"] else {}
        except (TypeError, ValueError):
            metadata = {}
        system_ids = metadata.get("systemIds") if isinstance(metadata.get("systemIds"), list) else []
        if not system_ids and metadata.get("system"):
            system_ids = [metadata["system"]]
        characters.append(
            {
                "id": item["id"],
                "title": item["title"] or item["id"],
                "ownerId": item["owner_id"],
                "owner": item["username"] or "",
                "systemIds": system_ids,
            }
        )
    return {"characters": characters}


def remove_player(state: ServerState, owner: Optional[User], group_id: str, user_id: int) -> Dict[str, Any]:
    """The GM (or an admin) removes a player."""
    _require_owner(state, group_id, owner)
    if not _is_player(state.db, group_id, user_id):
        raise AuthError("That person isn't a player of this group")
    _drop_player(state, group_id, user_id)
    state.db.commit()
    return {"ok": True}


def ensure_group_share_link(state: ServerState, owner: Optional[User], group_id: str) -> Dict[str, Any]:
    _require_owner(state, group_id, owner)
    return create_share_link(state, "group", group_id)


def revoke_group_share_link(state: ServerState, owner: Optional[User], group_id: str) -> None:
    _require_owner(state, group_id, owner)
    revoke_share_link(state, "group", group_id)


def get_group_share_link(state: ServerState, owner: Optional[User], group_id: str) -> Optional[Dict[str, Any]]:
    _require_owner(state, group_id, owner)
    return get_share_link(state, "group", group_id)
