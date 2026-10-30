from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from .auth import AuthError, User, get_user_settings
from .state import ServerState

# A user's community profile lives in `users.settings.profile`. It is written
# only through save_profile (the generic settings patch refuses the key), so
# every stored value has been checked against the reference data.
PROFILE_KEY = "profile"
PRECISIONS = ("hidden", "country", "region", "area")
TIMEZONE = re.compile(r"^[A-Za-z0-9_+\-/]{1,64}$")
ZIP3 = re.compile(r"^\d{3}$")


def _load(state: ServerState, name: str) -> Any:
    try:
        return json.loads(state.read_path("common", "data", name).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _regions(state: ServerState, country: Any) -> list:
    return (_load(state, "geo-regions.json") or {}).get(country) or []


def _ids(options: Any) -> set:
    return {entry["id"] for entry in options or []}


def _text(value: Any, label: str, limit: int) -> str:
    if not isinstance(value, str):
        raise AuthError(f"{label} must be text")
    return value.strip()[:limit]


def _choice(value: Any, allowed: set, label: str) -> Optional[str]:
    if value in (None, ""):
        return None
    if value not in allowed:
        raise AuthError(f"{label} isn't one of the available choices")
    return value


def _clean_location(state: ServerState, raw: Any) -> Dict[str, Any]:
    """Keeps only what the chosen precision reveals; Area is US-only and refused
    where the ZIP3 is too sparsely populated to hide an individual."""
    if not isinstance(raw, dict):
        raise AuthError("Location must be an object")
    precision = raw.get("precision")
    if precision not in PRECISIONS:
        raise AuthError("Location precision must be hidden, country, region or area")
    if precision == "hidden":
        return {"precision": "hidden"}
    countries = {entry["code"] for entry in _load(state, "geo-countries.json") or []}
    country = raw.get("country")
    if country not in countries:
        raise AuthError("Choose a country")
    location: Dict[str, Any] = {"precision": precision, "country": country}
    if precision == "country":
        return location
    regions = {entry["code"] for entry in _regions(state, country)}
    region = raw.get("region")
    if region not in regions:
        raise AuthError("Choose a region")
    location["region"] = region
    if precision == "region":
        return location
    if country != "US":
        raise AuthError("Area is only available in the United States")
    zip3 = str(raw.get("area") or "")
    if not (ZIP3.match(zip3) and zip3 in (_load(state, "geo-us-areas.json") or {})):
        raise AuthError("That area isn't recognised")
    location["area"] = zip3
    return location


def location_label(state: ServerState, location: Optional[Dict[str, Any]]) -> str:
    """The place name shown instead of a code."""
    if not location or location.get("precision") in (None, "hidden"):
        return ""
    if location.get("precision") == "area":
        area = (_load(state, "geo-us-areas.json") or {}).get(location.get("area"))
        if area:
            return area
    country = next((c["name"] for c in _load(state, "geo-countries.json") or [] if c["code"] == location.get("country")), "")
    if location.get("precision") == "country":
        return country
    region = next(
        (r["name"] for r in _regions(state, location.get("country")) if r["code"] == location.get("region")),
        "",
    )
    return f"{region}, {country}" if region else country


def clean_profile(state: ServerState, data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise AuthError("Profile must be an object")
    options = _load(state, "community-options.json") or {}
    scales = _load(state, "community-scales.json") or {}
    tools = _ids((_load(state, "community-safety-tools.json") or {}).get("items"))
    profile: Dict[str, Any] = {"public": bool(data.get("public"))}
    profile["bio"] = _text(data.get("bio", ""), "Bio", 2000)
    for key, option in (
        ("role", "role"),
        ("experience", "experience"),
        ("sessionLength", "sessionLength"),
        ("openTo", "openTo"),
        ("playMode", "playMode"),
    ):
        profile[key] = _choice(data.get(key), _ids(options.get(option)), key)
    timezone = data.get("timezone")
    if timezone in (None, ""):
        profile["timezone"] = None
    elif isinstance(timezone, str) and TIMEZONE.match(timezone):
        profile["timezone"] = timezone
    else:
        raise AuthError("Time zone isn't valid")
    systems = data.get("systems") or []
    if not isinstance(systems, list) or len(systems) > 50:
        raise AuthError("Systems known must be a list")
    profile["systems"] = []
    for entry in systems:
        if not isinstance(entry, dict):
            raise AuthError("Each system must be an object")
        name = _text(entry.get("name", ""), "System name", 120)
        system_id = _text(entry.get("systemId", ""), "System", 120)
        if not (name or system_id):
            raise AuthError("A system needs a name")
        profile["systems"].append({"systemId": system_id or None, "name": name})
    accounts = data.get("externalAccounts") or []
    if not isinstance(accounts, list) or len(accounts) > 30:
        raise AuthError("Other accounts must be a list of at most 30")
    services = _ids((_load(state, "community-services.json") or {}).get("items"))
    profile["externalAccounts"] = []
    seen_services = set()
    for entry in accounts:
        if not isinstance(entry, dict):
            raise AuthError("Each account must be an object")
        service_id = str(entry.get("serviceId") or "")
        # A service an admin has since removed is dropped rather than blocking the save.
        if service_id not in services or service_id in seen_services:
            continue
        username = _text(entry.get("username", ""), "Username", 100)
        if not username or any(ord(ch) < 32 for ch in username):
            raise AuthError("Each account needs a username")
        seen_services.add(service_id)
        profile["externalAccounts"].append({"serviceId": service_id, "username": username})
    day_parts, weekdays = _ids(options.get("dayParts")), _ids(options.get("weekdays"))
    availability = data.get("availability") or {}
    if not isinstance(availability, dict):
        raise AuthError("Availability must be an object")
    profile["availability"] = {}
    for day, parts in availability.items():
        if day not in weekdays or not isinstance(parts, list) or any(part not in day_parts for part in parts):
            raise AuthError("Availability has an unknown day or time of day")
        if parts:
            profile["availability"][day] = sorted(set(parts))
    chosen_tools = data.get("safetyTools") or []
    if not isinstance(chosen_tools, list) or any(tool not in tools for tool in chosen_tools):
        raise AuthError("Safety tools has an unknown entry")
    profile["safetyTools"] = sorted(set(chosen_tools))
    scale_ids = {scale["id"] for scale in scales.get("scales", [])}
    points = scales.get("points", 5)
    values = data.get("scales") or {}
    if not isinstance(values, dict):
        raise AuthError("Scales must be an object")
    profile["scales"] = {}
    for scale_id, value in values.items():
        if value is None:
            continue
        if scale_id not in scale_ids or isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= points:
            raise AuthError(f"Scale {scale_id} must be a whole number from 1 to {points}")
        profile["scales"][scale_id] = value
    profile["location"] = _clean_location(state, data["location"]) if data.get("location") else {"precision": "hidden"}
    return profile


def get_own_profile(state: ServerState, user: Optional[User]) -> Dict[str, Any]:
    if not user:
        raise AuthError("Authentication required")
    return {"profile": get_user_settings(state, user).get(PROFILE_KEY)}


def save_profile(state: ServerState, user: Optional[User], data: Any) -> Dict[str, Any]:
    if not user:
        raise AuthError("Authentication required")
    profile = clean_profile(state, data)
    settings = get_user_settings(state, user)
    settings[PROFILE_KEY] = profile
    state.db.execute("UPDATE users SET settings = ? WHERE id = ?", (json.dumps(settings), user.id))
    state.db.commit()
    return {"profile": profile}


def _shares_group(state: ServerState, a: int, b: int) -> bool:
    row = state.db.execute(
        """
        WITH membership(group_id, user_id) AS (
            SELECT id, owner_id FROM library_items WHERE kind = 'group'
            UNION
            SELECT group_id, CAST(content_id AS INTEGER) FROM group_members WHERE content_type = 'player'
        )
        SELECT 1 FROM membership AS x JOIN membership AS y ON x.group_id = y.group_id
        WHERE x.user_id = ? AND y.user_id = ? LIMIT 1
        """,
        (a, b),
    ).fetchone()
    return row is not None


def _is_public(state: ServerState, user_id: int) -> bool:
    row = state.db.execute(
        "SELECT json_extract(settings, '$.profile.public') AS public FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return bool(row and row["public"])


def can_view_history(state: ServerState, viewer: Optional[User], subject_id: int) -> bool:
    """Who may see a person's observed history: themselves, admins, any signed-in
    user when their profile is public, and otherwise people who share a group
    with them or have applied to a game they run."""
    if not viewer:
        return False
    if viewer.id == subject_id or viewer.tier == "admin":
        return True
    if _is_public(state, subject_id):
        return True
    if _shares_group(state, viewer.id, subject_id):
        return True
    from . import applications

    return applications.gm_has_application_from(state, viewer.id, subject_id)


def _public_view(state: ServerState, user_id: int, username: str, profile: Optional[Dict[str, Any]], full: bool) -> Dict[str, Any]:
    view: Dict[str, Any] = {"userId": user_id, "username": username}
    if full and profile:
        view["profile"] = {**profile, "locationLabel": location_label(state, profile.get("location"))}
    return view


def get_profile_view(state: ServerState, viewer: Optional[User], subject_id: int) -> Dict[str, Any]:
    if not viewer:
        raise AuthError("Sign in to view profiles")
    row = state.db.execute("SELECT id, username, settings FROM users WHERE id = ?", (subject_id,)).fetchone()
    if not row:
        raise AuthError("Person not found")
    try:
        profile = (json.loads(row["settings"]) if row["settings"] else {}).get(PROFILE_KEY)
    except (TypeError, ValueError):
        profile = None
    is_self = viewer.id == subject_id
    public = bool(profile and profile.get("public"))
    history = can_view_history(state, viewer, subject_id)
    if not (is_self or public or history):
        raise AuthError("This person's profile is private")
    view = _public_view(state, subject_id, row["username"], profile, is_self or public or viewer.tier == "admin")
    view["public"] = public
    view["canViewHistory"] = history
    return view


def list_people(state: ServerState, viewer: Optional[User], filters: Dict[str, Any]) -> Dict[str, Any]:
    """Public profiles that have an open-to status, for the Find a Game people directory."""
    if not viewer:
        raise AuthError("Sign in to browse people")
    clauses = ["json_extract(settings, '$.profile.public') = 1", "json_extract(settings, '$.profile.openTo') IS NOT NULL"]
    params: List[Any] = []
    # Yourself is left out unless you ask (`all`).
    if not filters.get("all"):
        clauses.append("id != ?")
        params.append(viewer.id)
    for key in ("openTo", "role", "playMode"):
        if filters.get(key):
            clauses.append(f"json_extract(settings, '$.profile.{key}') = ?")
            params.append(filters[key])
    rows = state.db.execute(
        f"SELECT id, username, settings FROM users WHERE {' AND '.join(clauses)} ORDER BY username COLLATE NOCASE LIMIT 200",
        params,
    ).fetchall()
    people = []
    for row in rows:
        profile = json.loads(row["settings"]).get(PROFILE_KEY)
        people.append(_public_view(state, row["id"], row["username"], profile, True))
    return {"people": people}
