from __future__ import annotations

import threading
from typing import Any

from permits.ports.clock import Clock


class DecisionCache:
    """Caches the decision payload for a reference.

    It is a plain TTL map with an ``invalidate`` method. The interesting part is who calls what:
    :meth:`permits.services.review_service.ReviewService.record_decision` calls :meth:`put` only
    when the outcome is a grant, and nothing anywhere calls :meth:`invalidate`. A refusal, a
    resubmission or a withdrawal therefore leaves the previous entry in place until it expires on
    its own.
    """

    def __init__(self, clock: Clock, ttl_s: int) -> None:
        self._clock = clock
        self._ttl_s = ttl_s
        self._entries: dict[str, tuple[float, dict[str, Any]]] = {}
        self._lock = threading.Lock()

    def get(self, reference: str) -> dict[str, Any] | None:
        now = self._clock.monotonic()
        with self._lock:
            found = self._entries.get(reference)
            if found is None:
                return None
            expires_at, value = found
            if expires_at <= now:
                del self._entries[reference]
                return None
            return dict(value)

    def put(self, reference: str, value: dict[str, Any]) -> None:
        with self._lock:
            self._entries[reference] = (self._clock.monotonic() + self._ttl_s, dict(value))

    def invalidate(self, reference: str) -> None:
        with self._lock:
            self._entries.pop(reference, None)

    def size(self) -> int:
        with self._lock:
            return len(self._entries)
