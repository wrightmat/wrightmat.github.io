from __future__ import annotations

import json
import secrets
from datetime import datetime
from typing import Any, Dict, List, Optional

from .auth import AuthError, User
from .shared_lists import rename_stored_tag, stored_tags
from .groups import _is_player, _require_owner
from .state import ServerState

# A recruitment listing advertises one session or a whole campaign of a group.
# Browsing is open to everyone; who can see the GM's and members' trust
# profiles is decided per person by profiles.can_view_history.
TARGETS = ("session", "campaign")
STATUSES = ("open", "closed", "filled")
TAG_LIMIT = 20
TAG_LENGTH = 40


def _now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat()


def _community_file(state: ServerState, name: str) -> Any:
    path = state.read_path("common", "data", f"community-{name}.json")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise AuthError(f"{label} must be a whole number of at least 1")
    return value


def _tags(value: Any, label: str) -> List[str]:
    if not isinstance(value, list) or len(value) > TAG_LIMIT:
        raise AuthError(f"{label} must be a list of up to {TAG_LIMIT} tags")
    cleaned: List[str] = []
    for tag in value:
        text = str(tag or "").strip()[:TAG_LENGTH]
        if text and text.lower() not in {t.lower() for t in cleaned}:
            cleaned.append(text)
    return cleaned


def _option(state: ServerState, data: Dict[str, Any], key: str, group: str) -> Optional[str]:
    value = data.get(key)
    if value in (None, ""):
        return None
    if value not in {entry["id"] for entry in _community_file(state, "options").get(group, [])}:
        raise AuthError(f"{key} isn't one of the available choices")
    return value


