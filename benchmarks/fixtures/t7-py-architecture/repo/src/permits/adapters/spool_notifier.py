from __future__ import annotations

from permits.queue.spool import Spool
from permits.services.review_service import render_decision_letter


class SpoolNotifier:
    """The deployed notifier.

    Worth noticing where its text comes from: this adapter imports
    :func:`permits.services.review_service.render_decision_letter` to build the body, so an
    adapter depends upward on a service. It is the only import in ``adapters`` that points at
    ``services``, and it means the rendering rules live above the thing that uses them.
    """

    kind = "spool"

    def __init__(self, spool: Spool) -> None:
        self._spool = spool

    def send(self, to: str, subject: str, body: str) -> None:
        if not body:
            body = render_decision_letter(subject, to)
        self._spool.put(to=to, subject=subject, body=body)
