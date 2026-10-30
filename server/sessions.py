"""Scheduled real-world sessions for player groups.

A *series* (`group_sessions`) is a one-off or recurring game; each date is an
*occurrence* (`group_session_occurrences`). Every moment is a naive-UTC ISO
string and every comparison is UTC, so this module needs no time-zone data:
recurrence repeats at fixed UTC spacing, and browsers convert for display.

Nothing here has a built-in default for a user setting. A request that omits a
setting is rejected, and the scheduler has no polling interval: it sleeps until
the earliest stored due time (see scheduler_loop).
"""
from __future__ import annotations

import calendar
import json
import logging
import secrets
import threading
from datetime import datetime, timedelta, timezone
from itertools import islice
from typing import Any, Dict, Iterator, List, Optional, Tuple

from .auth import AuthError, User
from .groups import _resolve_group_access
from . import campaigns
from .state import ServerState

KINDS = ("live", "pbp")
RESPONSES = ("accept", "decline", "tentative", "waitlist")
FREQUENCIES = ("daily", "weekly", "monthly")
# Settings a single occurrence can override without touching its series.
OVERRIDABLE = (
    "title",
    "description",
    "location_text",
    "location_url",
    "min_players",
    "max_players",
    "rsvp_cutoff_minutes",
    "allow_late_rsvp",
    "thread_ids",
    "duration_minutes",
)

_wake = threading.Event()


def wake() -> None:
    """Tells the scheduler to recompute when it next needs to run."""
    _wake.set()


# --- Time helpers -----------------------------------------------------------------


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def iso(moment: datetime) -> str:
    return moment.replace(microsecond=0).isoformat()


