from __future__ import annotations

from permits.transport.dispatch import Request, Response
from permits.wiring import app


def handle_get(_request: Request) -> Response:
    current = app()
    return Response(
        200,
        {
            "ok": True,
            "repository": current.repository.kind,
            "notifier": current.notifier.kind,
            "spool_depth": current.spool.depth(),
            "cached_decisions": current.cache.size(),
            "audit_entries": current.repository.trail_size(),
        },
    )
