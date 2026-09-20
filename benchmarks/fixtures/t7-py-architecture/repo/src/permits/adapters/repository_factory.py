from __future__ import annotations

import logging

from permits.adapters.audited_repository import AuditedRepository
from permits.adapters.memory_repository import MemoryRepository
from permits.adapters.sqlite_repository import SqliteRepository
from permits.audit.trail import AuditTrail
from permits.ports.clock import Clock
from permits.ports.repository import Repository
from permits.settings import Settings


def build_repository(settings: Settings, clock: Clock, logger: logging.Logger) -> Repository:
    """Pick the store, then hide the choice.

    An empty ``PERMITS_DSN`` means MemoryRepository and a set one means SqliteRepository, which is
    the obvious half. The half that matters is the last line: whichever store is chosen is always
    wrapped in AuditedRepository, so no caller anywhere ever holds a bare repository, and the
    authorisation and audit behaviour cannot be switched off by configuration.
    """
    inner: Repository = SqliteRepository(settings.dsn) if settings.dsn else MemoryRepository()
    logger.info("repository_selected kind=%s", inner.kind)
    return AuditedRepository(inner, AuditTrail(clock), logger)