def parse_utc(value: Any, field: str = "time") -> datetime:
    if isinstance(value, datetime):
        return value.replace(microsecond=0)
    if not isinstance(value, str) or not value.strip():
        raise AuthError(f"{field} is required")
    text = value.strip()
    if text.endswith("Z") or text.endswith("z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise AuthError(f"{field} isn't a valid date and time") from exc
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed.replace(microsecond=0)


# --- Recurrence ----------------------------------------------------------------------


def _js_weekday(moment: datetime) -> int:
    """0 = Sunday ... 6 = Saturday, the same numbering the browser uses."""
    return (moment.weekday() + 1) % 7


def validate_recurrence(rule: Any) -> Optional[Dict[str, Any]]:
    if rule is None:
        return None
    if not isinstance(rule, dict):
        raise AuthError("Recurrence must be an object")
    freq = rule.get("freq")
    if freq not in FREQUENCIES:
        raise AuthError("Recurrence must repeat daily, weekly or monthly")
    interval = rule.get("interval")
    if not isinstance(interval, int) or isinstance(interval, bool) or interval < 1:
        raise AuthError("Recurrence interval must be a whole number of at least 1")
    cleaned: Dict[str, Any] = {"freq": freq, "interval": interval}
    if freq == "weekly":
        weekdays = rule.get("byWeekday")
        if (
            not isinstance(weekdays, list)
            or not weekdays
            or any(not isinstance(day, int) or isinstance(day, bool) or day < 0 or day > 6 for day in weekdays)
        ):
            raise AuthError("A weekly recurrence needs at least one weekday")
        cleaned["byWeekday"] = sorted(set(weekdays))
    if freq == "monthly":
        mode = rule.get("monthly")
        if mode not in ("dayOfMonth", "nthWeekday"):
            raise AuthError("A monthly recurrence needs a pattern")
        cleaned["monthly"] = mode
    end = rule.get("end")
    if not isinstance(end, dict) or end.get("type") not in ("never", "until", "count"):
        raise AuthError("Recurrence needs an end condition")
    cleaned_end: Dict[str, Any] = {"type": end["type"]}
    if end["type"] == "until":
        cleaned_end["until"] = iso(parse_utc(end.get("until"), "Recurrence end date"))
    if end["type"] == "count":
        count = end.get("count")
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            raise AuthError("Recurrence count must be a whole number of at least 1")
        cleaned_end["count"] = count
    cleaned["end"] = cleaned_end
    return cleaned


def _add_months(moment: datetime, months: int) -> Tuple[int, int]:
    index = moment.year * 12 + (moment.month - 1) + months
    return index // 12, index % 12 + 1


def _nth_weekday(year: int, month: int, weekday: int, ordinal: int) -> int:
    """Day of month of the `ordinal`th `weekday` (0 = Sunday); ordinal 5 means the last."""
    days_in_month = calendar.monthrange(year, month)[1]
    matches = [day for day in range(1, days_in_month + 1) if _js_weekday(datetime(year, month, day)) == weekday]
    return matches[min(ordinal, len(matches)) - 1]


def _candidates(rule: Dict[str, Any], start: datetime) -> Iterator[datetime]:
    """Every slot of the rule, in order, from `start` (unbounded)."""
    interval = rule["interval"]
    freq = rule["freq"]
    if freq == "daily":
        step = 0
        while True:
            yield start + timedelta(days=step * interval)
            step += 1
    elif freq == "weekly":
        week_anchor = (start - timedelta(days=_js_weekday(start))).replace(hour=0, minute=0, second=0)
        step = 0
        time_of_day = start - start.replace(hour=0, minute=0, second=0)
        while True:
            base = week_anchor + timedelta(weeks=step * interval)
            for weekday in rule["byWeekday"]:
                slot = base + timedelta(days=weekday) + time_of_day
                if slot >= start:
                    yield slot
            step += 1
    else:
        ordinal = (start.day - 1) // 7 + 1
        weekday = _js_weekday(start)
        step = 0
        while True:
            year, month = _add_months(start, step * interval)
            if rule["monthly"] == "dayOfMonth":
                day = min(start.day, calendar.monthrange(year, month)[1])
            else:
                day = _nth_weekday(year, month, weekday, ordinal)
            yield start.replace(year=year, month=month, day=day)
            step += 1


def iter_slots(rule: Optional[Dict[str, Any]], start: datetime) -> Iterator[datetime]:
    """Every slot of a series in order, honoring its end condition; unbounded
    for a rule that never ends, so callers must stop iterating."""
    if not rule:
        yield start
        return
    end = rule["end"]
    limit = parse_utc(end["until"]) if end["type"] == "until" else None
    produced = 0
    for slot in _candidates(rule, start):
        if limit is not None and slot > limit:
            return
        if end["type"] == "count" and produced >= end["count"]:
            return
        produced += 1
        yield slot


def expand_slots(rule: Optional[Dict[str, Any]], start: datetime, until: datetime) -> Iterator[datetime]:
    """The slot instants of a series from its start up to `until` (inclusive)."""
    for slot in iter_slots(rule, start):
        if slot > until:
            return
        yield slot


# --- Validation of series settings ---------------------------------------------------------


def _int_or_none(value: Any, name: str, minimum: int) -> Optional[int]:
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise AuthError(f"{name} must be a whole number of at least {minimum}, or empty")
    return value


def _required_int(value: Any, name: str, minimum: int) -> int:
    if value is None:
        raise AuthError(f"{name} is required")
    return _int_or_none(value, name, minimum)  # type: ignore[return-value]


def _bool(value: Any, name: str) -> int:
    if not isinstance(value, bool):
        raise AuthError(f"{name} must be true or false")
    return 1 if value else 0


def _text(value: Any, name: str, *, required: bool = False, limit: int = 4000) -> str:
    if not isinstance(value, str):
        raise AuthError(f"{name} is required")
    text = value.strip()[:limit]
    if required and not text:
        raise AuthError(f"{name} is required")
    return text


SERIES_FIELDS = (
    "title",
    "description",
    "kind",
    "start_at",
    "duration_minutes",
    "recurrence",
    "location_text",
    "location_url",
    "min_players",
    "max_players",
    "rsvp_cutoff_minutes",
    "allow_late_rsvp",
    "lead_days",
    "reminder_minutes",
    "lock_posting",
    "thread_ids",
)


def _clean_field(name: str, value: Any) -> Any:
    if name == "title":
        return _text(value, "Title", required=True, limit=200)
    if name in ("description", "location_text"):
        return _text(value, name.replace("_", " ").capitalize())
    if name == "location_url":
        text = _text(value, "Location link", limit=2000)
        if text and not text.lower().startswith(("http://", "https://")):
            raise AuthError("The location link must start with http:// or https://")
        return text
    if name == "kind":
        if value not in KINDS:
            raise AuthError("A session is either live or play-by-post")
        return value
    if name == "start_at":
        return iso(parse_utc(value, "Start"))
    if name == "duration_minutes":
        return _required_int(value, "Duration", 1)
    if name == "recurrence":
        rule = validate_recurrence(value)
        return json.dumps(rule) if rule else None
    if name in ("min_players", "max_players"):
        return _int_or_none(value, "Player limit", 0)
    if name == "rsvp_cutoff_minutes":
        return _int_or_none(value, "RSVP cutoff", 0)
    if name in ("allow_late_rsvp", "lock_posting"):
        return _bool(value, name.replace("_", " "))
    if name == "lead_days":
        return _required_int(value, "Lead time", 0)
    if name == "reminder_minutes":
        return _required_int(value, "Reminder", 0)
    if name == "thread_ids":
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise AuthError("Linked threads must be a list of thread ids")
        return json.dumps(sorted(set(value)))
    raise AuthError(f"Unknown setting {name}")


def _clean_override(name: str, value: Any) -> Any:
    """A single date's override, stored as plain JSON values (not DB column text)."""
    cleaned = _clean_field(name, value)
    if name == "thread_ids":
        return json.loads(cleaned)
    if name == "allow_late_rsvp":
        return bool(cleaned)
    return cleaned


def _clean_series(data: Dict[str, Any], *, partial: bool) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise AuthError("Session settings are required")
    cleaned: Dict[str, Any] = {}
    for name in SERIES_FIELDS:
        if name not in data:
            if not partial:
                raise AuthError(f"{name} is required")
            continue
        cleaned[name] = _clean_field(name, data[name])
    low, high = cleaned.get("min_players"), cleaned.get("max_players")
    if low is not None and high is not None and high < low:
        raise AuthError("The maximum players can't be below the minimum")
    # Optional: the campaign this series belongs to (blank = none).
    if "campaign_id" in data:
        cleaned["campaign_id"] = str(data["campaign_id"] or "").strip() or None
    return cleaned


# --- Access ------------------------------------------------------------------------------


def _is_gm(row: Dict[str, Any], user: Optional[User]) -> bool:
    return bool(user) and (user.tier == "admin" or row["owner_id"] == user.id)


def _gm_access(state: ServerState, group_id: Optional[str], user: Optional[User]) -> Dict[str, Any]:
    if not user:
        raise AuthError("Authentication required")
    row, _ = _resolve_group_access(state, group_id, user)
    if not _is_gm(row, user):
        raise AuthError("Only the GM can manage sessions")
    return row


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


def _json_list(raw: Optional[str]) -> List[Any]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _json_object(raw: Optional[str]) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


# --- Series and occurrence rows ------------------------------------------------------------


def _series_row(state: ServerState, session_id: str, group_id: Optional[str] = None) -> Any:
    row = state.db.execute("SELECT * FROM group_sessions WHERE id = ?", (session_id,)).fetchone()
    if not row or (group_id is not None and row["group_id"] != group_id):
        raise AuthError("Session not found")
    return row


def _occurrence_row(state: ServerState, occurrence_id: str) -> Any:
    row = state.db.execute("SELECT * FROM group_session_occurrences WHERE id = ?", (occurrence_id,)).fetchone()
    if not row:
        raise AuthError("Session date not found")
    return row


def effective(series: Any, occurrence: Any) -> Dict[str, Any]:
    """A date's settings: its series' values with this date's own overrides on top."""
    values: Dict[str, Any] = {
        "title": series["title"],
        "description": series["description"] or "",
        "location_text": series["location_text"] or "",
        "location_url": series["location_url"] or "",
        "min_players": series["min_players"],
        "max_players": series["max_players"],
        "rsvp_cutoff_minutes": series["rsvp_cutoff_minutes"],
        "allow_late_rsvp": bool(series["allow_late_rsvp"]),
        "thread_ids": _json_list(series["thread_ids"]),
        "duration_minutes": series["duration_minutes"],
    }
    for key, value in _json_object(occurrence["overrides"]).items():
        if key in OVERRIDABLE:
            values[key] = value
    return values


def _cutoff_at(settings: Dict[str, Any], start: datetime) -> Optional[datetime]:
    minutes = settings["rsvp_cutoff_minutes"]
    return start - timedelta(minutes=minutes) if minutes is not None else None


def _serialize_series(row: Any, next_slot: Optional[str]) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "groupId": row["group_id"],
        "title": row["title"],
        "description": row["description"] or "",
        "kind": row["kind"],
        "startAt": row["start_at"],
        "durationMinutes": row["duration_minutes"],
        "recurrence": _json_object(row["recurrence"]) or None,
        "locationText": row["location_text"] or "",
        "locationUrl": row["location_url"] or "",
        "minPlayers": row["min_players"],
        "maxPlayers": row["max_players"],
        "rsvpCutoffMinutes": row["rsvp_cutoff_minutes"],
        "allowLateRsvp": bool(row["allow_late_rsvp"]),
        "leadDays": row["lead_days"],
        "reminderMinutes": row["reminder_minutes"],
        "lockPosting": bool(row["lock_posting"]),
        "threadIds": _json_list(row["thread_ids"]),
        "campaignId": row["campaign_id"],
        "endedAt": row["ended_at"],
        "nextSlot": next_slot,
    }


def _rsvp_summary(state: ServerState, occurrence_id: str) -> Dict[str, int]:
    counts = {"accept": 0, "tentative": 0, "decline": 0, "waitlist": 0}
    for row in state.db.execute(
        "SELECT response, COUNT(*) AS n FROM session_rsvps WHERE occurrence_id = ? GROUP BY response", (occurrence_id,)
    ):
        counts[row["response"]] = row["n"]
    return counts


