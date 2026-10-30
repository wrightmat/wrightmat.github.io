from __future__ import annotations

import threading
import time
from collections import deque
from typing import Deque, Dict, Iterable


class Throttle:
    """Sliding-window counter per key, held in memory (a restart clears it)."""

    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window = window_seconds
        self._events: Dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> Deque[float]:
        events = self._events.setdefault(key, deque())
        while events and now - events[0] >= self.window:
            events.popleft()
        if not events:
            self._events.pop(key, None)
        return events

    def wait_seconds(self, keys: Iterable[str]) -> int:
        """Seconds until the busiest key is under its limit again; 0 when none is full."""
        now = time.monotonic()
        wait = 0
        with self._lock:
            for key in keys:
                events = self._recent(key, now)
                if len(events) >= self.limit:
                    wait = max(wait, int(self.window - (now - events[0])) + 1)
        return wait

    def record(self, keys: Iterable[str]) -> None:
        now = time.monotonic()
        with self._lock:
            for key in keys:
                self._events.setdefault(key, deque()).append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)
