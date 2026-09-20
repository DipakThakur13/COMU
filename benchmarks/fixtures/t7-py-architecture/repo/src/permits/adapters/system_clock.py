from __future__ import annotations

import time
from datetime import datetime, timezone


class SystemClock:
    def now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")

    def monotonic(self) -> float:
        return time.monotonic()


class FrozenClock:
    """Used by the tests. Never wired by :mod:`permits.wiring`."""

    def __init__(self, instant: str, ticks: float = 0.0) -> None:
        self.instant = instant
        self.ticks = ticks

    def now_iso(self) -> str:
        return self.instant

    def monotonic(self) -> float:
        return self.ticks

    def advance(self, seconds: float) -> None:
        self.ticks += seconds
