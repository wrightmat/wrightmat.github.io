from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from .auth import AuthError, User
from .state import ServerState

# The append-only ledger behind the community's observed signals. A row is
# written when something happens (a session ran, a date was cancelled, a player
# left) and is never deleted, so the record outlives the sessions and groups it
# came from. The one field that changes afterwards is a `played` row's outcome.
PLAYED_OUTCOMES = ("attended", "no_show", "contested")


def _iso(moment: datetime) -> str:
    return moment.replace(microsecond=0).isoformat()


def record(
    state: ServerState,
    *,
    user_id: int,
    role: str,
    kind: str,
    now: datetime,
    group_id: Optional[str] = None,
    campaign_id: Optional[str] = None,
    session_id: Optional[str] = None,
    occurrence_id: Optional[str] = None,
    system_id: Optional[str] = None,
    other_user_id: Optional[int] = None,
    scope_key: Optional[str] = None,
    tag_id: Optional[str] = None,
    outcome: Optional[str] = None,
    late: bool = False,
    auto: bool = False,
) -> bool:
    """Inserts one ledger row; a repeat of a row the unique indexes forbid is ignored. True if written."""
    cursor = state.db.execute(
        """
        INSERT OR IGNORE INTO signal_events
            (user_id, role, kind, group_id, campaign_id, session_id, occurrence_id, system_id, other_user_id,
             scope_key, tag_id, outcome, late, auto, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id, role, kind, group_id, campaign_id, session_id, occurrence_id, system_id, other_user_id,
            scope_key, tag_id, outcome, 1 if late else 0, 1 if auto else 0, _iso(now),
        ),
    )
    return cursor.rowcount > 0


def _group(state: ServerState, group_id: str) -> Dict[str, Any]:
    from .groups import _load_group_row

    return _load_group_row(state, group_id) or {}


def _context(state: ServerState, series: Any) -> Tuple[int, Dict[str, Any]]:
    """The GM's user id and the columns every session-derived row shares."""
    group = _group(state, series["group_id"])
    return group["owner_id"], {
        "group_id": series["group_id"],
        "campaign_id": series["campaign_id"],
        "session_id": series["id"],
        "system_id": group.get("system_id"),
        "scope_key": series["campaign_id"] or series["id"],
    }


# --- Hooks called by sessions.py and groups.py ---------------------------------------------


def on_cancelled(state: ServerState, series: Any, occurrence: Any, settings: Dict[str, Any], now: datetime) -> None:
    """A GM cancelled an announced date that hasn't ended. Cancelling because too
    few players accepted isn't counted as late."""
    from . import sessions

    if occurrence["notified_at"] is None or sessions.parse_utc(occurrence["end_at"]) <= now:
        return
    cutoff = sessions._cutoff_at(settings, sessions.parse_utc(occurrence["start_at"]))
    accepted = sessions._rsvp_summary(state, occurrence["id"])["accept"]
    below = settings["min_players"] is not None and accepted < settings["min_players"]
    gm, context = _context(state, series)
    record(
        state, user_id=gm, role="gm", kind="cancelled", now=now, occurrence_id=occurrence["id"],
        outcome="below_minimum" if below else "other",
        late=bool(cutoff is not None and now >= cutoff and not below), **context,
    )


def on_rescheduled(state: ServerState, series: Any, occurrence: Any, settings: Dict[str, Any], now: datetime) -> None:
    """The start time of an announced date changed; late is judged against the old time."""
    from . import sessions

    if occurrence["notified_at"] is None:
        return
    cutoff = sessions._cutoff_at(settings, sessions.parse_utc(occurrence["start_at"]))
    gm, context = _context(state, series)
    record(
        state, user_id=gm, role="gm", kind="rescheduled", now=now, occurrence_id=occurrence["id"],
        late=bool(cutoff is not None and now >= cutoff), **context,
    )


def on_accepted(state: ServerState, occurrence_id: str, user_id: int, now: datetime) -> None:
    """A player's first Accepted session in a campaign starts counting toward retention."""
    row = state.db.execute(
        """
        SELECT s.* FROM group_session_occurrences AS o JOIN group_sessions AS s ON s.id = o.session_id WHERE o.id = ?
        """,
        (occurrence_id,),
    ).fetchone()
    if not row or not row["campaign_id"]:
        return
    _participation(state, row["group_id"], row["campaign_id"], user_id, now, session_id=row["id"])


def _participation(state: ServerState, group_id: str, campaign_id: str, user_id: int, now: datetime, session_id: Optional[str] = None) -> None:
    group = _group(state, group_id)
    gm = group.get("owner_id")
    if gm is None or gm == user_id:
        return
    for owner, role, other in ((user_id, "player", gm), (gm, "gm", user_id)):
        record(
            state, user_id=owner, role=role, kind="participation", now=now, group_id=group_id, campaign_id=campaign_id,
            session_id=session_id, system_id=group.get("system_id"), other_user_id=other, scope_key=campaign_id,
        )


def on_player_left(state: ServerState, group_id: str, user_id: int, now: datetime) -> None:
    """A voluntary departure while a campaign is running counts against both sides.
    A removal by the GM never comes through here."""
    group = _group(state, group_id)
    gm = group.get("owner_id")
    if gm is None:
        return
    for campaign in state.db.execute(
        "SELECT content_id FROM group_members WHERE group_id = ? AND content_type = 'campaign' AND status IN ('active', 'on_hiatus')",
        (group_id,),
    ).fetchall():
        campaign_id = campaign["content_id"]
        _participation(state, group_id, campaign_id, user_id, now)
        for owner, role, other in ((user_id, "player", gm), (gm, "gm", user_id)):
            record(
                state, user_id=owner, role=role, kind="departure", now=now, group_id=group_id, campaign_id=campaign_id,
                system_id=group.get("system_id"), other_user_id=other, scope_key=campaign_id,
            )


# --- Scheduler pass ---------------------------------------------------------------------------


def _unrecorded_ended(state: ServerState, moment: datetime, ended: bool) -> List[Any]:
    comparison = "<=" if ended else ">"
    return state.db.execute(
        f"""
        SELECT o.* FROM group_session_occurrences AS o
        WHERE o.status = 'scheduled' AND o.notified_at IS NOT NULL AND o.end_at {comparison} ?
          AND NOT EXISTS (SELECT 1 FROM signal_events AS e WHERE e.occurrence_id = o.id AND e.kind = 'ran')
        """,
        (_iso(moment),),
    ).fetchall()


def _posted_in_window(state: ServerState, thread_ids: List[str], user_id: int, start: str, end: str) -> bool:
    if not thread_ids:
        return True
    marks = ",".join("?" for _ in thread_ids)
    return (
        state.db.execute(
            f"""
            SELECT 1 FROM chat_messages
            WHERE thread_id IN ({marks}) AND author_id = ? AND deleted_at IS NULL
              AND datetime(created_at) BETWEEN datetime(?) AND datetime(?)
            LIMIT 1
            """,
            (*thread_ids, user_id, start, end),
        ).fetchone()
        is not None
    )


def record_ended(state: ServerState, moment: datetime) -> None:
    """Writes the 'ran' and 'played' rows for every announced date that has ended."""
    from . import sessions

    for occurrence in _unrecorded_ended(state, moment, True):
        series = sessions._series_row(state, occurrence["session_id"])
        gm, context = _context(state, series)
        settings = sessions.effective(series, occurrence)
        record(state, user_id=gm, role="gm", kind="ran", now=moment, occurrence_id=occurrence["id"], **context)
        automatic = series["kind"] == "pbp" and bool(settings["thread_ids"])
        for rsvp in state.db.execute(
            "SELECT user_id FROM session_rsvps WHERE occurrence_id = ? AND response = 'accept'", (occurrence["id"],)
        ).fetchall():
            absent = automatic and not _posted_in_window(
                state, settings["thread_ids"], rsvp["user_id"], occurrence["start_at"], occurrence["end_at"]
            )
            record(
                state, user_id=rsvp["user_id"], role="player", kind="played", now=moment, occurrence_id=occurrence["id"],
                other_user_id=gm, outcome="no_show" if absent else "attended", auto=absent, **context,
            )


def next_due(state: ServerState, moment: datetime) -> Optional[datetime]:
    """When the next announced date will end and need recording."""
    from . import sessions

    ends = [sessions.parse_utc(row["end_at"]) for row in _unrecorded_ended(state, moment, False)]
    return min(ends) if ends else None


def run_due(state: ServerState, moment: datetime) -> Optional[datetime]:
    record_ended(state, moment)
    state.db.commit()
    return next_due(state, moment)


# --- Attendance actions ---------------------------------------------------------------------


def _ended_occurrence(state: ServerState, occurrence_id: str, now: datetime) -> Any:
    from . import sessions

    occurrence = sessions._occurrence_row(state, occurrence_id)
    if sessions.parse_utc(occurrence["end_at"]) > now:
        raise AuthError("Attendance can be recorded once the session has ended")
    return occurrence


def _played_row(state: ServerState, occurrence_id: str, user_id: int) -> Any:
    row = state.db.execute(
        "SELECT * FROM signal_events WHERE occurrence_id = ? AND user_id = ? AND kind = 'played'", (occurrence_id, user_id)
    ).fetchone()
    if not row:
        raise AuthError("That player has no recorded attendance for this session")
    return row


def set_no_show(state: ServerState, user: Optional[User], occurrence_id: str, target_user_id: Any, value: Any) -> Dict[str, Any]:
    """The GM (or an admin) marks an Accepted player a no-show, or clears a no-show or dispute."""
    from . import sessions

    if not isinstance(target_user_id, int) or isinstance(target_user_id, bool) or not isinstance(value, bool):
        raise AuthError("Choose a player and whether they were a no-show")
    now = sessions.utcnow()
    occurrence = sessions._occurrence_row(state, occurrence_id)
    sessions._gm_access(state, occurrence["group_id"], user)
    _ended_occurrence(state, occurrence_id, now)
    played = _played_row(state, occurrence_id, target_user_id)
    if value:
        if played["outcome"] != "attended":
            raise AuthError("That player is already marked as a no-show")
        state.db.execute("UPDATE signal_events SET outcome = 'no_show', auto = 0 WHERE id = ?", (played["id"],))
        sessions._notice(state, target_user_id, occurrence["group_id"], "session_noshow", occurrence_id, occurrence["revision"], now)
    else:
        state.db.execute("UPDATE signal_events SET outcome = 'attended', auto = 0 WHERE id = ?", (played["id"],))
    state.db.commit()
    return sessions.get_occurrence(state, user, occurrence_id)


def dispute_no_show(state: ServerState, user: Optional[User], occurrence_id: str) -> Dict[str, Any]:
    """The player contests their own no-show; it then stops counting."""
    from . import sessions

    if not user:
        raise AuthError("Authentication required")
    now = sessions.utcnow()
    occurrence = sessions._occurrence_row(state, occurrence_id)
    played = _played_row(state, occurrence_id, user.id)
    if played["outcome"] == "attended":
        raise AuthError("You aren't marked as a no-show for this session")
    if played["outcome"] == "no_show":
        state.db.execute("UPDATE signal_events SET outcome = 'contested' WHERE id = ?", (played["id"],))
        owner = sessions._group_owner(state, occurrence["group_id"])
        if owner is not None:
            sessions._notice(state, owner, occurrence["group_id"], "session_dispute", occurrence_id, occurrence["revision"], now)
        state.db.commit()
    return sessions.get_occurrence(state, user, occurrence_id)


def attendance_by_user(state: ServerState, occurrence_id: str) -> Dict[int, Dict[str, Any]]:
    return {
        row["user_id"]: {"outcome": row["outcome"], "auto": bool(row["auto"])}
        for row in state.db.execute(
            "SELECT user_id, outcome, auto FROM signal_events WHERE occurrence_id = ? AND kind = 'played'", (occurrence_id,)
        )
    }
