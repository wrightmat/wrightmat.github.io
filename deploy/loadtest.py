#!/usr/bin/env python3
"""Stepped load test for an Undercroft server, standard library only.

    python deploy/loadtest.py --base http://127.0.0.1:8100/undercroft --username gm1 --password '...' \
        --steps 5,10,20,40 --seconds 30 --streams 2

Each step runs N virtual users for the given time. A user repeatedly browses the Library, opens a record,
and saves then deletes a scratch record; --streams adds that many open live-stream connections per step
(the long-lived connections real tables hold). Use an account of GM tier or higher on a UAT server, never
on production data. It prints throughput and latency per step so the curve can be read against the
server's own /metrics and the Admin tab's Server Load card.
"""
from __future__ import annotations

import argparse
import http.client
import json
import random
import statistics
import threading
import time
from urllib.parse import urlsplit

KINDS = ["system", "species", "class", "feature", "template", "wonder"]


class Client:
    def __init__(self, base: str, token: str = "") -> None:
        parts = urlsplit(base)
        self.host, self.port, self.tls = parts.hostname, parts.port or (443 if parts.scheme == "https" else 80), parts.scheme == "https"
        self.prefix = parts.path.rstrip("/") + "/api"
        self.token = token
        self.conn = None

    def _connect(self):
        cls = http.client.HTTPSConnection if self.tls else http.client.HTTPConnection
        self.conn = cls(self.host, self.port, timeout=30)

    def request(self, method: str, path: str, body=None):
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        payload = json.dumps(body).encode() if body is not None else None
        for attempt in (0, 1):
            if self.conn is None:
                self._connect()
            started = time.perf_counter()
            try:
                self.conn.request(method, self.prefix + path, body=payload, headers=headers)
                response = self.conn.getresponse()
                data = response.read()
                return response.status, data, time.perf_counter() - started
            except (http.client.HTTPException, OSError):
                self.conn = None
                if attempt:
                    return 0, b"", time.perf_counter() - started
        return 0, b"", 0.0


def user_loop(base, token, stop, results, lock, name):
    client = Client(base, token)
    counter = 0
    while not stop.is_set():
        kind = random.choice(KINDS)
        steps = [("GET", f"/list/{kind}", None)]
        counter += 1
        scratch = f"loadtest-{name}-{counter}"
        steps += [
            ("POST", f"/content/wonder/{scratch}", {"title": scratch, "name": scratch}),
            ("GET", f"/content/wonder/{scratch}", None),
            ("POST", f"/content/wonder/{scratch}/delete", {}),
        ]
        for method, path, body in steps:
            status, _, seconds = client.request(method, path, body)
            with lock:
                results.append((status, seconds))
            if stop.is_set():
                break
        time.sleep(random.uniform(0.05, 0.3))


def stream_loop(base, token, stop, counts, lock):
    parts = urlsplit(base)
    client = Client(base, token)
    while not stop.is_set():
        status, data, _ = client.request("POST", "/auth/ticket", {"purpose": "live"})
        if status != 200:
            time.sleep(1)
            continue
        ticket = json.loads(data)["ticket"]
        cls = http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
        conn = cls(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80), timeout=70)
        try:
            conn.request("GET", f"{parts.path.rstrip('/')}/api/live/loadtest?kinds=group,chat&ticket={ticket}")
            response = conn.getresponse()
            with lock:
                counts.append(response.status)
            while not stop.is_set():
                if not response.read(1):
                    break
        except (http.client.HTTPException, OSError):
            pass
        finally:
            conn.close()


def percentile(values, q):
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", required=True, help="e.g. http://127.0.0.1:8100/undercroft")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--steps", default="5,10,20", help="comma-separated virtual user counts")
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--streams", type=int, default=0, help="open live-stream connections to hold during each step")
    args = parser.parse_args()

    status, data, _ = Client(args.base).request("POST", "/auth/login", {"username": args.username, "password": args.password})
    if status != 200:
        raise SystemExit(f"Login failed ({status}): {data[:200]!r}")
    token = json.loads(data)["token"]

    print(f"{'users':>6} {'req/s':>8} {'errors':>7} {'p50 ms':>8} {'p95 ms':>8} {'p99 ms':>8} {'streams ok':>11}")
    for users in [int(part) for part in args.steps.split(",")]:
        stop, lock = threading.Event(), threading.Lock()
        results, stream_counts = [], []
        threads = [threading.Thread(target=user_loop, args=(args.base, token, stop, results, lock, f"u{users}-{i}")) for i in range(users)]
        threads += [threading.Thread(target=stream_loop, args=(args.base, token, stop, stream_counts, lock)) for _ in range(args.streams)]
        started = time.perf_counter()
        for thread in threads:
            thread.start()
        time.sleep(args.seconds)
        stop.set()
        for thread in threads:
            thread.join(timeout=75)
        elapsed = time.perf_counter() - started
        latencies = [seconds * 1000 for status, seconds in results if status]
        errors = sum(1 for status, _ in results if status == 0 or status >= 500)
        print(
            f"{users:>6} {len(results) / elapsed:>8.1f} {errors:>7} {percentile(latencies, 0.5):>8.0f} "
            f"{percentile(latencies, 0.95):>8.0f} {percentile(latencies, 0.99):>8.0f} {sum(1 for s in stream_counts if s == 200):>11}"
        )


if __name__ == "__main__":
    main()