def _serialize_occurrence(state: ServerState, series: Any, occurrence: Any) -> Dict[str, Any]:
    settings = effective(series, occurrence)
    counts = _rsvp_summary(state, occurrence["id"])
    return {
        "id": occurrence["id"],
        "sessionId": occurrence["session_id"],
        "groupId": occurrence["group_id"],
        "slotKey": occurrence["slot_key"],
        "startAt": occurrence["start_at"],
        "endAt": occurrence["end_at"],
        "status": occurrence["status"],
        "detached": bool(occurrence["detached"]),
        "kind": series["kind"],
        "title": settings["title"],
        "description": settings["description"],
        "locationText": settings["location_text"],
        "locationUrl": settings["location_url"],
        "minPlayers": settings["min_players"],
        "maxPlayers": settings["max_players"],
        "rsvpCutoffMinutes": settings["rsvp_cutoff_minutes"],
        "allowLateRsvp": settings["allow_late_rsvp"],
        "durationMinutes": settings["duration_minutes"],
        "threadIds": settings["thread_ids"],
        "overrides": sorted(_json_object(occurrence["overrides"]).keys()),
        "counts": counts,
        "inworldFromDay": occurrence["inworld_from_day"],
        "inworldToDay": occurrence["inworld_to_day"],
        "recapThreadId": occurrence["recap_thread_id"],
        "recapPageId": occurrence["recap_page_id"],
        "notified": occurrence["notified_at"] is not None,
    }


def _next_slot(series: Any, now: datetime) -> Optional[str]:
    """The next date of a series that hasn't finished yet."""
    if series["ended_at"]:
        return None
    rule = _json_object(series["recurrence"]) or None
    start = parse_utc(series["start_at"])
    duration = timedelta(minutes=series["duration_minutes"])
    for slot in iter_slots(rule, start):
        if slot + duration > now:
            return iso(slot)
    return None


# --- Invitations and notices -------------------------------------------------------------------


def invitees(state: ServerState, group_id: str) -> List[Dict[str, Any]]:
    """Players with an active character in the group (never the GM)."""
    group = state.db.execute("SELECT owner_id FROM library_items WHERE kind = 'group' AND id = ?", (group_id,)).fetchone()
    owner_id = group["owner_id"] if group else None
    rows = state.db.execute(
        """
        SELECT li.owner_id AS user_id, u.username AS username, gm.content_id AS character_id, li.title AS character_name
        FROM group_members AS gm
        JOIN library_items AS li ON li.kind = 'character' AND li.id = gm.content_id
        JOIN users AS u ON u.id = li.owner_id
        WHERE gm.group_id = ? AND gm.content_type = 'character' AND COALESCE(gm.active, 1) != 0 AND li.owner_id IS NOT ?
        ORDER BY u.username COLLATE NOCASE
        """,
        (group_id, owner_id),
    ).fetchall()
    seen = set()
    result = []
    for row in rows:
        if row["user_id"] in seen:
            continue
        seen.add(row["user_id"])
        result.append(
            {
                "user_id": row["user_id"],
                "username": row["username"],
                "character_id": row["character_id"],
                "character_name": row["character_name"] or row["character_id"],
            }
        )
    return result


def _group_owner(state: ServerState, group_id: str) -> Optional[int]:
    row = state.db.execute("SELECT owner_id FROM library_items WHERE kind = 'group' AND id = ?", (group_id,)).fetchone()
    return row["owner_id"] if row else None


