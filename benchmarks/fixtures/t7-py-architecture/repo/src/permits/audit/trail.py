from __future__ import annotations

import threading
from dataclasses import dataclass

from permits.ports.clock import Clock


@dataclass(frozen=True)
class TrailEntry:
    at: str
    actor: str
    reference: str
    state: str


class AuditTrail:
    """Append-only record of who changed what.

    Its only writer is :class:`permits.adapters.audited_repository.AuditedRepository`. No service
    and no handler touches it, so the trail is exactly the set of writes that reached storage and
    nothing else.
    """

    def __init__(self, clock: Clock) -> None:
        self._clock = clock
        self._entries: list[TrailEntry] = []
        self._lock = threading.Lock()

    def append(self, actor: str, reference: str, state: str) -> None:
        entry = TrailEntry(at=self._clock.now_iso(), actor=actor or "anonymous", reference=reference, state=state)
        with self._lock:
            self._entries.append(entry)

    def for_reference(self, reference: str) -> list[TrailEntry]:
        with self._lock:
            return [entry for entry in self._entries if entry.reference == reference]

    def size(self) -> int:
        with self._lock:
            return len(self._entries)
