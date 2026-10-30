from __future__ import annotations

import json
import re
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .auth import AuthError, User
from .roles import role_rank
from .state import ServerState

# Every community-defined list in the suite — fonts, audio clips, map tokens,
# page sizes, chat reactions, safety tools, endorsement tags and listing
# tags — is a flat JSON file edited through one set of routes: save (upsert by
# id, an edit keeping its place), delete, and reorder. Anyone at `add_tier` can
# add from the tool that uses the list; deleting and reordering are admin-only
# and happen in Loom's Community tab. Reads are the static files themselves.
SAFETY_PHASES = ("before", "during", "after")
APPLIES_TO = ("gm", "player", "both")


def _text(value: Any, label: str, limit: int, *, required: bool = True) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise AuthError(f"{label} is required")
    return text[:limit]


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise AuthError(f"{label} must be a number above zero")
    return value


def _url(value: Any) -> str:
    text = _text(value, "Link", 2000)
    if not text.lower().startswith(("http://", "https://")):
        raise AuthError("The link must start with http:// or https://")
    return text


def _clean_safety_tool(entry: Dict[str, Any]) -> Dict[str, Any]:
    if entry.get("phase") not in SAFETY_PHASES:
        raise AuthError("A safety tool is used before, during or after play")
    return {
        "name": _text(entry.get("name"), "Name", 120),
        "phase": entry["phase"],
        "description": _text(entry.get("description"), "Description", 500, required=False),
    }


def _clean_endorsement(entry: Dict[str, Any]) -> Dict[str, Any]:
    if entry.get("appliesTo") not in APPLIES_TO:
        raise AuthError("An endorsement applies to GMs, players or both")
    return {"name": _text(entry.get("name"), "Name", 80), "appliesTo": entry["appliesTo"]}


SERVICE_CATEGORIES = ("play", "social")
ICON_ID = re.compile(r"^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*$")


def _clean_service(entry: Dict[str, Any]) -> Dict[str, Any]:
    if entry.get("category") not in SERVICE_CATEGORIES:
        raise AuthError("A service is for play or for social media")
    icon = _text(entry.get("icon"), "Icon", 300)
    if not (ICON_ID.match(icon) or (icon.startswith("https://") and not re.search(r"\s", icon))):
        raise AuthError("The icon must be an icon name such as tabler:brand-discord, or an https:// image address")
    cleaned = {"name": _text(entry.get("name"), "Name", 60), "category": entry["category"], "icon": icon}
    pattern = _text(entry.get("linkPattern"), "Link pattern", 300, required=False)
    if pattern:
        if not pattern.startswith("https://") or re.search(r"\s", pattern) or pattern.count("{username}") != 1:
            raise AuthError("The link pattern must start with https:// and contain {username} once")
        cleaned["linkPattern"] = pattern
    return cleaned


