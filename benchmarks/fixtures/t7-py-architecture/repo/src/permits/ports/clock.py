from __future__ import annotations

from typing import Protocol


class Clock(Protocol):
    def now_iso(self) -> str: ...

    def monotonic(self) -> float: ...
