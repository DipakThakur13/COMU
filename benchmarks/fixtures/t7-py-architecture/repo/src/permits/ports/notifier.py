from __future__ import annotations

from typing import Protocol


class Notifier(Protocol):
    kind: str

    def send(self, to: str, subject: str, body: str) -> None: ...


class Undeliverable(RuntimeError):
    """Raised by a notifier that failed in a way worth retrying."""