def _notice(state: ServerState, user_id: int, group_id: str, reason: str, occurrence_id: str, revision: int, now: datetime) -> None:
    state.db.execute(
        """
        INSERT OR IGNORE INTO inbox_items (user_id, group_id, reason, occurrence_id, revision, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, group_id, reason, occurrence_id, revision, iso(now)),
    )


def _apply_decline_ranges(state: ServerState, occurrence: Any, person: Dict[str, Any], now: datetime) -> None:
    hit = state.db.execute(
        """
        SELECT 1 FROM session_decline_ranges
        WHERE group_id = ? AND user_id = ? AND from_at <= ? AND to_at >= ?
        LIMIT 1
        """,
        (occurrence["group_id"], person["user_id"], occurrence["start_at"], occurrence["start_at"]),
    ).fetchone()
    if hit:
        state.db.execute(
            """
            INSERT OR IGNORE INTO session_rsvps
                (occurrence_id, user_id, character_id, character_name, response, responded_at, set_by)
            VALUES (?, ?, ?, ?, 'decline', ?, NULL)
            """,
            (occurrence["id"], person["user_id"], person["character_id"], person["character_name"], iso(now)),
        )


def _notify_invitees(state: ServerState, occurrence: Any, now: datetime, *, reason: str = "session") -> None:
    for person in invitees(state, occurrence["group_id"]):
        _apply_decline_ranges(state, occurrence, person, now)
        _notice(state, person["user_id"], occurrence["group_id"], reason, occurrence["id"], occurrence["revision"], now)


def on_roster_changed(state: ServerState, group_id: str, now: Optional[datetime] = None) -> None:
    """After an active character is added or switched: anyone newly invited gets
    notices for the upcoming dates that have already been announced (never past
    ones). Idempotent through the inbox unique key."""
    moment = now or utcnow()
    rows = state.db.execute(
        """
        SELECT * FROM group_session_occurrences
        WHERE group_id = ? AND status = 'scheduled' AND notified_at IS NOT NULL AND end_at > ?
        """,
        (group_id, iso(moment)),
    ).fetchall()
    for occurrence in rows:
        _notify_invitees(state, occurrence, moment)
    state.db.commit()
    wake()


# --- Materializing occurrences ----------------------------------------------------------------------


def _insert_occurrence(
    state: ServerState, series: Any, slot: datetime, now: datetime, *, notify: bool, overrides: Optional[Dict[str, Any]] = None, detached: bool = False
) -> Any:
    duration = (overrides or {}).get("duration_minutes", series["duration_minutes"])
    occurrence_id = _new_id("occ")
    state.db.execute(
        """
        INSERT INTO group_session_occurrences
            (id, session_id, group_id, slot_key, start_at, end_at, status, detached, overrides, revision,
             notified_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, 0, ?, ?, ?)
        """,
        (
            occurrence_id,
            series["id"],
            series["group_id"],
            iso(slot),
            iso(slot),
            iso(slot + timedelta(minutes=duration)),
            1 if detached else 0,
            json.dumps(overrides) if overrides else None,
            iso(now) if notify else None,
            iso(now),
            iso(now),
        ),
    )
    occurrence = _occurrence_row(state, occurrence_id)
    if notify:
        _notify_invitees(state, occurrence, now)
    return occurrence


def materialize_series(state: ServerState, series: Any, now: datetime) -> None:
    """Creates the dates of a series that are within its lead time, and
    announces any existing date whose lead time has now arrived."""
    if series["ended_at"]:
        return
    rule = _json_object(series["recurrence"]) or None
    start = parse_utc(series["start_at"])
    duration = timedelta(minutes=series["duration_minutes"])
    window_end = now + timedelta(days=series["lead_days"])
    existing = {
        row["slot_key"]
        for row in state.db.execute("SELECT slot_key FROM group_session_occurrences WHERE session_id = ?", (series["id"],))
    }
    for slot in expand_slots(rule, start, window_end):
        if slot + duration <= now or iso(slot) in existing:
            continue
        _insert_occurrence(state, series, slot, now, notify=True)
    # Dates created early by an individual edit are announced once their lead time arrives.
    for occurrence in state.db.execute(
        "SELECT * FROM group_session_occurrences WHERE session_id = ? AND status = 'scheduled' AND notified_at IS NULL",
        (series["id"],),
    ).fetchall():
        if parse_utc(occurrence["start_at"]) - timedelta(days=series["lead_days"]) <= now:
            state.db.execute(
                "UPDATE group_session_occurrences SET notified_at = ? WHERE id = ?", (iso(now), occurrence["id"])
            )
            _notify_invitees(state, _occurrence_row(state, occurrence["id"]), now)


# --- The scheduler ----------------------------------------------------------------------------------


def run_due(state: ServerState, now: Optional[datetime] = None) -> Optional[datetime]:
    """Does everything that has come due, then returns the next moment anything
    will (None when nothing is pending). Idempotent: running late or twice is harmless."""
    moment = now or utcnow()
    next_due: List[datetime] = []

    def consider(when: Optional[datetime]) -> None:
        if when is not None and when > moment:
            next_due.append(when)

    for series in state.db.execute("SELECT * FROM group_sessions WHERE ended_at IS NULL").fetchall():
        materialize_series(state, series, moment)
        lead = timedelta(days=series["lead_days"])
        duration = timedelta(minutes=series["duration_minutes"])
        existing = {
            row["slot_key"]
            for row in state.db.execute("SELECT slot_key FROM group_session_occurrences WHERE session_id = ?", (series["id"],))
        }
        rule = _json_object(series["recurrence"]) or None
        start = parse_utc(series["start_at"])
        # The first slot not created yet becomes due when it enters the lead time.
        for slot in iter_slots(rule, start):
            if slot + duration > moment and iso(slot) not in existing:
                consider(slot - lead)
                break
        for occurrence in state.db.execute(
            "SELECT * FROM group_session_occurrences WHERE session_id = ? AND status = 'scheduled'", (series["id"],)
        ).fetchall():
            occ_start = parse_utc(occurrence["start_at"])
            occ_end = parse_utc(occurrence["end_at"])
            if occ_end <= moment:
                continue
            settings = effective(series, occurrence)
            if occurrence["notified_at"] is None:
                consider(occ_start - lead)
            if occurrence["reminder_sent_at"] is None and occurrence["notified_at"] is not None:
                anchor = occ_end if series["kind"] == "pbp" else occ_start
                remind_at = anchor - timedelta(minutes=series["reminder_minutes"])
                if remind_at <= moment:
                    _send_reminders(state, series, occurrence, moment)
                else:
                    consider(remind_at)
            cutoff = _cutoff_at(settings, occ_start)
            if cutoff is not None and occurrence["cutoff_checked_at"] is None:
                if cutoff <= moment:
                    _check_cutoff(state, series, occurrence, settings, moment)
                else:
                    consider(cutoff)
    state.db.commit()
    return min(next_due) if next_due else None


def _send_reminders(state: ServerState, series: Any, occurrence: Any, now: datetime) -> None:
    state.db.execute(
        "UPDATE group_session_occurrences SET reminder_sent_at = ? WHERE id = ?", (iso(now), occurrence["id"])
    )
    declined = {
        row["user_id"]
        for row in state.db.execute(
            "SELECT user_id FROM session_rsvps WHERE occurrence_id = ? AND response = 'decline'", (occurrence["id"],)
        )
    }
    for person in invitees(state, occurrence["group_id"]):
        if person["user_id"] not in declined:
            _notice(state, person["user_id"], occurrence["group_id"], "session_reminder", occurrence["id"], occurrence["revision"], now)


def _check_cutoff(state: ServerState, series: Any, occurrence: Any, settings: Dict[str, Any], now: datetime) -> None:
    state.db.execute(
        "UPDATE group_session_occurrences SET cutoff_checked_at = ? WHERE id = ?", (iso(now), occurrence["id"])
    )
    minimum = settings["min_players"]
    if minimum is None:
        return
    accepted = _rsvp_summary(state, occurrence["id"])["accept"]
    owner_id = _group_owner(state, occurrence["group_id"])
    if accepted < minimum and owner_id is not None:
        _notice(state, owner_id, occurrence["group_id"], "session_alert", occurrence["id"], occurrence["revision"], now)


def scheduler_loop(state: ServerState, shutdown_event: threading.Event) -> None:
    """Runs run_due, then sleeps until the next stored due time or until
    something that could change it calls wake(). There is no polling interval."""
    while not shutdown_event.is_set():
        _wake.clear()
        next_due: Optional[datetime] = None
        try:
            with state.lock:
                next_due = run_due(state)
                from . import signals

                from . import applications

                moment = utcnow()
                for pending in (signals.run_due(state, moment), applications.expire_due(state, moment)):
                    if pending is not None and (next_due is None or pending < next_due):
                        next_due = pending
        except Exception:  # pragma: no cover - a bad pass must never kill the thread
            logging.exception("Session scheduler pass failed")
        if shutdown_event.is_set():
            return
        if next_due is None:
            _wake.wait()
        else:
            seconds = max(0.0, (next_due - utcnow()).total_seconds())
            # Event.wait can't take an unbounded number; waking early just recomputes.
            _wake.wait(min(seconds, threading.TIMEOUT_MAX))


# --- Series API -------------------------------------------------------------------------------------


def list_sessions(state: ServerState, group_id: Optional[str], user: Optional[User]) -> Dict[str, Any]:
    row = _gm_access(state, group_id, user)
    now = utcnow()
    series_rows = state.db.execute(
        "SELECT * FROM group_sessions WHERE group_id = ? ORDER BY start_at", (row["id"],)
    ).fetchall()
    by_id = {s["id"]: s for s in series_rows}
    occurrences = [
        _serialize_occurrence(state, by_id[o["session_id"]], o)
        for o in state.db.execute(
            "SELECT * FROM group_session_occurrences WHERE group_id = ? ORDER BY start_at", (row["id"],)
        ).fetchall()
        if o["session_id"] in by_id
    ]
    return {
        "series": [_serialize_series(s, _next_slot(s, now)) for s in series_rows],
        "occurrences": occurrences,
    }


def preview_slots(data: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise AuthError("Preview settings are required")
    start = parse_utc(data.get("start_at"), "Start")
    rule = validate_recurrence(data.get("recurrence"))
    count = _required_int(data.get("count"), "Preview count", 1)
    duration = _required_int(data.get("duration_minutes"), "Duration", 1)
    slots = [
        {"startAt": iso(slot), "endAt": iso(slot + timedelta(minutes=duration))}
        for slot in islice(iter_slots(rule, start), count)
    ]
    return {"slots": slots}


def create_series(state: ServerState, group_id: Optional[str], user: Optional[User], data: Dict[str, Any]) -> Dict[str, Any]:
    row = _gm_access(state, group_id, user)
    cleaned = _clean_series(data, partial=False)
    if cleaned.get("campaign_id"):
        campaigns.require_open_campaign(state, row["id"], cleaned["campaign_id"])
    now = utcnow()
    session_id = _new_id("ses")
    state.db.execute(
        """
        INSERT INTO group_sessions
            (id, group_id, title, description, kind, start_at, duration_minutes, recurrence, location_text, location_url,
             min_players, max_players, rsvp_cutoff_minutes, allow_late_rsvp, lead_days, reminder_minutes, lock_posting,
             thread_ids, campaign_id, created_by, created_at, updated_at)
        VALUES (:id, :group_id, :title, :description, :kind, :start_at, :duration_minutes, :recurrence, :location_text,
                :location_url, :min_players, :max_players, :rsvp_cutoff_minutes, :allow_late_rsvp, :lead_days,
                :reminder_minutes, :lock_posting, :thread_ids, :campaign_id, :created_by, :created_at, :updated_at)
        """,
        {"campaign_id": None, **cleaned, "id": session_id, "group_id": row["id"], "created_by": user.id, "created_at": iso(now), "updated_at": iso(now)},
    )
    materialize_series(state, _series_row(state, session_id), now)
    state.db.commit()
    wake()
    series = _series_row(state, session_id)
    return _serialize_series(series, _next_slot(series, now))


def update_series(state: ServerState, group_id: Optional[str], user: Optional[User], session_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    row = _gm_access(state, group_id, user)
    series = _series_row(state, session_id, row["id"])
    cleaned = _clean_series(data, partial=True)
    # Only a change of campaign is checked, so a series in a campaign that has
    # since completed can still be edited.
    if cleaned.get("campaign_id") and cleaned["campaign_id"] != series["campaign_id"]:
        campaigns.require_open_campaign(state, row["id"], cleaned["campaign_id"])
    now = utcnow()
    if cleaned:
        assignments = ", ".join(f"{name} = :{name}" for name in cleaned)
        state.db.execute(
            f"UPDATE group_sessions SET {assignments}, updated_at = :updated_at WHERE id = :id",
            {**cleaned, "updated_at": iso(now), "id": session_id},
        )
    updated = _series_row(state, session_id)
    if "start_at" in cleaned or "recurrence" in cleaned:
        _reschedule_untouched(state, updated, now)
    elif "duration_minutes" in cleaned:
        # A longer or shorter window moves only the end; RSVPs and notices stand.
        for occurrence in state.db.execute(
            "SELECT * FROM group_session_occurrences WHERE session_id = ? AND detached = 0 AND end_at > ?",
            (session_id, iso(now)),
        ).fetchall():
            end = parse_utc(occurrence["start_at"]) + timedelta(minutes=updated["duration_minutes"])
            state.db.execute("UPDATE group_session_occurrences SET end_at = ? WHERE id = ?", (iso(end), occurrence["id"]))
    materialize_series(state, updated, now)
    if "max_players" in cleaned:
        _promote_series(state, session_id, now)
    state.db.commit()
    wake()
    return _serialize_series(updated, _next_slot(updated, now))


def _delete_occurrence_rows(state: ServerState, occurrence_ids: List[str]) -> None:
    for occurrence_id in occurrence_ids:
        state.db.execute("DELETE FROM session_rsvps WHERE occurrence_id = ?", (occurrence_id,))
        state.db.execute("DELETE FROM inbox_items WHERE occurrence_id = ?", (occurrence_id,))
        state.db.execute("DELETE FROM group_session_occurrences WHERE id = ?", (occurrence_id,))


def _reschedule_untouched(state: ServerState, series: Any, now: datetime) -> None:
    """A schedule edit drops this series' upcoming dates that nobody edited
    individually; materialize_series then recreates them from the new schedule
    with fresh notices (and so fresh RSVPs). Edited and cancelled dates stay."""
    rows = state.db.execute(
        "SELECT id FROM group_session_occurrences WHERE session_id = ? AND detached = 0 AND start_at > ?",
        (series["id"], iso(now)),
    ).fetchall()
    _delete_occurrence_rows(state, [r["id"] for r in rows])


def end_series(state: ServerState, group_id: Optional[str], user: Optional[User], session_id: str) -> Dict[str, Any]:
    row = _gm_access(state, group_id, user)
    series = _series_row(state, session_id, row["id"])
    now = utcnow()
    state.db.execute("UPDATE group_sessions SET ended_at = ?, updated_at = ? WHERE id = ?", (iso(now), iso(now), series["id"]))
    for occurrence in state.db.execute(
        "SELECT * FROM group_session_occurrences WHERE session_id = ? AND status = 'scheduled' AND start_at > ?",
        (series["id"], iso(now)),
    ).fetchall():
        _cancel(state, occurrence, now, ledger=False)
    state.db.commit()
    wake()
    ended = _series_row(state, session_id)
    return _serialize_series(ended, None)


def delete_series(state: ServerState, group_id: Optional[str], user: Optional[User], session_id: str) -> Dict[str, Any]:
    """Removes a session entirely: the series, every date (past ones too, so its
    history goes), their RSVPs, and the Inbox notices about them. Ending a series
    instead keeps the history."""
    row = _gm_access(state, group_id, user)
    series = _series_row(state, session_id, row["id"])
    occurrence_ids = [
        r["id"]
        for r in state.db.execute("SELECT id FROM group_session_occurrences WHERE session_id = ?", (series["id"],)).fetchall()
    ]
    _delete_occurrence_rows(state, occurrence_ids)
    state.db.execute("DELETE FROM group_sessions WHERE id = ?", (series["id"],))
    state.db.commit()
    wake()
    return {"deleted": series["id"], "dates": len(occurrence_ids)}


# --- Occurrences -----------------------------------------------------------------------------------------


def _reset_for_new_time(state: ServerState, occurrence_id: str, now: datetime) -> None:
    """A changed date or time clears every RSVP and sends a fresh notice."""
    state.db.execute("DELETE FROM session_rsvps WHERE occurrence_id = ?", (occurrence_id,))
    state.db.execute(
        "UPDATE group_session_occurrences SET revision = revision + 1, reminder_sent_at = NULL, cutoff_checked_at = NULL WHERE id = ?",
        (occurrence_id,),
    )
    occurrence = _occurrence_row(state, occurrence_id)
    if occurrence["notified_at"] is not None:
        _notify_invitees(state, occurrence, now)


def update_occurrence(
    state: ServerState, group_id: Optional[str], user: Optional[User], occurrence_id: str, data: Dict[str, Any]
) -> Dict[str, Any]:
    row = _gm_access(state, group_id, user)
    occurrence = _occurrence_row(state, occurrence_id)
    if occurrence["group_id"] != row["id"]:
        raise AuthError("Session date not found")
    series = _series_row(state, occurrence["session_id"])
    if occurrence["status"] == "cancelled":
        raise AuthError("This date was cancelled")
    if not isinstance(data, dict):
        raise AuthError("Settings are required")
    now = utcnow()
    overrides = _json_object(occurrence["overrides"])
    start_at = occurrence["start_at"]
    time_changed = False
    for name, value in data.items():
        if name == "start_at":
            new_start = iso(parse_utc(value, "Start"))
            if new_start != start_at:
                start_at = new_start
                time_changed = True
        elif name in OVERRIDABLE:
            overrides[name] = _clean_override(name, value)
        else:
            raise AuthError(f"{name} can't be changed on a single date")
    merged = effective(series, {"overrides": json.dumps(overrides)})
    if merged["min_players"] is not None and merged["max_players"] is not None and merged["max_players"] < merged["min_players"]:
        raise AuthError("The maximum players can't be below the minimum")
    duration = merged["duration_minutes"]
    end_at = iso(parse_utc(start_at) + timedelta(minutes=duration))
    state.db.execute(
        """
        UPDATE group_session_occurrences
        SET start_at = ?, end_at = ?, overrides = ?, detached = 1, updated_at = ?
        WHERE id = ?
        """,
        (start_at, end_at, json.dumps(overrides) if overrides else None, iso(now), occurrence_id),
    )
    if time_changed:
        from . import signals

        signals.on_rescheduled(state, series, occurrence, effective(series, occurrence), now)
        _reset_for_new_time(state, occurrence_id, now)
    elif "max_players" in data:
        _promote_waitlist(state, occurrence_id, now)
    state.db.commit()
    wake()
    return _serialize_occurrence(state, series, _occurrence_row(state, occurrence_id))


def _cancel(state: ServerState, occurrence: Any, now: datetime, *, ledger: bool = True) -> None:
    """`ledger=False` is for ending a series, which isn't counted against the GM."""
    if ledger and occurrence["status"] == "scheduled":
        from . import signals

        series = _series_row(state, occurrence["session_id"])
        signals.on_cancelled(state, series, occurrence, effective(series, occurrence), now)
    state.db.execute(
        """
        UPDATE group_session_occurrences
        SET status = 'cancelled', detached = 1, revision = revision + 1, updated_at = ?
        WHERE id = ?
        """,
        (iso(now), occurrence["id"]),
    )
    if occurrence["notified_at"] is not None:
        _notify_invitees(state, _occurrence_row(state, occurrence["id"]), now)


def cancel_occurrence(state: ServerState, group_id: Optional[str], user: Optional[User], occurrence_id: str) -> Dict[str, Any]:
    row = _gm_access(state, group_id, user)
    occurrence = _occurrence_row(state, occurrence_id)
    if occurrence["group_id"] != row["id"]:
        raise AuthError("Session date not found")
    _cancel(state, occurrence, utcnow())
    state.db.commit()
    wake()
    return _serialize_occurrence(state, _series_row(state, occurrence["session_id"]), _occurrence_row(state, occurrence_id))


def ensure_occurrence(
    state: ServerState, group_id: Optional[str], user: Optional[User], session_id: str, slot_key: str
) -> Dict[str, Any]:
    """Creates a not-yet-announced date of a series early so the GM can edit or
    cancel just that one; it is announced when its lead time arrives."""
    row = _gm_access(state, group_id, user)
    series = _series_row(state, session_id, row["id"])
    slot = parse_utc(slot_key, "Date")
    rule = _json_object(series["recurrence"]) or None
    if iso(slot) not in {iso(s) for s in expand_slots(rule, parse_utc(series["start_at"]), slot)}:
        raise AuthError("That isn't a date of this session")
    existing = state.db.execute(
        "SELECT * FROM group_session_occurrences WHERE session_id = ? AND slot_key = ?", (session_id, iso(slot))
    ).fetchone()
    now = utcnow()
    occurrence = existing or _insert_occurrence(state, series, slot, now, notify=False, detached=True)
    state.db.commit()
    wake()
    return _serialize_occurrence(state, series, occurrence)


def set_history(
    state: ServerState, group_id: Optional[str], user: Optional[User], occurrence_id: str, data: Dict[str, Any]
) -> Dict[str, Any]:
    row = _gm_access(state, group_id, user)
    occurrence = _occurrence_row(state, occurrence_id)
    if occurrence["group_id"] != row["id"]:
        raise AuthError("Session date not found")
    fields = {
        "inworld_from_day": _day(data, "inworldFromDay"),
        "inworld_to_day": _day(data, "inworldToDay"),
        "recap_thread_id": _optional_id(state, data, "recapThreadId", "chat_threads", row["id"]),
        "recap_page_id": _optional_page(state, data, "recapPageId"),
    }
    if (
        fields["inworld_from_day"] is not None
        and fields["inworld_to_day"] is not None
        and fields["inworld_to_day"] < fields["inworld_from_day"]
    ):
        raise AuthError("The in-world end can't be before its start")
    state.db.execute(
        """
        UPDATE group_session_occurrences
        SET inworld_from_day = :inworld_from_day, inworld_to_day = :inworld_to_day,
            recap_thread_id = :recap_thread_id, recap_page_id = :recap_page_id, updated_at = :updated_at
        WHERE id = :id
        """,
        {**fields, "updated_at": iso(utcnow()), "id": occurrence_id},
    )
    state.db.commit()
    return _serialize_occurrence(state, _series_row(state, occurrence["session_id"]), _occurrence_row(state, occurrence_id))


def _day(data: Dict[str, Any], key: str) -> Optional[int]:
    if key not in data:
        raise AuthError(f"{key} is required")
    value = data[key]
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool):
        raise AuthError("In-world days are whole numbers")
    return value


