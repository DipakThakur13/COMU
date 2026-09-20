from __future__ import annotations

from typing import Protocol

from permits.domain.application import Application


class Repository(Protocol):
    """The storage port.

    ``save`` takes an actor. That looks like a logging convenience and is not: the decorator in
    :mod:`permits.adapters.audited_repository` uses it to authorise the write.
    """

    kind: str

    def save(self, application: Application, actor: str) -> None: ...

    def get(self, reference: str) -> Application | None: ...

    def next_sequence(self) -> int: ...

    def all_references(self) -> list[str]: ...

    def trail_size(self) -> int: ...
