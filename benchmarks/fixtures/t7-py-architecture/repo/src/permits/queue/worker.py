from __future__ import annotations

import logging
import time

from permits.ports.clock import Clock
from permits.ports.notifier import Notifier, Undeliverable
from permits.queue.spool import Spool


class SpoolWorker:
    """The only code in the service that calls a notifier.

    It runs on the daemon thread started by :mod:`permits.__main__`. Everything upstream of it
    merely appends to the spool, so a broken mail transport shows up as spool depth and never as
    a failed request.
    """

    def __init__(
        self,
        spool: Spool,
        notifier: Notifier,
        clock: Clock,
        logger: logging.Logger,
        interval_s: int,
        max_attempts: int,
    ) -> None:
        self._spool = spool
        self._notifier = notifier
        self._clock = clock
        self._logger = logger
        self._interval_s = interval_s
        self._max_attempts = max_attempts
        self._stopped = False

    def drain_once(self) -> int:
        sent = 0
        for entry in self._spool.take():
            try:
                self._notifier.send(entry.to, entry.subject, entry.body)
                sent += 1
            except Undeliverable as exc:
                entry.attempts += 1
                entry.last_error = str(exc)
                if entry.attempts >= self._max_attempts:
                    self._spool.bury(entry)
                    self._logger.error("buried to=%s subject=%s", entry.to, entry.subject)
                else:
                    self._spool.requeue(entry)
        return sent

    def run_forever(self) -> None:  # pragma: no cover - a loop
        while not self._stopped:
            self.drain_once()
            time.sleep(self._interval_s)

    def stop(self) -> None:
        self._stopped = True
