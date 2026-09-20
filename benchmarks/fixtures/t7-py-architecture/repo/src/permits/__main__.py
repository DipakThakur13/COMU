from __future__ import annotations

import sys
import threading

from permits.settings import load_settings
from permits.transport.wsgi import serve
from permits.wiring import build_app


def main(argv: list[str] | None = None) -> int:
    """Process entry point.

    Loads settings, asks :mod:`permits.wiring` for a wired application, starts the spool worker
    on a daemon thread and only then opens the socket. Nothing here knows what a permit is.
    """
    argv = sys.argv[1:] if argv is None else argv
    settings = load_settings()
    if "--port" in argv:
        object.__setattr__(settings, "port", int(argv[argv.index("--port") + 1]))

    app = build_app(settings)

    worker = threading.Thread(target=app.worker.run_forever, name="spool-worker", daemon=True)
    worker.start()

    app.logger.info("starting port=%s dsn=%s", settings.port, bool(settings.dsn))
    serve(app, settings.port)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
