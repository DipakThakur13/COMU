from __future__ import annotations

import logging
from typing import Any

from permits.domain.application import Application, SUBMITTED, reference_for
from permits.domain.rules import build_or_raise
from permits.domain.state_machine import transition
from permits.ports.clock import Clock
from permits.ports.repository import Repository


class IntakeService:
    """Turns a payload into a stored, submitted application.

    Field validation happens here, through :func:`permits.domain.rules.build_or_raise`, so a
    malformed body is refused synchronously with a 422. Authorisation does not happen here; the
    actor is carried along and checked much later, inside the repository decorator.
    """

    def __init__(self, repository: Repository, clock: Clock, logger: logging.Logger) -> None:
        self._repository = repository
        self._clock = clock
        self._logger = logger

    def submit(self, payload: dict[str, Any], actor: str) -> Application:
        at = self._clock.now_iso()
        reference = reference_for(self._repository.next_sequence(), at)

        application = build_or_raise(payload, reference, at)
        submitted = transition(application, SUBMITTED, at)

        self._repository.save(submitted, actor)
        self._logger.info("submitted reference=%s", reference)
        return submitted

    def fetch(self, reference: str) -> Application | None:
        return self._repository.get(reference)
