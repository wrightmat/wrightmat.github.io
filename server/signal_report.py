from __future__ import annotations

import calendar
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from .auth import AuthError, User
from .shared_lists import data_path
from .profiles import can_view_history
from .signals import record
from .state import ServerState

# The suite-wide standards: "recent" is the last year, and a rate needs at least
# this many cases behind it before it is shown.
RECENT_WINDOW_MONTHS = 12
MIN_SAMPLE = 5

# Observed signals are computed from the ledger on request and never combined:
# each is returned on its own, as a rate with its numerator and denominator, or
# as a bare count when the sample is below the minimum sample.


def _months_before(moment: datetime, months: int) -> datetime:
    index = moment.year * 12 + moment.month - 1 - months
    year, month = divmod(index, 12)
    month += 1
    return moment.replace(year=year, month=month, day=min(moment.day, calendar.monthrange(year, month)[1]))


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace(" ", "T")[:19])


def _rate(numerator: int, denominator: int) -> Dict[str, Any]:
    """A rate with its denominator; below the minimum sample only the count is given."""
    if denominator < MIN_SAMPLE:
        return {"count": denominator, "belowMinimum": True}
    return {"value": numerator / denominator, "numerator": numerator, "denominator": denominator, "belowMinimum": False}


def _period(state: ServerState, user_id: int, since: Optional[str]) -> Dict[str, Any]:
    window = " AND occurred_at >= ?" if since else ""
    extra = (since,) if since else ()

    def rows(sql: str, *args: Any) -> List[Any]:
        return state.db.execute(f"SELECT * FROM signal_events WHERE user_id = ? AND {sql}{window}", (user_id, *args, *extra)).fetchall()

    def count(sql: str, *args: Any) -> int:
        return state.db.execute(
            f"SELECT COUNT(*) FROM signal_events WHERE user_id = ? AND {sql}{window}", (user_id, *args, *extra)
        ).fetchone()[0]

    played = rows("kind = 'played' AND outcome != 'no_show'")
    ran = rows("kind = 'ran'")
    attended, no_show, contested = (count("kind = 'played' AND outcome = ?", o) for o in ("attended", "no_show", "contested"))
    cancelled, late_cancelled = count("kind = 'cancelled'"), count("kind = 'cancelled' AND late = 1")
    reschedules, late_reschedules = count("kind = 'rescheduled'"), count("kind = 'rescheduled' AND late = 1")

    def by_system(items: List[Any]) -> List[Dict[str, Any]]:
        tally: Dict[Optional[str], int] = {}
        for item in items:
            tally[item["system_id"]] = tally.get(item["system_id"], 0) + 1
        return [{"systemId": key, "count": value} for key, value in sorted(tally.items(), key=lambda kv: -kv[1])]

    def retention(role: str) -> Dict[str, Any]:
        participations = count("kind = 'participation' AND role = ?", role)
        departures = count("kind = 'departure' AND role = ?", role)
        result = _rate(participations - departures, participations)
        result["departures"] = departures
        return result

    return {
        "player": {
            "sessionCount": len(played),
            "bySystem": by_system(played),
            "reliability": {**_rate(no_show, attended + no_show), "contested": contested},
            "retention": retention("player"),
        },
        "gm": {
            "sessionCount": len(ran),
            "bySystem": by_system(ran),
            "reliability": {
                **_rate(cancelled, len(ran) + cancelled),
                "lateCancellations": late_cancelled,
                "reschedules": reschedules,
                "lateReschedules": late_reschedules,
            },
            "retention": retention("gm"),
        },
    }


def _endorsement_items(state: ServerState) -> List[Dict[str, Any]]:
    path = data_path(state, "endorsements")
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("items") or []
    except (OSError, json.JSONDecodeError):
        return []


def _endorsement_counts(state: ServerState, user_id: int) -> Dict[str, List[Dict[str, Any]]]:
    names = {item["id"]: item["name"] for item in _endorsement_items(state)}
    result: Dict[str, List[Dict[str, Any]]] = {"player": [], "gm": []}
    for row in state.db.execute(
        """
        SELECT role, tag_id, COUNT(*) AS total FROM signal_events
        WHERE user_id = ? AND kind = 'endorsement' GROUP BY role, tag_id ORDER BY total DESC
        """,
        (user_id,),
    ):
        result[row["role"]].append({"tagId": row["tag_id"], "name": names.get(row["tag_id"], row["tag_id"]), "count": row["total"]})
    return result