def _gm_has_public_profile(state: ServerState, user_id: int) -> bool:
    row = state.db.execute(
        "SELECT json_extract(settings, '$.profile.public') AS public FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return bool(row and row["public"])


def _clean(state: ServerState, group_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise AuthError("Listing details are required")
    target = data.get("targetKind")
    if target not in TARGETS:
        raise AuthError("A listing advertises a session or a campaign")
    session_id = campaign_id = None
    if target == "session":
        session_id = str(data.get("sessionId") or "")
        series = state.db.execute(
            "SELECT ended_at FROM group_sessions WHERE id = ? AND group_id = ?", (session_id, group_id)
        ).fetchone()
        if not series:
            raise AuthError("Choose one of this group's sessions")
        if series["ended_at"]:
            raise AuthError("That session has ended")
    else:
        campaign_id = str(data.get("campaignId") or "")
        campaign = state.db.execute(
            "SELECT status FROM group_members WHERE group_id = ? AND content_type = 'campaign' AND content_id = ?",
            (group_id, campaign_id),
        ).fetchone()
        if not campaign:
            raise AuthError("Choose one of this group's campaigns")
        if campaign["status"] == "completed":
            raise AuthError("That campaign is completed")
    system_id = str(data.get("systemId") or "").strip() or None
    system_name = str(data.get("systemName") or "").strip()[:120] or None
    if not (system_id or system_name):
        raise AuthError("Name the game system")
    scales_file = _community_file(state, "scales")
    scale_ids = {scale["id"] for scale in scales_file.get("scales", [])}
    points = scales_file.get("points", 5)
    scales = data.get("scales") or {}
    if not isinstance(scales, dict):
        raise AuthError("Scales must be an object")
    cleaned_scales: Dict[str, int] = {}
    for scale_id, value in scales.items():
        if value is None:
            continue
        if scale_id not in scale_ids or isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= points:
            raise AuthError(f"Scale {scale_id} must be a whole number from 1 to {points}")
        cleaned_scales[scale_id] = value
    tool_ids = {item["id"] for item in _community_file(state, "safety-tools").get("items", [])}
    tools = data.get("safetyTools") or []
    if not isinstance(tools, list) or any(tool not in tool_ids for tool in tools):
        raise AuthError("Safety tools has an unknown entry")
    return {
        "target_kind": target,
        "session_id": session_id,
        "campaign_id": campaign_id,
        "system_id": system_id,
        "system_name": system_name,
        "seats_offered": _positive_int(data.get("seatsOffered"), "Seats offered"),
        "scales": json.dumps(cleaned_scales),
        "tags": json.dumps(_tags(data.get("tags") or [], "Tags")),
        "safety_tools": json.dumps(sorted(set(tools))),
        "session_length": _option(state, data, "sessionLength", "sessionLength"),
        "age_range": _option(state, data, "ageRange", "ageRange"),
        "platform": _option(state, data, "platform", "platform"),
        "auto_decline_days": _positive_int(data.get("autoDeclineDays"), "Auto-decline period"),
        "description": str(data.get("description") or "").strip()[:4000],
    }


def accepted_count(state: ServerState, listing_id: str) -> int:
    return state.db.execute(
        "SELECT COUNT(*) FROM applications WHERE listing_id = ? AND status = 'accepted'", (listing_id,)
    ).fetchone()[0]


def _load(state: ServerState, listing_id: str) -> Any:
    row = state.db.execute("SELECT * FROM listings WHERE id = ?", (listing_id,)).fetchone()
    if not row:
        raise AuthError("Listing not found")
    return row


def create_listing(state: ServerState, user: Optional[User], group_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    group = _require_owner(state, group_id, user)
    if not _gm_has_public_profile(state, group["owner_id"]):
        raise AuthError("A listing shows the GM's trust profile, so the GM needs a public profile first")
    cleaned = _clean(state, group_id, data)
    listing_id = f"lst_{secrets.token_hex(6)}"
    now = _now()
    state.db.execute(
        """
        INSERT INTO listings
            (id, group_id, owner_id, target_kind, session_id, campaign_id, status, system_id, system_name, seats_offered,
             scales, tags, safety_tools, session_length, age_range, platform, auto_decline_days,
             description, created_at, updated_at)
        VALUES (:id, :group_id, :owner_id, :target_kind, :session_id, :campaign_id, 'open', :system_id, :system_name,
                :seats_offered, :scales, :tags, :safety_tools, :session_length, :age_range, :platform,
                :auto_decline_days, :description, :now, :now)
        """,
        {**cleaned, "id": listing_id, "group_id": group_id, "owner_id": group["owner_id"], "now": now},
    )
    state.db.commit()
    return get_listing(state, user, listing_id)


def update_listing(state: ServerState, user: Optional[User], listing_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    row = _load(state, listing_id)
    _require_owner(state, row["group_id"], user)
    status = data.get("status")
    if status is not None and status not in ("open", "closed"):
        raise AuthError("A listing is open or closed")
    cleaned = _clean(state, row["group_id"], data)
    if cleaned["seats_offered"] < accepted_count(state, listing_id):
        raise AuthError("Seats offered can't be below the players already accepted")
    assignments = ", ".join(f"{name} = :{name}" for name in cleaned)
    state.db.execute(
        f"UPDATE listings SET {assignments}, status = :status, updated_at = :now WHERE id = :id",
        {**cleaned, "status": status or row["status"], "now": _now(), "id": listing_id},
    )
    refresh_status(state, listing_id)
    state.db.commit()
    return get_listing(state, user, listing_id)


def delete_listing(state: ServerState, user: Optional[User], listing_id: str) -> Dict[str, Any]:
    row = _load(state, listing_id)
    _require_owner(state, row["group_id"], user)
    state.db.execute("DELETE FROM listings WHERE id = ?", (listing_id,))
    state.db.commit()
    return {"ok": True}


def refresh_status(state: ServerState, listing_id: str) -> None:
    """A listing closes itself when every seat is taken and reopens if one frees up."""
    row = _load(state, listing_id)
    full = accepted_count(state, listing_id) >= row["seats_offered"]
    if full and row["status"] == "open":
        state.db.execute("UPDATE listings SET status = 'filled', updated_at = ? WHERE id = ?", (_now(), listing_id))
    elif not full and row["status"] == "filled":
        state.db.execute("UPDATE listings SET status = 'open', updated_at = ? WHERE id = ?", (_now(), listing_id))


def delete_for_group(state: ServerState, group_id: str) -> None:
    state.db.execute("DELETE FROM applications WHERE group_id = ?", (group_id,))
    state.db.execute("DELETE FROM listings WHERE group_id = ?", (group_id,))


# --- Reading ----------------------------------------------------------------------------------


def _json(value: Optional[str], fallback: Any) -> Any:
    try:
        return json.loads(value) if value else fallback
    except (TypeError, ValueError):
        return fallback


def _schedule(state: ServerState, row: Any) -> List[Dict[str, Any]]:
    from . import sessions

    if row["target_kind"] == "session":
        series_rows = state.db.execute("SELECT * FROM group_sessions WHERE id = ?", (row["session_id"],)).fetchall()
    else:
        series_rows = state.db.execute(
            "SELECT * FROM group_sessions WHERE campaign_id = ? AND ended_at IS NULL ORDER BY start_at", (row["campaign_id"],)
        ).fetchall()
    now = sessions.utcnow()
    return [sessions._serialize_series(series, sessions._next_slot(series, now)) for series in series_rows]


def _serialize(state: ServerState, row: Any, viewer: Optional[User]) -> Dict[str, Any]:
    owner = state.db.execute("SELECT id, username FROM users WHERE id = ?", (row["owner_id"],)).fetchone()
    group = state.db.execute(
        "SELECT title FROM library_items WHERE kind = 'group' AND id = ?", (row["group_id"],)
    ).fetchone()
    campaign_name = None
    if row["campaign_id"]:
        found = state.db.execute(
            "SELECT label FROM group_members WHERE group_id = ? AND content_type = 'campaign' AND content_id = ?",
            (row["group_id"], row["campaign_id"]),
        ).fetchone()
        campaign_name = found["label"] if found else None
    taken = accepted_count(state, row["id"])
    members: List[Dict[str, Any]] = []
    if viewer:
        for member in state.db.execute(
            """
            SELECT u.id, u.username FROM group_members AS gm JOIN users AS u ON u.id = CAST(gm.content_id AS INTEGER)
            WHERE gm.group_id = ? AND gm.content_type = 'player' ORDER BY u.username COLLATE NOCASE
            """,
            (row["group_id"],),
        ):
            members.append({"userId": member["id"], "username": member["username"]})
    return {
        "id": row["id"],
        "groupId": row["group_id"],
        "groupName": (group["title"] if group else None) or "",
        "gm": {"userId": owner["id"], "username": owner["username"]} if owner else None,
        "targetKind": row["target_kind"],
        "sessionId": row["session_id"],
        "campaignId": row["campaign_id"],
        "campaignName": campaign_name,
        "status": row["status"],
        "systemId": row["system_id"],
        "systemName": row["system_name"],
        "seatsOffered": row["seats_offered"],
        "openSeats": max(0, row["seats_offered"] - taken),
        "scales": _json(row["scales"], {}),
        "tags": _json(row["tags"], []),
        "safetyTools": _json(row["safety_tools"], []),
        "sessionLength": row["session_length"],
        "ageRange": row["age_range"],
        "platform": row["platform"],
        "autoDeclineDays": row["auto_decline_days"],
        "description": row["description"] or "",
        "schedule": _schedule(state, row),
        "members": members,
        "isMember": bool(viewer and _is_player(state.db, row["group_id"], viewer.id)),
        "createdAt": row["created_at"],
    }


def get_listing(state: ServerState, viewer: Optional[User], listing_id: str) -> Dict[str, Any]:
    return _serialize(state, _load(state, listing_id), viewer)


def list_listings(state: ServerState, viewer: Optional[User], filters: Dict[str, Any]) -> Dict[str, Any]:
    """Open listings by default; `groupId` lists one group's (any status, GM only)."""
    clauses: List[str] = []
    params: List[Any] = []
    if filters.get("groupId"):
        _require_owner(state, filters["groupId"], viewer)
        clauses.append("group_id = ?")
        params.append(filters["groupId"])
    else:
        clauses.append("status = 'open'")
    for key, column in (("systemId", "system_id"), ("platform", "platform"), ("sessionLength", "session_length"),
                        ("ageRange", "age_range"), ("targetKind", "target_kind")):
        if filters.get(key):
            clauses.append(f"{column} = ?")
            params.append(filters[key])
    rows = state.db.execute(
        f"SELECT * FROM listings WHERE {' AND '.join(clauses)} ORDER BY created_at DESC LIMIT 200", params
    ).fetchall()
    items = [_serialize(state, row, viewer) for row in rows]
    # A signed-in viewer doesn't see their own listings or those of groups they're in, unless they ask (`all`).
    if viewer and not filters.get("all") and not filters.get("groupId"):
        items = [i for i in items if not i["isMember"] and (i["gm"] or {}).get("userId") != viewer.id]
    tag = str(filters.get("tag") or "").strip().lower()
    if tag:
        items = [i for i in items if tag in {t.lower() for t in i["tags"]}]
    return {"listings": items}


# --- Tag vocabulary and admin cleanup --------------------------------------------------------


def tag_usage(state: ServerState) -> List[Dict[str, Any]]:
    """The curated tags first, in their own order, then any tag a listing uses that isn't on the list;
    each with how many listings carry it."""
    counts: Dict[str, int] = {}
    for row in state.db.execute("SELECT tags FROM listings"):
        for tag in _json(row["tags"], []):
            counts[tag] = counts.get(tag, 0) + 1
    lowered = {tag.lower(): n for tag, n in counts.items()}
    stored = stored_tags(state)
    stored_names = {entry["name"].lower() for entry in stored}
    usage = [{"id": entry["id"], "tag": entry["name"], "count": lowered.get(entry["name"].lower(), 0)} for entry in stored]
    usage += [
        {"tag": tag, "count": n} for tag, n in sorted(counts.items(), key=lambda kv: kv[0].lower()) if tag.lower() not in stored_names
    ]
    return usage


def rewrite_tag(state: ServerState, user: Optional[User], old: Any, new: Any) -> Dict[str, Any]:
    """Renames a tag (or merges it into an existing one); a blank `new` removes it."""
    if not user or user.tier != "admin":
        raise AuthError("Admin only")
    if not isinstance(old, str) or not old.strip():
        raise AuthError("Choose a tag to change")
    replacement = str(new or "").strip()[:TAG_LENGTH]
    rename_stored_tag(state, old, replacement)
    changed = 0
    for row in state.db.execute("SELECT id, tags FROM listings").fetchall():
        tags = _json(row["tags"], [])
        if old not in tags:
            continue
        rewritten: List[str] = []
        for tag in tags:
            tag = replacement if tag == old else tag
            if tag and tag.lower() not in {t.lower() for t in rewritten}:
                rewritten.append(tag)
        state.db.execute("UPDATE listings SET tags = ? WHERE id = ?", (json.dumps(rewritten), row["id"]))
        changed += 1
    state.db.commit()
    return {"changed": changed, "usage": tag_usage(state)}
