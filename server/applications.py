from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from .auth import AuthError, User
from .groups import _is_player, ensure_player
from .listings import _load as _load_listing, accepted_count, refresh_status
from .state import ServerState

# An application is a private conversation between an applicant and the GM of a
# listing. Its messages are `direct_messages` rows carrying the application id,
# and each side has exactly one Inbox item for it that is refreshed (made unread
# again, moved to the top) by every new message or status change.
BODY_LIMIT = 4000


def _now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat()


def _load(state: ServerState, application_id: str) -> Any:
    row = state.db.execute("SELECT * FROM applications WHERE id = ?", (application_id,)).fetchone()
    if not row:
        raise AuthError("Application not found")
    return row


def _refresh_inbox(state: ServerState, user_id: int, group_id: str, application_id: str) -> None:
    state.db.execute("DELETE FROM inbox_items WHERE user_id = ? AND application_id = ?", (user_id, application_id))
    state.db.execute(
        "INSERT INTO inbox_items (user_id, group_id, reason, created_at, application_id) VALUES (?, ?, 'application', ?, ?)",
        (user_id, group_id, _now(), application_id),
    )


def _clean_body(body: Any) -> str:
    text = str(body or "").strip()[:BODY_LIMIT]
    if not text:
        raise AuthError("Message cannot be empty")
    return text


def _add_message(state: ServerState, row: Any, author_id: int, text: str) -> None:
    other = row["gm_id"] if author_id == row["applicant_id"] else row["applicant_id"]
    state.db.execute(
        "INSERT INTO direct_messages (group_id, author_id, recipient_ids, body, created_at, application_id) VALUES (?, ?, ?, ?, ?, ?)",
        (row["group_id"], author_id, json.dumps([other]), text, _now(), row["id"]),
    )
    _refresh_inbox(state, other, row["group_id"], row["id"])


def _participant(row: Any, user: Optional[User]) -> User:
    if not user:
        raise AuthError("Authentication required")
    if user.id not in (row["applicant_id"], row["gm_id"]) and user.tier != "admin":
        raise AuthError("Access denied")
    return user


def _decider(row: Any, user: Optional[User]) -> User:
    if not user:
        raise AuthError("Authentication required")
    if user.id != row["gm_id"] and user.tier != "admin":
        raise AuthError("Only the GM can do that")
    return user


def gm_has_application_from(state: ServerState, gm_id: int, applicant_id: int) -> bool:
    return (
        state.db.execute(
            "SELECT 1 FROM applications WHERE gm_id = ? AND applicant_id = ? LIMIT 1", (gm_id, applicant_id)
        ).fetchone()
        is not None
    )


def apply(state: ServerState, user: Optional[User], listing_id: str, body: Any) -> Dict[str, Any]:
    if not user:
        raise AuthError("Sign in to apply")
    listing = _load_listing(state, listing_id)
    if listing["status"] != "open":
        raise AuthError("This listing isn't open")
    if user.id == listing["owner_id"]:
        raise AuthError("You can't apply to your own listing")
    if _is_player(state.db, listing["group_id"], user.id):
        raise AuthError("You're already a member of this group")
    if accepted_count(state, listing_id) >= listing["seats_offered"]:
        raise AuthError("This listing has no open seats")
    if state.db.execute(
        "SELECT 1 FROM applications WHERE listing_id = ? AND applicant_id = ? AND status = 'pending'", (listing_id, user.id)
    ).fetchone():
        raise AuthError("You already have a pending application for this listing")
    text = _clean_body(body)
    created = datetime.utcnow().replace(microsecond=0)
    application_id = f"app_{secrets.token_hex(6)}"
    state.db.execute(
        """
        INSERT INTO applications (id, listing_id, group_id, applicant_id, gm_id, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        """,
        (
            application_id, listing_id, listing["group_id"], user.id, listing["owner_id"],
            created.isoformat(), (created + timedelta(days=listing["auto_decline_days"])).isoformat(),
        ),
    )
    row = _load(state, application_id)
    _add_message(state, row, user.id, text)
    _refresh_inbox(state, user.id, listing["group_id"], application_id)
    state.db.commit()
    from . import sessions

    sessions.wake()
    return get_application(state, user, application_id)


def reply(state: ServerState, user: Optional[User], application_id: str, body: Any) -> Dict[str, Any]:
    row = _load(state, application_id)
    _participant(row, user)
    if row["status"] not in ("pending", "accepted"):
        raise AuthError("This application is closed")
    if user.id not in (row["applicant_id"], row["gm_id"]):
        raise AuthError("Only the applicant and the GM can reply")
    _add_message(state, row, user.id, _clean_body(body))
    state.db.commit()
    return get_application(state, user, application_id)


