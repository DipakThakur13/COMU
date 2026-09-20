from __future__ import annotations

import threading
from dataclasses import dataclass, field

from permits.ports.clock import Clock


@dataclass
class SpoolEntry:
    to: str
    subject: str
    body: str
    queued_at: str
    attempts: int = 0
    last_error: str = ""
    tags: dict[str, str] = field(default_factory=dict)


class Spool:
    """An in-process, thread-safe FIFO of letters waiting to be sent.

    It is not durable. A restart loses whatever has not been drained, which is the trade the
    service makes for never blocking a request on the mail transport.
    """

    def __init__(self, clock: Clock) -> None:
        self._clock = clock
        self._entries: list[SpoolEntry] = []
        self._dead: list[SpoolEntry] = []
        self._lock = threading.Lock()

    def put(self, to: str, subject: str, body: str, queued_at: str | None = None) -> None:
        entry = SpoolEntry(to=to, subject=subject, body=body, queued_at=queued_at or self._clock.now_iso())
        with self._lock:
            self._entries.append(entry)

    def take(self, limit: int = 16) -> list[SpoolEntry]:
        with self._lock:
            taken = self._entries[:limit]
            self._entries = self._entries[limit:]
        return taken

    def requeue(self, entry: SpoolEntry) -> None:
        with self._lock:
            self._entries.append(entry)

    def bury(self, entry: SpoolEntry) -> None:
        with self._lock:
            self._dead.append(entry)

    def depth(self) -> int:
        with self._lock:
            return len(self._entries)

    def dead_depth(self) -> int:
        with self._lock:
            return len(self._dead)
