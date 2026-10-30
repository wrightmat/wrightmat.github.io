from __future__ import annotations

import secrets
from datetime import datetime
from typing import Any, Dict, List, Optional

from .auth import AuthError, User
from .groups import _require_owner, _resolve_group_access
from .state import ServerState

# A campaign is a named run of sessions inside a player group. It is stored as
# a `group_members` row (content_type 'campaign': content_id = its id, label =
# its name, status below) and sessions point at it through
# `group_sessions.campaign_id`.
STATUSES = ("active", "on_hiatus", "completed")
NAME_LIMIT = 120


def _clean_name(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text:
        raise AuthError("A campaign needs a name")
    return text[:NAME_LIMIT]


def _clean_status(raw: Any) -> str:
    if raw not in STATUSES:
        raise AuthError("Status must be active, on_hiatus or completed")
    return raw


def _serialize(row: Any) -> Dict[str, Any]:
    return {"id": row["content_id"], "name": row["label"] or "", "status": row["status"], "created_at": row["added_at"]}


def _row(state: ServerState, group_id: str, campaign_id: str) -> Any:
    row = state.db.execute(
        "SELECT * FROM group_members WHERE group_id = ? AND content_type = 'campaign' AND content_id = ?",
        (group_id, campaign_id),
    ).fetchone()
    if not row:
        raise AuthError("Campaign not found")
    return row


def list_campaigns(state: ServerState, group_id: Optional[str], user: Optional[User]) -> Dict[str, Any]:
    group, _ = _resolve_group_access(state, group_id, user)
    rows = state.db.execute(
        "SELECT * FROM group_members WHERE group_id = ? AND content_type = 'campaign' ORDER BY added_at, content_id",
        (group["id"],),
    ).fetchall()
    return {"campaigns": [_serialize(row) for row in rows]}


def create_campaign(state: ServerState, user: Optional[User], group_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    _require_owner(state, group_id, user)
    name = _clean_name(data.get("name"))
    status = _clean_status(data.get("status"))
    campaign_id = f"cmp_{secrets.token_hex(6)}"
    state.db.execute(
        """
        INSERT INTO group_members (group_id, content_type, content_id, added_at, label, status)
        VALUES (?, 'campaign', ?, ?, ?, ?)
        """,
        (group_id, campaign_id, datetime.utcnow().isoformat(), name, status),
    )
    state.db.commit()
    return _serialize(_row(state, group_id, campaign_id))


def reorder_campaigns(state: ServerState, user: Optional[User], group_id: str, ids: Any) -> Dict[str, Any]:
    """Campaigns are listed by when they were added, so a new order hands the same
    timestamps out again in the new sequence; anything not named keeps its place at the end."""
    _require_owner(state, group_id, user)
    if not isinstance(ids, list):
        raise AuthError("A list of campaign ids is required")
    rows = state.db.execute(
        "SELECT content_id, added_at FROM group_members WHERE group_id = ? AND content_type = 'campaign' ORDER BY added_at, content_id",
        (group_id,),
    ).fetchall()
    stamps = [row["added_at"] for row in rows]
    rank = {campaign_id: index for index, campaign_id in enumerate(ids)}
    ordered = sorted((row["content_id"] for row in rows), key=lambda campaign_id: rank.get(campaign_id, len(rank)))
    for campaign_id, stamp in zip(ordered, stamps):
        state.db.execute(
            "UPDATE group_members SET added_at = ? WHERE group_id = ? AND content_type = 'campaign' AND content_id = ?",
            (stamp, group_id, campaign_id),
        )
    state.db.commit()
    return list_campaigns(state, group_id, user)


def update_campaign(state: ServerState, user: Optional[User], group_id: str, campaign_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    _require_owner(state, group_id, user)
    _row(state, group_id, campaign_id)
    if "name" in data:
        state.db.execute(
            "UPDATE group_members SET label = ? WHERE group_id = ? AND content_type = 'campaign' AND content_id = ?",
            (_clean_name(data.get("name")), group_id, campaign_id),
        )
    if "status" in data:
        state.db.execute(
            "UPDATE group_members SET status = ? WHERE group_id = ? AND content_type = 'campaign' AND content_id = ?",
            (_clean_status(data.get("status")), group_id, campaign_id),
        )
    state.db.commit()
    return _serialize(_row(state, group_id, campaign_id))


def delete_campaign(state: ServerState, user: Optional[User], group_id: str, campaign_id: str) -> Dict[str, Any]:
    """Deleting a campaign detaches its sessions; they keep their group."""
    _require_owner(state, group_id, user)
    _row(state, group_id, campaign_id)
    state.db.execute("UPDATE group_sessions SET campaign_id = NULL WHERE group_id = ? AND campaign_id = ?", (group_id, campaign_id))
    state.db.execute(
        "DELETE FROM group_members WHERE group_id = ? AND content_type = 'campaign' AND content_id = ?",
        (group_id, campaign_id),
    )
    state.db.commit()
    return {"ok": True}


def require_open_campaign(state: ServerState, group_id: str, campaign_id: str) -> None:
    """A session can only be attached to one of the group's campaigns that isn't completed."""
    row = _row(state, group_id, campaign_id)
    if row["status"] == "completed":
        raise AuthError("That campaign is completed")


def campaign_statuses(state: ServerState, group_id: str) -> List[Dict[str, Any]]:
    """Every campaign of a group with its status (the ledger asks whether one is still running)."""
    return [
        _serialize(row)
        for row in state.db.execute(
            "SELECT * FROM group_members WHERE group_id = ? AND content_type = 'campaign'", (group_id,)
        )
    ]
