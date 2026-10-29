from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from .auth import AuthError, User
from .groups import (
    _INLINE_SPOTLIGHT_KINDS,
    _SPOTLIGHT_UPDATE_ALLOWED_KINDS,
    _resolve_group_access,
)
from .shares import content_exists
from .state import ServerState


def _parse_state(raw: Optional[str]) -> List[Dict[str, Any]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return [item for item in parsed if isinstance(item, dict)] if isinstance(parsed, list) else []


def get_active_spotlights(state: ServerState, group_id: str) -> List[Dict[str, Any]]:
    """Every (kind, id) pair currently spotlighted in this group. No access
    check by design: only called from a context that already resolved group
    access (storage.get_item's share-link grant, which is an unlocked route,
    hence read_db)."""
    row = state.read_db.execute("SELECT state FROM group_spotlight WHERE group_id = ?", (group_id,)).fetchone()
    return _parse_state(row["state"] if row else None)


def list_group_spotlights(
    state: ServerState,
    group_id: Optional[str],
    user: Optional[User],
    *,
    share_token: Optional[str] = None,
) -> Dict[str, Any]:
    row, _ = _resolve_group_access(state, group_id, user, share_token=share_token)
    stored = state.read_db.execute(
        "SELECT state, version FROM group_spotlight WHERE group_id = ?", (row["id"],)
    ).fetchone()
    return {
        "items": _parse_state(stored["state"] if stored else None),
        "version": stored["version"] if stored else 0,
    }


def apply_group_spotlight(
    state: ServerState,
    group_id: Optional[str],
    user: Optional[User],
    *,
    share_token: Optional[str] = None,
    action: str = "show",
    kind: str = "",
    item_id: str = "",
    template_id: str = "",
    data: Any = None,
) -> Dict[str, Any]:
    if not user:
        raise AuthError("Sign in to change what the table is shown")
    row, _ = _resolve_group_access(state, group_id, user, share_token=share_token)
    action = (action or "").strip().lower()
    kind = str(kind or "").strip()
    item_id = str(item_id or "").strip()
    template_id = str(template_id or "").strip()
    if action not in ("show", "update", "clear"):
        raise AuthError("Unsupported spotlight action")
    if action in ("show", "update") and (not kind or not item_id):
        raise AuthError("Spotlight requires kind and id")

    if action == "show" and kind not in _INLINE_SPOTLIGHT_KINDS:
        # shareWithGroup already enforces this client-side, but this route
        # can't rely on the caller having gone through it: a never-saved
        # record would otherwise fail later, on a viewer's screen.
        if not content_exists(state, kind, item_id):
            raise AuthError("Save this record before showing it to the table")
        if template_id and not content_exists(state, "template", template_id):
            raise AuthError("Save this template before showing it to the table")
    if action == "update" and kind not in _SPOTLIGHT_UPDATE_ALLOWED_KINDS:
        raise AuthError("This kind does not support inline spotlight updates")

    stored = state.db.execute(
        "SELECT state, version FROM group_spotlight WHERE group_id = ?", (row["id"],)
    ).fetchone()
    items = _parse_state(stored["state"] if stored else None)
    version = (stored["version"] if stored else 0) + 1
    timestamp = datetime.utcnow().isoformat()

    if action == "show":
        # Re-showing moves the item to the end so "most recent" stays meaningful.
        items = [item for item in items if not (item.get("kind") == kind and item.get("id") == item_id)]
        item: Dict[str, Any] = {"kind": kind, "id": item_id, "postedAt": timestamp}
        if template_id:
            item["templateId"] = template_id
        if kind in _INLINE_SPOTLIGHT_KINDS and data is not None:
            item["data"] = data
        items.append(item)
    elif action == "update":
        # No-op on a spotlight that is no longer shown, so a late tick from a
        # widget can't re-show something the GM already cleared.
        for item in items:
            if item.get("kind") == kind and item.get("id") == item_id:
                item["data"] = data
                break
        else:
            return {"items": items, "version": version - 1}
    else:
        if not kind:
            items = []
        elif item_id:
            items = [item for item in items if not (item.get("kind") == kind and item.get("id") == item_id)]
        else:
            items = [item for item in items if item.get("kind") != kind]

    try:
        encoded = json.dumps(items)
    except (TypeError, ValueError) as exc:
        raise AuthError("Invalid spotlight data") from exc
    state.db.execute(
        """
        INSERT INTO group_spotlight (group_id, state, version, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(group_id) DO UPDATE SET state = excluded.state, version = excluded.version,
            updated_at = excluded.updated_at
        """,
        (row["id"], encoded, version, timestamp),
    )
    state.db.commit()
    return {"items": items, "version": version}