def _optional_id(state: ServerState, data: Dict[str, Any], key: str, table: str, group_id: str) -> Optional[str]:
    if key not in data:
        raise AuthError(f"{key} is required")
    value = data[key]
    if not value:
        return None
    found = state.db.execute(f"SELECT 1 FROM {table} WHERE id = ? AND group_id = ?", (str(value), group_id)).fetchone()
    if not found:
        raise AuthError("That thread isn't in this group")
    return str(value)


def _optional_page(state: ServerState, data: Dict[str, Any], key: str) -> Optional[str]:
    if key not in data:
        raise AuthError(f"{key} is required")
    value = data[key]
    if not value:
        return None
    found = state.db.execute("SELECT 1 FROM library_items WHERE kind = 'journal' AND id = ?", (str(value),)).fetchone()
    if not found:
        raise AuthError("That Repository page doesn't exist")
    return str(value)


# --- RSVPs ----------------------------------------------------------------------------------------------


def _active_character(state: ServerState, group_id: str, user_id: int) -> Optional[Dict[str, Any]]:
    for person in invitees(state, group_id):
        if person["user_id"] == user_id:
            return person
    return None


def _member_access(state: ServerState, user: Optional[User], group_id: str) -> Dict[str, Any]:
    if not user:
        raise AuthError("Authentication required")
    row, _ = _resolve_group_access(state, group_id, user)
    return row


