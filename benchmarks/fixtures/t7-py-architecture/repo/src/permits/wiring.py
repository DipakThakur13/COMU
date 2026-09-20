from __future__ import annotations

import logging
from dataclasses import dataclass

from permits.adapters.repository_factory import build_repository
from permits.adapters.spool_notifier import SpoolNotifier
from permits.adapters.stdout_notifier import StdoutNotifier
from permits.adapters.system_clock import SystemClock
from permits.cache.decision_cache import DecisionCache
from permits.ports.clock import Clock
from permits.ports.notifier import Notifier
from permits.ports.repository import Repository
from permits.queue.spool import Spool
from permits.queue.worker import SpoolWorker
from permits.services.intake_service import IntakeService
from permits.services.notify_service import NotifyService
from permits.services.review_service import ReviewService
from permits.settings import Settings

_current: "App | None" = None


@dataclass
class App:
    settings: Settings
    clock: Clock
    logger: logging.Logger
    repository: Repository
    cache: DecisionCache
    spool: Spool
    notifier: Notifier
    worker: SpoolWorker
    intake: IntakeService
    review: ReviewService
    notify: NotifyService


def build_app(settings: Settings) -> App:
    """The composition root.

    The only function in the package where a concrete class is given to a port. Handlers are not
    passed anything: they are imported on demand by the dispatcher and call :func:`app` instead.
    """
    global _current

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    logger = logging.getLogger("permits")
    clock = SystemClock()

    repository = build_repository(settings, clock, logger)
    cache = DecisionCache(clock, settings.decision_ttl_s)
    spool = Spool(clock)

    notifier: Notifier = SpoolNotifier(spool) if settings.notifier == "spool" else StdoutNotifier()
    worker = SpoolWorker(spool, notifier, clock, logger, settings.spool_interval_s, settings.spool_max_attempts)

    intake = IntakeService(repository, clock, logger)
    review = ReviewService(repository, cache, clock, logger)
    notify = NotifyService(spool, clock)

    _current = App(
        settings=settings,
        clock=clock,
        logger=logger,
        repository=repository,
        cache=cache,
        spool=spool,
        notifier=notifier,
        worker=worker,
        intake=intake,
        review=review,
        notify=notify,
    )
    return _current


def app() -> App:
    """Handlers reach their dependencies through this, because nothing hands them any."""
    if _current is None:
        raise RuntimeError("app() called before build_app()")
    return _current
