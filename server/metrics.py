from __future__ import annotations

import os
import re
import threading
import time
from collections import defaultdict
from typing import Callable, Dict, List, Optional, Tuple

# Upper bounds (seconds) of the latency buckets, shared by every histogram here.
BUCKETS: Tuple[float, ...] = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
WINDOW_MINUTES = 60

_PARAM = re.compile(r"\(\?P<(\w+)>[^)]*\)")


def route_label(pattern: str) -> str:
    """A route's regex as a readable, bounded label: /groups/{group_id}/chat."""
    label = _PARAM.sub(lambda m: "{" + m.group(1) + "}", pattern)
    return label.lstrip("^").rstrip("$").replace("\\", "") or "/"


def _bucket_index(seconds: float) -> int:
    for index, bound in enumerate(BUCKETS):
        if seconds <= bound:
            return index
    return len(BUCKETS)


def _quantile(buckets: List[int], q: float) -> Optional[float]:
    total = sum(buckets)
    if not total:
        return None
    target = q * total
    running = 0
    for index, count in enumerate(buckets):
        running += count
        if running >= target:
            return BUCKETS[index] if index < len(BUCKETS) else BUCKETS[-1] * 2
    return BUCKETS[-1] * 2


class _Slot:
    __slots__ = ("minute", "count", "errors", "latency_sum", "lock_wait_sum", "buckets")

    def __init__(self, minute: int) -> None:
        self.minute = minute
        self.count = 0
        self.errors = 0
        self.latency_sum = 0.0
        self.lock_wait_sum = 0.0
        self.buckets = [0] * (len(BUCKETS) + 1)


