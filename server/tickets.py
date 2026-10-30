from __future__ import annotations

import secrets
import threading
import time
from typing import Dict, Optional, Tuple

# Browsers can't attach an Authorization header to an EventSource, <img> or <iframe>, so those
# requests carry a short-lived one-use ticket in the URL instead of the long-lived session token.
TICKET_LIFETIME_SECONDS = 30

_tickets: Dict[str, Tuple[int, str, float]] = {}
_lock = threading.Lock()


def issue_ticket(user_id: int, purpose: str) -> str:
    now = time.monotonic()
    ticket = secrets.token_urlsafe(24)
    with _lock:
        for key in [k for k, (_, _, expires) in _tickets.items() if expires <= now]:
            del _tickets[key]
        _tickets[ticket] = (user_id, purpose, now + TICKET_LIFETIME_SECONDS)
    return ticket


def redeem_ticket(ticket: str, purpose: str) -> Optional[int]:
    """The user id a valid ticket was issued to; the ticket is spent either way."""
    with _lock:
        entry = _tickets.pop(ticket or "", None)
    if not entry:
        return None
    user_id, issued_for, expires = entry
    if issued_for != purpose or expires <= time.monotonic():
        return None
    return user_id
