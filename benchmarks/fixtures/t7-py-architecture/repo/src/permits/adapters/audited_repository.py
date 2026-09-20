from __future__ import annotations

import logging

from permits.audit.trail import AuditTrail
from permits.domain.application import Application
from permits.domain.rules import assert_caller_may_write
from permits.ports.repository import Repository


class AuditedRepository:
    """A decorator around whichever repository the factory picked.

    It does two jobs that most readers would look for somewhere else entirely.

    First, authorisation: every ``save`` calls
    :func:`permits.domain.rules.assert_caller_may_write` before delegating, which makes this class
    the access control point of the whole service. Nothing in ``transport`` checks the actor.

    Second, the audit trail: every accepted save is appended to :class:`permits.audit.trail.
    AuditTrail`. No service writes to the trail, so a code path that bypasses the repository
    leaves no record at all.
    """

    def __init__(self, inner: Repository, trail: AuditTrail, logger: logging.Logger) -> None:
        self._inner = inner
        self._trail = trail
        self._logger = logger
        self.kind = f"audited({inner.kind})"

    def save(self, application: Application, actor: str) -> None:
        assert_caller_may_write(actor, application)
        self._inner.save(application, actor)
        self._trail.append(actor, application.reference, application.state)
        self._logger.info("saved reference=%s state=%s actor=%s", application.reference, application.state, actor)

    def get(self, reference: str) -> Application | None:
        return self._inner.get(reference)

    def next_sequence(self) -> int:
        return self._inner.next_sequence()

    def all_references(self) -> list[str]:
        return self._inner.all_references()

    def trail_size(self) -> int:
        return self._trail.size()