def _promote_waitlist(state: ServerState, occurrence_id: str, now: datetime) -> None:
    """Moves waitlisted players to accepted, longest-waiting first, while there is
    room, and tells each one in the Inbox. Called wherever a place can open up."""
    occurrence = _occurrence_row(state, occurrence_id)
    if occurrence["status"] != "scheduled" or parse_utc(occurrence["end_at"]) <= now:
        return
    cap = effective(_series_row(state, occurrence["session_id"]), occurrence)["max_players"]
    accepted = _rsvp_summary(state, occurrence_id)["accept"]
    waiting = state.db.execute(
        "SELECT user_id FROM session_rsvps WHERE occurrence_id = ? AND response = 'waitlist' ORDER BY responded_at, rowid",
        (occurrence_id,),
    ).fetchall()
    for entry in waiting:
        if cap is not None and accepted >= cap:
            break
        state.db.execute(
            "UPDATE session_rsvps SET response = 'accept', responded_at = ?, set_by = NULL WHERE occurrence_id = ? AND user_id = ?",
            (iso(now), occurrence_id, entry["user_id"]),
        )
        accepted += 1
        # A player can be promoted more than once; replace the old notice so the new one is unread.
        state.db.execute(
            "DELETE FROM inbox_items WHERE user_id = ? AND occurrence_id = ? AND reason = 'session_promoted'",
            (entry["user_id"], occurrence_id),
        )
        _notice(state, entry["user_id"], occurrence["group_id"], "session_promoted", occurrence_id, occurrence["revision"], now)


