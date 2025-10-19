from __future__ import annotations

ROLE_ORDER = ["free", "player", "gm", "master", "creator", "admin"]


def role_rank(role: str) -> int:
    """Return the index of ``role`` within :data:`ROLE_ORDER` or ``-1`` if unknown."""
    return ROLE_ORDER.index(role) if role in ROLE_ORDER else -1