def _close(state: ServerState, row: Any, status: str, decided_by: Optional[int]) -> None:
    state.db.execute(
        "UPDATE applications SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?",
        (status, _now(), decided_by, row["id"]),
    )
    for user_id in (row["applicant_id"], row["gm_id"]):
        if user_id != decided_by:
            _refresh_inbox(state, user_id, row["group_id"], row["id"])


def accept(state: ServerState, user: Optional[User], application_id: str) -> Dict[str, Any]:
    row = _load(state, application_id)
    _decider(row, user)
    if row["status"] != "pending":
        raise AuthError("This application has already been answered")
    listing = _load_listing(state, row["listing_id"])
    if accepted_count(state, row["listing_id"]) >= listing["seats_offered"]:
        raise AuthError("No seats are left on this listing")
    _close(state, row, "accepted", user.id)
    ensure_player(state, row["group_id"], row["applicant_id"])
    refresh_status(state, row["listing_id"])
    state.db.commit()
    return get_application(state, user, application_id)


def decline(state: ServerState, user: Optional[User], application_id: str) -> Dict[str, Any]:
    row = _load(state, application_id)
    _decider(row, user)
    if row["status"] != "pending":
        raise AuthError("This application has already been answered")
    _close(state, row, "declined", user.id)
    state.db.commit()
    return get_application(state, user, application_id)


def withdraw(state: ServerState, user: Optional[User], application_id: str) -> Dict[str, Any]:
    row = _load(state, application_id)
    if not user or user.id != row["applicant_id"]:
        raise AuthError("Only the applicant can withdraw")
    if row["status"] != "pending":
        raise AuthError("This application has already been answered")
    _close(state, row, "withdrawn", user.id)
    state.db.commit()
    return get_application(state, user, application_id)


def expire_due(state: ServerState, moment: datetime) -> Optional[datetime]:
    """Declines every pending application past its deadline; returns the next deadline."""
    for row in state.db.execute(
        "SELECT * FROM applications WHERE status = 'pending' AND expires_at <= ?", (moment.replace(microsecond=0).isoformat(),)
    ).fetchall():
        _close(state, row, "expired", None)
    state.db.commit()
    upcoming = state.db.execute("SELECT MIN(expires_at) FROM applications WHERE status = 'pending'").fetchone()[0]
    return datetime.fromisoformat(upcoming) if upcoming else None


def _messages(state: ServerState, application_id: str) -> List[Dict[str, Any]]:
    return [
        {"id": m["id"], "authorId": m["author_id"], "authorName": m["username"] or "", "body": m["body"], "createdAt": m["created_at"]}
        for m in state.db.execute(
            """
            SELECT d.*, u.username FROM direct_messages AS d LEFT JOIN users AS u ON u.id = d.author_id
            WHERE d.application_id = ? ORDER BY d.id
            """,
            (application_id,),
        )
    ]


def summarize(state: ServerState, row: Any, viewer: User, *, with_messages: bool = True) -> Dict[str, Any]:
    names = {
        r["id"]: r["username"]
        for r in state.db.execute(
            "SELECT id, username FROM users WHERE id IN (?, ?)", (row["applicant_id"], row["gm_id"])
        )
    }
    listing = state.db.execute("SELECT * FROM listings WHERE id = ?", (row["listing_id"],)).fetchone()
    group = state.db.execute("SELECT title FROM library_items WHERE kind = 'group' AND id = ?", (row["group_id"],)).fetchone()
    pending = row["status"] == "pending"
    is_gm = viewer.id == row["gm_id"] or viewer.tier == "admin"
    summary: Dict[str, Any] = {
        "id": row["id"],
        "listingId": row["listing_id"],
        "listingExists": listing is not None,
        "groupId": row["group_id"],
        "groupName": group["title"] if group else "",
        "status": row["status"],
        "applicantId": row["applicant_id"],
        "applicantName": names.get(row["applicant_id"], ""),
        "gmId": row["gm_id"],
        "gmName": names.get(row["gm_id"], ""),
        "createdAt": row["created_at"],
        "expiresAt": row["expires_at"],
        "decidedAt": row["decided_at"],
        "canDecide": pending and is_gm,
        "canWithdraw": pending and viewer.id == row["applicant_id"],
        "canReply": row["status"] in ("pending", "accepted") and viewer.id in (row["applicant_id"], row["gm_id"]),
        "canClaim": row["status"] == "accepted" and viewer.id == row["applicant_id"],
    }
    if with_messages:
        summary["messages"] = _messages(state, row["id"])
    return summary


def get_application(state: ServerState, user: Optional[User], application_id: str) -> Dict[str, Any]:
    row = _load(state, application_id)
    _participant(row, user)
    return summarize(state, row, user)


def inbox_entry(state: ServerState, item: Any, user: User) -> Optional[Dict[str, Any]]:
    row = state.db.execute("SELECT * FROM applications WHERE id = ?", (item["application_id"],)).fetchone()
    return summarize(state, row, user) if row else None