def _promote_series(state: ServerState, session_id: str, now: datetime) -> None:
    for occurrence in state.db.execute(
        "SELECT id FROM group_session_occurrences WHERE session_id = ? AND status = 'scheduled' AND end_at > ?",
        (session_id, iso(now)),
    ).fetchall():
        _promote_waitlist(state, occurrence["id"], now)


def _write_rsvp(state: ServerState, occurrence_id: str, person: Dict[str, Any], response: Optional[str], now: datetime, set_by: Optional[int]) -> None:
    if response is None:
        state.db.execute("DELETE FROM session_rsvps WHERE occurrence_id = ? AND user_id = ?", (occurrence_id, person["user_id"]))
        return
    state.db.execute(
        """
        INSERT INTO session_rsvps (occurrence_id, user_id, character_id, character_name, response, responded_at, set_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(occurrence_id, user_id) DO UPDATE SET
            character_id = excluded.character_id, character_name = excluded.character_name,
            response = excluded.response, responded_at = excluded.responded_at, set_by = excluded.set_by
        """,
        (occurrence_id, person["user_id"], person["character_id"], person["character_name"], response, iso(now), set_by),
    )
    if response == "accept":
        from . import signals

        signals.on_accepted(state, occurrence_id, person["user_id"], now)


def rsvp(state: ServerState, user: Optional[User], occurrence_id: str, response: Any) -> Dict[str, Any]:
    if response not in RESPONSES:
        raise AuthError("Respond with accept, decline or tentative")
    occurrence = _occurrence_row(state, occurrence_id)
    row = _member_access(state, user, occurrence["group_id"])
    if _is_gm(row, user):
        raise AuthError("The GM doesn't RSVP; use the Sessions list to respond for a player")
    series = _series_row(state, occurrence["session_id"])
    settings = effective(series, occurrence)
    now = utcnow()
    if occurrence["status"] != "scheduled":
        raise AuthError("This date was cancelled")
    if parse_utc(occurrence["end_at"]) <= now:
        raise AuthError("This session has already ended")
    person = _active_character(state, occurrence["group_id"], user.id)
    if not person:
        raise AuthError("Make a character active in this group to respond")
    cutoff = _cutoff_at(settings, parse_utc(occurrence["start_at"]))
    if cutoff is not None and now >= cutoff and not settings["allow_late_rsvp"]:
        raise AuthError("RSVPs for this session have closed")
    current = state.db.execute(
        "SELECT response FROM session_rsvps WHERE occurrence_id = ? AND user_id = ?", (occurrence_id, user.id)
    ).fetchone()
    held = current["response"] if current else None
    cap = settings["max_players"]
    accepted = _rsvp_summary(state, occurrence_id)["accept"]
    if response == "accept" and cap is not None and held != "accept" and accepted >= cap:
        raise AuthError("This session is full; join the waitlist instead")
    if response == "waitlist":
        # Only a full session has a waitlist; a place you hold doesn't count against you.
        if cap is None or accepted - (1 if held == "accept" else 0) < cap:
            raise AuthError("There is still room; accept instead")
    if not (response == "waitlist" and held == "waitlist"):
        # Re-choosing the waitlist keeps your place in the queue.
        _write_rsvp(state, occurrence_id, person, response, now, None)
    _promote_waitlist(state, occurrence_id, now)
    state.db.commit()
    return get_occurrence(state, user, occurrence_id)


def rsvp_for(
    state: ServerState, user: Optional[User], occurrence_id: str, target_user_id: Any, response: Any
) -> Dict[str, Any]:
    """The GM responding for a player. Skips the cutoff and the cap, and a null
    response clears the player's answer."""
    if response is not None and response not in RESPONSES:
        raise AuthError("Respond with accept, decline, tentative, or clear")
    occurrence = _occurrence_row(state, occurrence_id)
    row = _member_access(state, user, occurrence["group_id"])
    if not _is_gm(row, user):
        raise AuthError("Only the GM can respond for a player")
    if not isinstance(target_user_id, int) or isinstance(target_user_id, bool):
        raise AuthError("Choose a player")
    person = _active_character(state, occurrence["group_id"], target_user_id)
    if not person:
        raise AuthError("That player has no active character in this group")
    moment = utcnow()
    _write_rsvp(state, occurrence_id, person, response, moment, user.id)
    _promote_waitlist(state, occurrence_id, moment)
    state.db.commit()
    return get_occurrence(state, user, occurrence_id)


