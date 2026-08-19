"""Timing harness for the bulk-fetch performance work — measures the real
HTTP endpoints (not in-process calls) so results reflect what a browser
actually experiences. Pair with stress_seed.py: seed a scale, run this,
seed up to the next scale, run this again.

    python server/scripts/stress_measure.py --kind feature
    python server/scripts/stress_measure.py --kind journal --include-old-pattern

Measures, in order:
  1. GET  /list/{kind}                — metadata-only list (the cheap part,
     unchanged by this work; useful as a baseline for "how many records
     exist right now").
  2. POST /content/{kind}/bulk        — the new bulk-body endpoint (one
     request, every accessible body).
  3. (optional, --include-old-pattern) The OLD N+1 pattern this replaced:
     one GET per id. Capped at --old-pattern-sample ids by default (200) —
     literally replaying thousands of sequential requests every run would
     make this script itself the slow part; the sampled per-request average
     is reported alongside an extrapolated full-N estimate instead.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "http://127.0.0.1:8000"


def request(base_url: str, method: str, path: str, token: str = "", body=None):
    url = f"{base_url}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{method} {path} -> HTTP {error.code}: {error.read().decode('utf-8', 'ignore')}") from error
    elapsed_ms = (time.perf_counter() - start) * 1000
    return payload, elapsed_ms


def login(base_url: str, username: str, password: str) -> str:
    payload, _ = request(base_url, "POST", "/auth/login", body={"username": username, "password": password})
    return payload["token"]


def collect_ids(list_payload: dict) -> list:
    ids = []
    seen = set()
    for group in ("owned", "shared", "public", "items"):
        for entry in list_payload.get(group) or []:
            entry_id = entry.get("id")
            if entry_id and entry_id not in seen:
                seen.add(entry_id)
                ids.append(entry_id)
    return ids


def measure(base_url: str, token: str, kind: str, include_old_pattern: bool, old_pattern_sample: int) -> None:
    print(f"\n=== {kind} ===")

    list_payload, list_ms = request(base_url, "GET", f"/list/{kind}", token=token)
    ids = collect_ids(list_payload)
    print(f"GET  /list/{kind}                 {list_ms:8.1f} ms   ({len(ids)} accessible records)")

    bulk_payload, bulk_ms = request(base_url, "POST", f"/content/{kind}/bulk", token=token, body={})
    bulk_count = len(bulk_payload.get("items") or [])
    bulk_bytes = len(json.dumps(bulk_payload))
    print(f"POST /content/{kind}/bulk         {bulk_ms:8.1f} ms   ({bulk_count} bodies, {bulk_bytes / 1024:.1f} KB)")
    print(f"     -> {list_ms + bulk_ms:.1f} ms total for a full tool-open (list + bulk body fetch)")

    if not include_old_pattern:
        return
    if not ids:
        print("     (no ids to sample for the old per-item pattern)")
        return
    sample_ids = ids[:old_pattern_sample]
    sample_start = time.perf_counter()
    for id_ in sample_ids:
        request(base_url, "GET", f"/content/{kind}/{id_}", token=token)
    sample_ms = (time.perf_counter() - sample_start) * 1000
    per_request_ms = sample_ms / len(sample_ids)
    extrapolated_ms = per_request_ms * len(ids)
    print(
        f"     old N+1 pattern (sampled {len(sample_ids)} of {len(ids)} ids, sequential): "
        f"{sample_ms:.1f} ms sampled, {per_request_ms:.2f} ms/request avg"
    )
    print(
        f"     -> extrapolated full old-pattern cost at {len(ids)} records: "
        f"~{extrapolated_ms:.0f} ms ({extrapolated_ms / max(bulk_ms, 0.001):.1f}x slower than the new bulk endpoint)"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--username", default="admin")
    parser.add_argument("--password", default="admin")
    parser.add_argument("--kind", choices=["feature", "journal", "both"], default="both")
    parser.add_argument(
        "--include-old-pattern",
        action="store_true",
        help="Also sample the old one-request-per-record pattern for comparison (slower to run)",
    )
    parser.add_argument("--old-pattern-sample", type=int, default=200)
    args = parser.parse_args()

    token = login(args.base_url, args.username, args.password)
    kinds = ["feature", "journal"] if args.kind == "both" else [args.kind]
    for kind in kinds:
        measure(args.base_url, token, kind, args.include_old_pattern, args.old_pattern_sample)


if __name__ == "__main__":
    main()