def _clean_tag(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {"name": _text(entry.get("name"), "Name", 40)}


def _clean_font(entry: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = {"label": _text(entry.get("label"), "Name", 120), "family": _text(entry.get("family"), "Font family", 300)}
    google = _text(entry.get("googleFont"), "Google Fonts name", 200, required=False)
    if google:
        cleaned["googleFont"] = google
    return cleaned


def _clean_clip(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": _text(entry.get("name"), "Name", 200),
        "url": _url(entry.get("url")),
        "type": _text(entry.get("type"), "Type", 20),
        "loop": bool(entry.get("loop")),
    }


def _clean_token(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {"name": _text(entry.get("name"), "Name", 200), "url": _url(entry.get("url"))}


def _clean_size(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "label": _text(entry.get("label"), "Name", 120),
        "width": _number(entry.get("width"), "Width"),
        "height": _number(entry.get("height"), "Height"),
    }


def _clean_reaction(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "emoji": _text(entry.get("emoji"), "Reaction", 16),
        "description": _text(entry.get("description"), "Description", 120, required=False),
    }


@dataclass(frozen=True)
class ListSpec:
    route: str                      # base URL; /delete and /order hang off it
    file: Tuple[str, ...]           # path under undercroft/
    key: str                        # the array's key in the file
    wrapper: str                    # legacy clients wrap the entry under this key
    clean: Callable[[Dict[str, Any]], Dict[str, Any]]
    add_tier: Optional[str]         # lowest tier that may add or edit; None = anyone


_COMMUNITY = ("common", "data")
LISTS: Dict[str, ListSpec] = {
    "safety-tools": ListSpec("/community/lists/safety-tools", _COMMUNITY + ("community-safety-tools.json",), "items", "item", _clean_safety_tool, "admin"),
    "endorsements": ListSpec("/community/lists/endorsements", _COMMUNITY + ("community-endorsements.json",), "items", "item", _clean_endorsement, "admin"),
    "services": ListSpec("/community/lists/services", _COMMUNITY + ("community-services.json",), "items", "item", _clean_service, "admin"),
    "tags": ListSpec("/community/lists/tags", _COMMUNITY + ("community-tags.json",), "items", "item", _clean_tag, "admin"),
    "reactions": ListSpec("/community/lists/reactions", _COMMUNITY + ("chat-reactions.json",), "emoji", "item", _clean_reaction, "admin"),
    "fonts": ListSpec("/custom-fonts", _COMMUNITY + ("custom-fonts.json",), "fonts", "font", _clean_font, "creator"),
    "clips": ListSpec("/soundboard/clips", _COMMUNITY + ("audio-clips.json",), "clips", "clip", _clean_clip, "gm"),
    "tokens": ListSpec("/token-library", _COMMUNITY + ("token-library.json",), "tokens", "token", _clean_token, "gm"),
    "sizes": ListSpec("/press/custom-sizes", ("press", "data", "custom-page-sizes.json"), "sizes", "size", _clean_size, "creator"),
}


def data_path(state: ServerState, name: str) -> Path:
    return state.write_path(*LISTS[name].file)


def _read_items(path: Path, spec: ListSpec) -> List[Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    items = data.get(spec.key) if isinstance(data, dict) else data
    return items if isinstance(items, list) else []


def _write_items(path: Path, spec: ListSpec, items: List[Any]) -> Dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({spec.key: items}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"ok": True, spec.key: items, "items": items}


def _require_tier(user: Optional[User], tier: Optional[str], action: str) -> None:
    if tier is None:
        return
    if not user:
        raise AuthError("Authentication required")
    if role_rank(user.tier) < role_rank(tier):
        raise AuthError(f"{tier.capitalize()} tier or higher required to {action}")


def _spec(name: str) -> ListSpec:
    spec = LISTS.get(name)
    if not spec:
        raise AuthError("Unknown list")
    return spec


def save_item(state: ServerState, user: Optional[User], name: str, payload: Any) -> Dict[str, Any]:
    spec = _spec(name)
    _require_tier(user, spec.add_tier, "add to this list")
    entry = (payload.get(spec.wrapper) or payload.get("item") or payload) if isinstance(payload, dict) else None
    if not isinstance(entry, dict):
        raise AuthError("Invalid entry")
    cleaned = spec.clean(entry)
    path = data_path(state, name)
    items = _read_items(path, spec)
    entry_id = str(entry.get("id") or "").strip() or f"{name}-{secrets.token_hex(4)}"
    saved = {"id": entry_id, **cleaned}
    # An edit keeps its place in the list; a new entry goes to the end.
    if any(item.get("id") == entry_id for item in items):
        items = [saved if item.get("id") == entry_id else item for item in items]
    else:
        items.append(saved)
    return _write_items(path, spec, items)


def delete_item(state: ServerState, user: Optional[User], name: str, entry_id: Any) -> Dict[str, Any]:
    spec = _spec(name)
    _require_tier(user, "admin", "delete from this list")
    if not entry_id:
        raise AuthError("An id is required")
    path = data_path(state, name)
    return _write_items(path, spec, [item for item in _read_items(path, spec) if item.get("id") != entry_id])


def save_order(state: ServerState, user: Optional[User], name: str, ids: Any) -> Dict[str, Any]:
    """Reorders a list; anything not named keeps its relative place at the end."""
    spec = _spec(name)
    _require_tier(user, "admin", "reorder this list")
    if not isinstance(ids, list):
        raise AuthError("A list of ids is required")
    path = data_path(state, name)
    rank = {entry_id: index for index, entry_id in enumerate(ids)}
    items = sorted(_read_items(path, spec), key=lambda item: rank.get(item.get("id"), len(rank)))
    return _write_items(path, spec, items)


# --- Listing tags: the curated vocabulary listings draw on -------------------------------------


def stored_tags(state: ServerState) -> List[Dict[str, Any]]:
    return _read_items(data_path(state, "tags"), LISTS["tags"])


def rename_stored_tag(state: ServerState, old: str, new: str) -> None:
    """Keeps the curated list in step with a rename, merge or removal (blank `new`)."""
    path = data_path(state, "tags")
    items = _read_items(path, LISTS["tags"])
    kept: List[Dict[str, Any]] = []
    for item in items:
        if item.get("name", "").lower() == old.lower():
            if not new:
                continue
            item = {**item, "name": new}
        if not any(k["name"].lower() == item["name"].lower() for k in kept):
            kept.append(item)
    if kept != items:
        _write_items(path, LISTS["tags"], kept)
