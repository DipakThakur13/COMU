from __future__ import annotations

import logging

from permits.adapters.system_clock import FrozenClock
from permits.ports.notifier import Undeliverable
from permits.queue.spool import Spool
from permits.queue.worker import SpoolWorker


class FlakyNotifier:
    kind = "flaky"

    def __init__(self, failures: int) -> None:
        self.failures = failures
        self.sent: list[str] = []

    def send(self, to: str, subject: str, body: str) -> None:
        del body
        if self.failures > 0:
            self.failures -= 1
            raise Undeliverable("smtp said no")
        self.sent.append(f"{to}:{subject}")


def make(failures: int, max_attempts: int = 3):
    clock = FrozenClock("2024-04-01T09:00:00+00:00")
    spool = Spool(clock)
    notifier = FlakyNotifier(failures)
    worker = SpoolWorker(spool, notifier, clock, logging.getLogger("test"), 0, max_attempts)
    return spool, notifier, worker


def test_a_letter_is_sent_on_the_first_drain():
    spool, notifier, worker = make(failures=0)
    spool.put("ada", "Decision on P2024-00001", "body")
    assert worker.drain_once() == 1
    assert notifier.sent == ["ada:Decision on P2024-00001"]
    assert spool.depth() == 0


def test_a_failure_is_requeued_and_eventually_succeeds():
    spool, notifier, worker = make(failures=1)
    spool.put("ada", "Decision on P2024-00001", "body")
    assert worker.drain_once() == 0
    assert spool.depth() == 1
    assert worker.drain_once() == 1
    assert notifier.sent


def test_a_letter_is_buried_after_the_attempt_limit():
    spool, _notifier, worker = make(failures=99, max_attempts=2)
    spool.put("ada", "Decision on P2024-00001", "body")
    worker.drain_once()
    worker.drain_once()
    assert spool.depth() == 0
    assert spool.dead_depth() == 1
