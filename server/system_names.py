from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any, Dict, List, Optional, Set, Tuple

from .auth import AuthError, User
from .roles import role_rank
from .state import ServerState

# Free-text game systems people type on their profile ("Another system") or on a listing. Grouped case- and
# punctuation-insensitively, counted as distinct people, and rewritten back to the profiles and listings they came from.
NAME_LIMIT = 120
SUGGESTION_MIN_PEOPLE = 2


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def _require_admin(user: Optional[User]) -> None:
    if not user or role_rank(user.tier) < role_rank("admin"):
        raise AuthError("Admin only")


def _settings(raw: Any) -> Dict[str, Any]:
    try:
        data = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _library_systems(db) -> Dict[str, Dict[str, str]]:
    found: Dict[str, Dict[str, str]] = {}
    for row in db.execute("SELECT id, title FROM library_items WHERE kind = 'system'"):
        entry = {"id": row["id"], "title": row["title"] or row["id"]}
        found.setdefault(_key(entry["title"]), entry)
        found.setdefault(_key(entry["id"]), entry)
    return found


def library_match(db, name: str) -> Optional[Dict[str, str]]:
    """The Library System a typed name stands for (by title or id), if any."""
    return _library_systems(db).get(_key(name))


def _collect(db) -> Dict[str, Dict[str, Any]]:
    names: Dict[str, Dict[str, Any]] = {}

    def note(name: str, person: int, source: str) -> None:
        key = _key(name)
        if not key:
            return
        entry = names.setdefault(key, {"spellings": Counter(), "people": set(), "profiles": 0, "listings": 0})
        entry["spellings"][name] += 1
        entry["people"].add(person)
        entry[source] += 1

    for row in db.execute("SELECT id, settings FROM users"):
        profile = _settings(row["settings"]).get("profile")
        for system in (profile or {}).get("systems", []) if isinstance(profile, dict) else []:
            if isinstance(system, dict) and not system.get("systemId") and str(system.get("name") or "").strip():
                note(str(system["name"]).strip(), row["id"], "profiles")
    for row in db.execute("SELECT owner_id, system_name FROM listings WHERE (system_id IS NULL OR system_id = '') AND system_name IS NOT NULL"):
        if str(row["system_name"]).strip():
            note(str(row["system_name"]).strip(), row["owner_id"], "listings")
    return names


def _display(entry: Dict[str, Any]) -> str:
    return entry["spellings"].most_common(1)[0][0]


def system_name_report(state: ServerState, user: Optional[User]) -> Dict[str, Any]:
    _require_admin(user)
    library = _library_systems(state.read_db)
    rows: List[Dict[str, Any]] = []
    for key, entry in _collect(state.read_db).items():
        rows.append(
            {
                "name": _display(entry),
                "people": len(entry["people"]),
                "profiles": entry["profiles"],
                "listings": entry["listings"],
                "library": library.get(key),
            }
        )
    rows.sort(key=lambda row: (-row["people"], row["name"].lower()))
    return {"names": rows, "librarySystems": sorted({entry["title"] for entry in library.values()}, key=str.lower)}


def system_name_suggestions(state: ServerState, user: Optional[User]) -> Dict[str, Any]:
    if not user:
        raise AuthError("Authentication required")
    names = [
        _display(entry)
        for entry in _collect(state.read_db).values()
        if len(entry["people"]) >= SUGGESTION_MIN_PEOPLE
    ]
    return {"names": sorted(names, key=str.lower)}


def rewrite_system_name(state: ServerState, user: Optional[User], old: Any, new: Any) -> Dict[str, Any]:
    """Renames a free-text system everywhere it was typed. A new name that already exists is a merge; a new name that
    matches a Library System converts every entry to that System."""
    _require_admin(user)
    old_key = _key(str(old or ""))
    replacement = str(new or "").strip()[:NAME_LIMIT]
    if not old_key:
        raise AuthError("Choose a system name to change")
    if not _key(replacement):
        raise AuthError("Give the system a name to change it to")
    target = _library_systems(state.read_db).get(_key(replacement))
    new_entry = (
        {"systemId": target["id"], "name": target["title"]} if target else {"systemId": None, "name": replacement}
    )
    counts = {"profiles": 0, "listings": 0}
    with state.lock:
        for row in state.db.execute("SELECT id, settings FROM users").fetchall():
            settings = _settings(row["settings"])
            profile = settings.get("profile")
            systems = profile.get("systems") if isinstance(profile, dict) else None
            if not isinstance(systems, list):
                continue
            rewritten: List[Dict[str, Any]] = []
            seen: Set[Tuple[str, str]] = set()
            touched = False
            for system in systems:
                if isinstance(system, dict) and not system.get("systemId") and _key(str(system.get("name") or "")) == old_key:
                    system, touched = dict(new_entry), True
                identity = ("id", system["systemId"]) if isinstance(system, dict) and system.get("systemId") else ("name", _key(str((system or {}).get("name") or "")))
                if identity in seen:
                    continue
                seen.add(identity)
                rewritten.append(system)
            if touched:
                profile["systems"] = rewritten
                state.db.execute("UPDATE users SET settings = ? WHERE id = ?", (json.dumps(settings), row["id"]))
                counts["profiles"] += 1
        for row in state.db.execute(
            "SELECT id, system_name FROM listings WHERE (system_id IS NULL OR system_id = '') AND system_name IS NOT NULL"
        ).fetchall():
            if _key(str(row["system_name"])) != old_key:
                continue
            if target:
                state.db.execute("UPDATE listings SET system_id = ?, system_name = NULL WHERE id = ?", (target["id"], row["id"]))
            else:
                state.db.execute("UPDATE listings SET system_name = ? WHERE id = ?", (replacement, row["id"]))
            counts["listings"] += 1
        state.db.commit()
    return {"changed": counts, **system_name_report(state, user)}
