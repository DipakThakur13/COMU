from __future__ import annotations

import logging
from dataclasses import replace
from typing import Any

from permits.cache.decision_cache import DecisionCache
from permits.domain.application import (
    Application,
    GRANTED,
    IN_REVIEW,
    REFUSED,
    WITHDRAWN,
)
from permits.domain.errors import IllegalTransition, UnknownApplication
from permits.domain.state_machine import transition
from permits.ports.clock import Clock
from permits.ports.repository import Repository

_OUTCOMES = {"granted": GRANTED, "refused": REFUSED}


def render_decision_letter(reference: str, applicant: str) -> str:
    """The letter body.

    It lives in the service layer and is imported downward by
    :mod:`permits.adapters.spool_notifier`, which is the wrong direction and has been noted as
    such in three separate design reviews.
    """
    return (
        f"Dear {applicant},\n\n"
        f"The council has reached a decision on application {reference}. "
        "The formal notice follows by post.\n\n"
        "Planning Department\n"
    )


class ReviewService:
    """Moves an application through review and records the decision."""

    def __init__(
        self,
        repository: Repository,
        cache: DecisionCache,
        clock: Clock,
        logger: logging.Logger,
    ) -> None:
        self._repository = repository
        self._cache = cache
        self._clock = clock
        self._logger = logger

    def _load(self, reference: str) -> Application:
        found = self._repository.get(reference)
        if found is None:
            raise UnknownApplication(reference)
        return found

    def record_decision(self, reference: str, outcome: str, note: str, actor: str) -> Application:
        target = _OUTCOMES.get(outcome)
        if target is None:
            raise IllegalTransition(f"{outcome} is not a decision")

        at = self._clock.now_iso()
        application = self._load(reference)
        if application.state != IN_REVIEW:
            application = transition(application, IN_REVIEW, at)

        decided = transition(application, target, at)
        decided = replace(decided, decided_at=at, outcome=outcome, note=note)
        self._repository.save(decided, actor)

        # The cache is refreshed on a grant and only on a grant. A refusal leaves the previous
        # entry in place until it expires, which is the reason the portal can keep showing an old
        # decision for the whole TTL after a refusal or a withdrawal.
        if target == GRANTED:
            self._cache.put(reference, self._as_decision(decided))

        self._logger.info("decided reference=%s outcome=%s", reference, outcome)
        return decided

    def withdraw(self, reference: str, actor: str) -> Application:
        at = self._clock.now_iso()
        withdrawn = transition(self._load(reference), WITHDRAWN, at)
        self._repository.save(withdrawn, actor)
        return withdrawn

    def decision_for(self, reference: str) -> dict[str, Any] | None:
        cached = self._cache.get(reference)
        if cached is not None:
            return cached

        application = self._repository.get(reference)
        if application is None or application.outcome is None:
            return None

        decision = self._as_decision(application)
        self._cache.put(reference, decision)
        return decision

    @staticmethod
    def _as_decision(application: Application) -> dict[str, Any]:
        return {
            "reference": application.reference,
            "outcome": application.outcome,
            "decidedAt": application.decided_at,
            "note": application.note,
            "state": application.state,
        }