def get_signals(state: ServerState, viewer: Optional[User], subject_id: int) -> Dict[str, Any]:
    if not viewer:
        raise AuthError("Sign in to view signals")
    subject = state.db.execute("SELECT id, username, created_at FROM users WHERE id = ?", (subject_id,)).fetchone()
    if not subject:
        raise AuthError("Person not found")
    if not can_view_history(state, viewer, subject_id):
        raise AuthError("This person's history is private")
    now = datetime.utcnow()
    since = _months_before(now, RECENT_WINDOW_MONTHS).replace(microsecond=0).isoformat()
    years = max(0, (now - _parse(subject["created_at"])).days // 365)
    return {
        "userId": subject["id"],
        "username": subject["username"],
        "tenure": {"years": years, "lessThanOneYear": years < 1},
        "recentWindowMonths": RECENT_WINDOW_MONTHS,
        "minSampleSize": MIN_SAMPLE,
        "recent": _period(state, subject_id, since),
        "lifetime": _period(state, subject_id, None),
        "endorsements": _endorsement_counts(state, subject_id),
    }


# --- Endorsements --------------------------------------------------------------------------


def _shared_tables(state: ServerState, giver_id: int) -> List[Any]:
    """Every (recipient, role, scope) where the giver and recipient were both on the
    ledger for one date and neither was a no-show."""
    return state.db.execute(
        """
        SELECT b.user_id AS recipient, CASE b.kind WHEN 'ran' THEN 'gm' ELSE 'player' END AS recipient_role,
               a.scope_key AS scope_key, MIN(a.group_id) AS group_id, MIN(a.session_id) AS session_id,
               MIN(a.campaign_id) AS campaign_id
        FROM signal_events AS a
        JOIN signal_events AS b ON a.occurrence_id = b.occurrence_id AND a.user_id != b.user_id
        WHERE a.user_id = ? AND a.kind IN ('ran', 'played') AND b.kind IN ('ran', 'played')
          AND COALESCE(a.outcome, '') != 'no_show' AND COALESCE(b.outcome, '') != 'no_show'
          AND a.scope_key IS NOT NULL
        GROUP BY b.user_id, recipient_role, a.scope_key
        """,
        (giver_id,),
    ).fetchall()


def _already(state: ServerState, giver_id: int, recipient: int, scope_key: str) -> bool:
    return (
        state.db.execute(
            "SELECT 1 FROM signal_events WHERE kind = 'endorsement' AND user_id = ? AND other_user_id = ? AND scope_key = ?",
            (recipient, giver_id, scope_key),
        ).fetchone()
        is not None
    )


def _scope_label(state: ServerState, row: Any) -> str:
    if row["campaign_id"]:
        found = state.db.execute(
            "SELECT label FROM group_members WHERE content_type = 'campaign' AND content_id = ?", (row["campaign_id"],)
        ).fetchone()
        if found:
            return found["label"]
    found = state.db.execute("SELECT title FROM group_sessions WHERE id = ?", (row["session_id"],)).fetchone()
    return found["title"] if found else "A past session"


def list_endorsable(state: ServerState, giver: Optional[User]) -> Dict[str, Any]:
    """Who the viewer can still endorse, and for which campaign or session."""
    if not giver:
        raise AuthError("Sign in to endorse")
    usernames: Dict[int, str] = {}
    people = []
    for row in _shared_tables(state, giver.id):
        if _already(state, giver.id, row["recipient"], row["scope_key"]):
            continue
        if row["recipient"] not in usernames:
            found = state.db.execute("SELECT username FROM users WHERE id = ?", (row["recipient"],)).fetchone()
            usernames[row["recipient"]] = found["username"] if found else ""
        people.append(
            {
                "userId": row["recipient"],
                "username": usernames[row["recipient"]],
                "role": row["recipient_role"],
                "scopeKey": row["scope_key"],
                "groupId": row["group_id"],
                "label": _scope_label(state, row),
            }
        )
    return {"people": people}


def endorse(state: ServerState, giver: Optional[User], recipient_id: Any, scope_key: Any, tag_id: Any) -> Dict[str, Any]:
    if not giver:
        raise AuthError("Sign in to endorse")
    if not isinstance(recipient_id, int) or isinstance(recipient_id, bool) or not isinstance(scope_key, str) or not isinstance(tag_id, str):
        raise AuthError("Choose a person, a campaign or session, and a tag")
    match = next(
        (r for r in _shared_tables(state, giver.id) if r["recipient"] == recipient_id and r["scope_key"] == scope_key), None
    )
    if not match:
        raise AuthError("You can only endorse someone you've shared a table with")
    if _already(state, giver.id, recipient_id, scope_key):
        raise AuthError("You've already endorsed them for this one")
    tags = {t["id"]: t for t in _endorsement_items(state)}
    tag = tags.get(tag_id)
    if not tag or tag["appliesTo"] not in (match["recipient_role"], "both"):
        raise AuthError("That tag doesn't apply here")
    record(
        state, user_id=recipient_id, role=match["recipient_role"], kind="endorsement", now=datetime.utcnow(), group_id=match["group_id"],
        campaign_id=match["campaign_id"], session_id=match["session_id"], other_user_id=giver.id, scope_key=scope_key, tag_id=tag_id,
    )
    state.db.commit()
    return {"ok": True}

