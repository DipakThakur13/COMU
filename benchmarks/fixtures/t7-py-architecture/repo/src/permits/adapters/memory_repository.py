from __future__ import annotations

from permits.domain.application import Application


class MemoryRepository:
    """Process-local storage. Correct on a laptop and in the tests, nowhere else."""

    kind = "memory"

    def __init__(self) -> None:
        self._rows: dict[str, Application] = {}
        self._sequence = 0

    def save(self, application: Application, actor: str) -> None:
        del actor  # the wrapper has already decided whether this is allowed
        self._rows[application.reference] = application

    def get(self, reference: str) -> Application | None:
        return self._rows.get(reference)

    def next_sequence(self) -> int:
        self._sequence += 1
        return self._sequence

    def all_references(self) -> list[str]:
        return sorted(self._rows)

    def trail_size(self) -> int:
        return 0
