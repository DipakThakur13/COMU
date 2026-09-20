from __future__ import annotations

from permits.domain.application import Application
from permits.ports.clock import Clock
from permits.queue.spool import Spool


class NotifyService:
    """Queues a letter. It never sends one.

    This service holds no notifier at all: it only appends to the spool. The notifier port is
    reached by :class:`permits.queue.worker.SpoolWorker` on its own thread, which is why nothing
    on the request path can be blocked or broken by the mail transport.
    """

    def __init__(self, spool: Spool, clock: Clock) -> None:
        self._spool = spool
        self._clock = clock

    def decision_reached(self, application: Application) -> None:
        self._spool.put(
            to=application.applicant,
            subject=f"Decision on {application.reference}",
            body="",
            queued_at=self._clock.now_iso(),
        )

    def acknowledgement(self, application: Application) -> None:
        self._spool.put(
            to=application.applicant,
            subject=f"We have your application {application.reference}",
            body="Thank you. We will write again when a decision is reached.\n",
            queued_at=self._clock.now_iso(),
        )