def get_occurrence(state: ServerState, user: Optional[User], occurrence_id: str) -> Dict[str, Any]:
    """A date's current details and who has answered; what an Inbox notice shows."""
    occurrence = _occurrence_row(state, occurrence_id)
    row = _member_access(state, user, occurrence["group_id"])
    series = _series_row(state, occurrence["session_id"])
    data = _serialize_occurrence(state, series, occurrence)
    now = utcnow()
    gm = _is_gm(row, user)
    people = invitees(state, occurrence["group_id"])
    responses = {
        r["user_id"]: r
        for r in state.db.execute("SELECT * FROM session_rsvps WHERE occurrence_id = ?", (occurrence_id,)).fetchall()
    }
    usernames: Dict[int, str] = {}
    if responses:
        marks = ",".join("?" for _ in responses)
        usernames = {
            r["id"]: r["username"] for r in state.db.execute(f"SELECT id, username FROM users WHERE id IN ({marks})", tuple(responses))
        }
    attendees: List[Dict[str, Any]] = []
    listed = set()

    from . import signals

    attendance = signals.attendance_by_user(state, occurrence_id)

    def label(user_id: int, username: str, character: Optional[str]) -> Dict[str, Any]:
        reply = responses.get(user_id)
        return {
            "attendance": (attendance.get(user_id) or {}).get("outcome"),
            "attendanceAuto": (attendance.get(user_id) or {}).get("auto", False),
            "userId": user_id,
            "username": username,
            "characterName": (reply["character_name"] if reply else None) or character or "",
            "response": reply["response"] if reply else None,
            "respondedAt": reply["responded_at"] if reply else None,
            "setByGm": bool(reply and reply["set_by"]),
        }

    for person in people:
        listed.add(person["user_id"])
        attendees.append(label(person["user_id"], person["username"], person["character_name"]))
    # Someone who answered and is no longer an invitee still shows.
    for user_id in responses:
        if user_id not in listed:
            attendees.append(label(user_id, usernames.get(user_id, ""), None))
    settings = effective(series, occurrence)
    cutoff = _cutoff_at(settings, parse_utc(occurrence["start_at"]))
    ended = parse_utc(occurrence["end_at"]) <= now
    closed = cutoff is not None and now >= cutoff and not settings["allow_late_rsvp"]
    full = settings["max_players"] is not None and data["counts"]["accept"] >= settings["max_players"]
    mine = responses.get(user.id) if user else None
    waitlist_order = [
        r["user_id"]
        for r in sorted(
            (r for r in responses.values() if r["response"] == "waitlist"), key=lambda r: r["responded_at"]
        )
    ]
    my_person = _active_character(state, occurrence["group_id"], user.id) if user else None
    characters = [
        {"id": m["id"], "name": m["name"], "active": m["active"]}
        for m in _own_characters(state, occurrence["group_id"], user.id)
    ] if user else []
    data.update(
        {
            "groupName": row["name"],
            "attendees": attendees,
            "ended": ended,
            "rsvpClosed": closed,
            "rsvpCutoffAt": iso(cutoff) if cutoff else None,
            "full": full,
            "viewer": {
                "isGm": gm,
                "response": mine["response"] if mine else None,
                "waitlistPosition": waitlist_order.index(user.id) + 1 if user and user.id in waitlist_order else None,
                "hasActiveCharacter": bool(my_person),
                "canRespond": bool(my_person) and not gm and not ended and occurrence["status"] == "scheduled" and not closed,
                "characters": characters,
            },
        }
    )
    return data


def _own_characters(state: ServerState, group_id: str, user_id: int) -> List[Dict[str, Any]]:
    rows = state.db.execute(
        """
        SELECT gm.content_id AS id, li.title AS name, gm.active AS active
        FROM group_members AS gm
        JOIN library_items AS li ON li.kind = 'character' AND li.id = gm.content_id
        WHERE gm.group_id = ? AND gm.content_type = 'character' AND li.owner_id = ?
        ORDER BY li.title COLLATE NOCASE
        """,
        (group_id, user_id),
    ).fetchall()
    return [{"id": r["id"], "name": r["name"] or r["id"], "active": r["active"] != 0} for r in rows]


def inbox_summary(state: ServerState, occurrence_id: str, user_id: int) -> Optional[Dict[str, Any]]:
    """The short form of a date shown in the Inbox list; the detail pane reads
    get_occurrence, so a notice is always as current as the session."""
    occurrence = state.db.execute("SELECT * FROM group_session_occurrences WHERE id = ?", (occurrence_id,)).fetchone()
    if not occurrence:
        return None
    series = state.db.execute("SELECT * FROM group_sessions WHERE id = ?", (occurrence["session_id"],)).fetchone()
    if not series:
        return None
    settings = effective(series, occurrence)
    mine = state.db.execute(
        "SELECT response FROM session_rsvps WHERE occurrence_id = ? AND user_id = ?", (occurrence_id, user_id)
    ).fetchone()
    return {
        "occurrenceId": occurrence_id,
        "title": settings["title"],
        "kind": series["kind"],
        "startAt": occurrence["start_at"],
        "endAt": occurrence["end_at"],
        "status": occurrence["status"],
        "myResponse": mine["response"] if mine else None,
        "counts": _rsvp_summary(state, occurrence_id),
    }


def decline_range(state: ServerState, user: Optional[User], group_id: Optional[str], from_at: Any, to_at: Any) -> Dict[str, Any]:
    """Declines every session in a stretch of time in one action, including
    dates the scheduler creates later."""
    row = _member_access(state, user, group_id or "")
    if _is_gm(row, user):
        raise AuthError("The GM doesn't RSVP")
    start, end = parse_utc(from_at, "From"), parse_utc(to_at, "To")
    if end < start:
        raise AuthError("The range ends before it starts")
    now = utcnow()
    person = _active_character(state, row["id"], user.id) or {"user_id": user.id, "character_id": None, "character_name": None}
    state.db.execute(
        "INSERT INTO session_decline_ranges (group_id, user_id, from_at, to_at, created_at) VALUES (?, ?, ?, ?, ?)",
        (row["id"], user.id, iso(start), iso(end), iso(now)),
    )
    declined = 0
    for occurrence in state.db.execute(
        """
        SELECT id FROM group_session_occurrences
        WHERE group_id = ? AND status = 'scheduled' AND start_at >= ? AND start_at <= ? AND end_at > ?
        """,
        (row["id"], iso(start), iso(end), iso(now)),
    ).fetchall():
        _write_rsvp(state, occurrence["id"], person, "decline", now, None)
        _promote_waitlist(state, occurrence["id"], now)
        declined += 1
    state.db.commit()
    return {"declined": declined}


# --- Posting lock ---------------------------------------------------------------------------------------------


def posting_locked(state: ServerState, group_id: str, thread_id: str, now: Optional[datetime] = None) -> bool:
    """True when a session that locks this thread has no open date covering now."""
    moment = iso(now or utcnow())
    locking = [
        s
        for s in state.db.execute(
            "SELECT * FROM group_sessions WHERE group_id = ? AND lock_posting = 1 AND ended_at IS NULL", (group_id,)
        ).fetchall()
        if thread_id in _json_list(s["thread_ids"])
    ]
    if not locking:
        return False
    for series in locking:
        for occurrence in state.db.execute(
            "SELECT * FROM group_session_occurrences WHERE session_id = ? AND status = 'scheduled' AND start_at <= ? AND end_at > ?",
            (series["id"], moment, moment),
        ).fetchall():
            if thread_id in effective(series, occurrence)["thread_ids"]:
                return False
    return True


def delete_group_sessions(state: ServerState, group_id: str) -> None:
    state.db.execute(
        "DELETE FROM session_rsvps WHERE occurrence_id IN (SELECT id FROM group_session_occurrences WHERE group_id = ?)",
        (group_id,),
    )
    for table in ("group_session_occurrences", "group_sessions", "session_decline_ranges"):
        state.db.execute(f"DELETE FROM {table} WHERE group_id = ?", (group_id,))
