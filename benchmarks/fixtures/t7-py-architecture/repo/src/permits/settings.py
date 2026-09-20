from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    port: int
    dsn: str
    actor: str
    decision_ttl_s: int
    spool_interval_s: int
    spool_max_attempts: int
    notifier: str


def _int(raw: str | None, fallback: int) -> int:
    try:
        return int(raw) if raw not in (None, "") else fallback
    except ValueError:
        return fallback


def load_settings(env: dict[str, str] | None = None) -> Settings:
    env = dict(os.environ if env is None else env)
    return Settings(
        port=_int(env.get("PORT"), 8080),
        dsn=env.get("PERMITS_DSN", ""),
        actor=env.get("PERMITS_ACTOR", ""),
        decision_ttl_s=_int(env.get("DECISION_TTL_S"), 900),
        spool_interval_s=_int(env.get("SPOOL_INTERVAL_S"), 5),
        spool_max_attempts=_int(env.get("SPOOL_MAX_ATTEMPTS"), 5),
        notifier=env.get("PERMITS_NOTIFIER", "spool"),
    )
