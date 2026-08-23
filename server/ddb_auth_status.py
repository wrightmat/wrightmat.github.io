from __future__ import annotations

from typing import Any, Dict, Optional

from .integrations import resolve_ddb_session_cookie
from .state import ServerState

# The mega-menu's own "signedInUserButton"/"signInLink" testids (this
# module's original markers) turned out to be worthless signals — CONFIRMED
# against a real, genuinely-authenticated raw response (not assumed):
# "signInLink" is present in BOTH signed-in and signed-out pages (it's
# static skeleton markup for the mega-menu web component, only hydrated
# away client-side), and "signedInUserButton" never appears in server-
# rendered HTML at all, regardless of auth state — the account button is a
# client-side-only element. Every earlier "looks expired" reading this
# produced (including the one that kicked off a whole investigation into
# TLS fingerprinting and extra cookies) was a false negative from this bad
# marker, not a real auth problem — the underlying cookie/fetch mechanism
# was working the entire time.
#
# Cobalt.User.IsAuthenticated is the real, confirmed-reliable signal: an
# inline `<script>` boolean this site's own JS framework depends on, set
# server-side from the request's own cookies. Confirmed present as `true`
# in a genuine authenticated response and absent/false otherwise. The
# `user-authenticated` class on <body> and `"loggedIn":true` in the
# dataLayer push are two more independently-confirmed signals from the same
# response if this one ever needs a fallback.
_SIGNED_IN_MARKER = "Cobalt.User.IsAuthenticated = true;"

# A small, always-free, always-available page — which one doesn't matter,
# since the signed-in-vs-not marker is account chrome, not page content.
_PROBE_URL = "https://www.dndbeyond.com/classes/2190875-barbarian"


# A real Chrome navigation sends this whole set, not just User-Agent/Accept
# — a request carrying a session cookie but missing every other browser
# signal (Accept-Language, Sec-Fetch-*, client hints) reads as automated,
# and sites commonly apply stricter bot/fraud scrutiny to authenticated-
# looking traffic than to anonymous traffic (an anonymous request serving a
# normal page proves nothing about how a cookie-bearing one is treated).
# Shared by check_ddb_auth_status below AND server/app.py's handle_ddb_proxy
# — both real D&D Beyond fetches should present an identical fingerprint,
# not two different partial ones.
def build_ddb_request_headers(cookie: str) -> Dict[str, str]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,"
            "image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
        ),
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
    }
    if cookie:
        headers["Cookie"] = cookie
    return headers


def is_signed_in_html(html: str) -> bool:
    return _SIGNED_IN_MARKER in (html or "")


# Distinct, actionable text per outcome — this is what actually lets an
# admin (or a future debugging session) tell "the cookie is genuinely
# expired" apart from "something else is wrong" without guessing, which is
# the whole reason this exists: an earlier version of this check just said
# "no signed-in account marker found" for every failure case, which reads
# identically whether the cookie is stale, malformed, or a fetch failed
# outright — three very different fixes.
def _describe_outcome(html: str, reason: Optional[str]) -> str:
    if reason == "not-configured":
        return "No D&D Beyond session cookie is configured yet — paste one below."
    if reason == "fetch-failed":
        return "The probe request itself failed (network error or non-2xx response) — see the server log for details."
    if is_signed_in_html(html):
        return ""
    return "D&D Beyond didn't report this cookie as an authenticated session — it's either expired or wasn't accepted."


# Shared by the dedicated probe below AND server/app.py's own opportunistic
# check inside handle_ddb_proxy (every real page fetch already has the HTML
# in hand — recording the same signal there costs nothing extra and is the
# one check that would have caught this exact incident live).
def record_ddb_auth_check(state: ServerState, html: str, *, reason: Optional[str] = None) -> Dict[str, Any]:
    valid = is_signed_in_html(html)
    detail = _describe_outcome(html, reason)
    state.db.execute(
        """
        INSERT INTO service_status (service, checked_at, valid, detail)
        VALUES ('ddb-session', CURRENT_TIMESTAMP, ?, ?)
        ON CONFLICT(service) DO UPDATE SET
            checked_at = CURRENT_TIMESTAMP,
            valid = excluded.valid,
            detail = excluded.detail
        """,
        (1 if valid else 0, detail),
    )
    state.db.commit()
    return get_ddb_auth_status(state)


def get_ddb_auth_status(state: ServerState) -> Dict[str, Any]:
    row = state.read_db.execute(
        "SELECT checked_at, valid, detail FROM service_status WHERE service = 'ddb-session'"
    ).fetchone()
    if not row:
        return {"checkedAt": None, "valid": None, "detail": ""}
    return {
        "checkedAt": row["checked_at"],
        "valid": bool(row["valid"]) if row["valid"] is not None else None,
        "detail": row["detail"] or "",
    }


# The dedicated, on-demand (Check Now / periodic thread) probe — fetches a
# fixed page itself rather than waiting for an incidental real fetch to
# happen to check. Same urllib pattern/headers as handle_ddb_proxy
# (server/app.py) — lazy imports, explicit timeout, HTTPError/URLError
# split — deliberately not routed back through handle_ddb_proxy itself
# (that's an HTTP route on this same running server; calling it in-process
# would mean a self-request for no benefit over calling urllib directly).
def check_ddb_auth_status(state: ServerState) -> Dict[str, Any]:
    import urllib.error
    import urllib.request

    cookie = resolve_ddb_session_cookie(state)
    if not cookie:
        return record_ddb_auth_check(state, "", reason="not-configured")

    request = urllib.request.Request(_PROBE_URL, headers=build_ddb_request_headers(cookie), method="GET")
    try:
        with urllib.request.urlopen(request, timeout=15) as upstream:
            html = upstream.read().decode("utf-8", errors="replace")
    except (urllib.error.HTTPError, urllib.error.URLError):
        # A fetch failure isn't itself proof the cookie is bad (could be a
        # transient network blip) — flagged with its own reason rather than
        # folded into the generic "no marker found" detail, so it doesn't
        # read as a stale cookie when it's really a network problem.
        return record_ddb_auth_check(state, "", reason="fetch-failed")
    return record_ddb_auth_check(state, html)