class Metrics:
    """In-process counters and latency histograms; nothing is stored, a restart starts them over."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.started = time.time()
        self._requests: Dict[Tuple[str, str], int] = defaultdict(int)
        self._latency: Dict[str, List[int]] = {}
        self._latency_sum: Dict[str, float] = defaultdict(float)
        self._counters: Dict[Tuple[str, str], int] = defaultdict(int)
        self._lock_wait: List[int] = [0] * (len(BUCKETS) + 1)
        self._lock_wait_sum = 0.0
        self._lock_hold_sum = 0.0
        self._slots: Dict[int, _Slot] = {}
        self._gauges: Dict[str, Callable[[], Optional[float]]] = {}
        self._live_subscribers = 0

    # -- recording -------------------------------------------------------
    def record_request(self, route: str, status: int, seconds: float, lock_wait: float) -> None:
        klass = f"{status // 100}xx"
        with self._lock:
            self._requests[(route, klass)] += 1
            hist = self._latency.setdefault(route, [0] * (len(BUCKETS) + 1))
            hist[_bucket_index(seconds)] += 1
            self._latency_sum[route] += seconds
            minute = int(time.time() // 60)
            slot = self._slots.get(minute)
            if slot is None:
                slot = self._slots[minute] = _Slot(minute)
                for stale in [m for m in self._slots if m <= minute - WINDOW_MINUTES]:
                    del self._slots[stale]
            slot.count += 1
            slot.errors += 1 if status >= 500 else 0
            slot.latency_sum += seconds
            slot.lock_wait_sum += lock_wait
            slot.buckets[_bucket_index(seconds)] += 1

    def record_lock(self, wait: float, hold: float) -> None:
        with self._lock:
            self._lock_wait[_bucket_index(wait)] += 1
            self._lock_wait_sum += wait
            self._lock_hold_sum += hold

    def inc(self, name: str, label: str = "") -> None:
        with self._lock:
            self._counters[(name, label)] += 1

    def live_subscribers(self, delta: int) -> None:
        with self._lock:
            self._live_subscribers = max(0, self._live_subscribers + delta)

    def register_gauge(self, name: str, reader: Callable[[], Optional[float]]) -> None:
        self._gauges[name] = reader

    # -- reading ---------------------------------------------------------
    def summary(self, minutes: int = 5) -> Dict[str, object]:
        """Recent load figures for the admin card; `minutes` is the look-back window."""
        now_minute = int(time.time() // 60)
        with self._lock:
            slots = [s for s in self._slots.values() if s.minute > now_minute - minutes]
            buckets = [0] * (len(BUCKETS) + 1)
            count = errors = 0
            latency_sum = lock_wait_sum = 0.0
            for slot in slots:
                count += slot.count
                errors += slot.errors
                latency_sum += slot.latency_sum
                lock_wait_sum += slot.lock_wait_sum
                for index, value in enumerate(slot.buckets):
                    buckets[index] += value
            throttled = {label: n for (name, label), n in self._counters.items() if name == "throttled_total"}
            subscribers = self._live_subscribers
        gauges = {name: self._read_gauge(reader) for name, reader in self._gauges.items()}
        return {
            "windowMinutes": minutes,
            "requests": count,
            "requestsPerMinute": round(count / minutes, 2),
            "serverErrors": errors,
            "p50Ms": _ms(_quantile(buckets, 0.5)),
            "p95Ms": _ms(_quantile(buckets, 0.95)),
            "p99Ms": _ms(_quantile(buckets, 0.99)),
            "meanMs": round(latency_sum / count * 1000, 1) if count else None,
            "lockWaitShare": round(lock_wait_sum / latency_sum, 3) if latency_sum else None,
            "liveSubscribers": subscribers,
            "throttled": throttled,
            "uptimeSeconds": int(time.time() - self.started),
            "gauges": gauges,
        }

    @staticmethod
    def _read_gauge(reader: Callable[[], Optional[float]]) -> Optional[float]:
        try:
            return reader()
        except Exception:
            return None

    def render_prometheus(self) -> str:
        lines: List[str] = []

        def block(name: str, kind: str, help_text: str) -> None:
            lines.append(f"# HELP {name} {help_text}")
            lines.append(f"# TYPE {name} {kind}")

        with self._lock:
            block("undercroft_http_requests_total", "counter", "Requests by route and status class.")
            for (route, klass), n in sorted(self._requests.items()):
                lines.append(f'undercroft_http_requests_total{{route="{route}",status="{klass}"}} {n}')
            block("undercroft_http_request_duration_seconds", "histogram", "Request duration by route.")
            for route, hist in sorted(self._latency.items()):
                running = 0
                for bound, n in zip(BUCKETS, hist):
                    running += n
                    lines.append(f'undercroft_http_request_duration_seconds_bucket{{route="{route}",le="{bound}"}} {running}')
                running += hist[-1]
                lines.append(f'undercroft_http_request_duration_seconds_bucket{{route="{route}",le="+Inf"}} {running}')
                lines.append(f'undercroft_http_request_duration_seconds_sum{{route="{route}"}} {self._latency_sum[route]:.6f}')
                lines.append(f'undercroft_http_request_duration_seconds_count{{route="{route}"}} {running}')
            block("undercroft_db_lock_wait_seconds", "histogram", "Time requests waited for the database lock.")
            running = 0
            for bound, n in zip(BUCKETS, self._lock_wait):
                running += n
                lines.append(f'undercroft_db_lock_wait_seconds_bucket{{le="{bound}"}} {running}')
            running += self._lock_wait[-1]
            lines.append(f'undercroft_db_lock_wait_seconds_bucket{{le="+Inf"}} {running}')
            lines.append(f"undercroft_db_lock_wait_seconds_sum {self._lock_wait_sum:.6f}")
            lines.append(f"undercroft_db_lock_wait_seconds_count {running}")
            block("undercroft_db_lock_hold_seconds_total", "counter", "Total time the database lock was held.")
            lines.append(f"undercroft_db_lock_hold_seconds_total {self._lock_hold_sum:.6f}")
            names = sorted({name for name, _ in self._counters})
            for name in names:
                block(f"undercroft_{name}", "counter", name.replace("_", " "))
                for (n, label), value in sorted(self._counters.items()):
                    if n == name:
                        suffix = f'{{kind="{label}"}}' if label else ""
                        lines.append(f"undercroft_{name}{suffix} {value}")
            block("undercroft_live_subscribers", "gauge", "Open live-stream connections.")
            lines.append(f"undercroft_live_subscribers {self._live_subscribers}")
        block("undercroft_uptime_seconds", "gauge", "Seconds since the process started.")
        lines.append(f"undercroft_uptime_seconds {int(time.time() - self.started)}")
        for name, reader in sorted(self._gauges.items()):
            value = self._read_gauge(reader)
            if value is not None:
                block(f"undercroft_{name}", "gauge", name.replace("_", " "))
                lines.append(f"undercroft_{name} {value}")
        return "\n".join(lines) + "\n"


def _ms(seconds: Optional[float]) -> Optional[float]:
    return None if seconds is None else round(seconds * 1000, 1)


def process_memory_bytes() -> Optional[float]:
    """Resident memory, read from /proc (Linux only; None elsewhere)."""
    try:
        with open("/proc/self/status", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    return float(line.split()[1]) * 1024
    except OSError:
        return None
    return None


def file_size(path: str) -> Optional[float]:
    try:
        return float(os.stat(path).st_size)
    except OSError:
        return None


METRICS = Metrics()
