from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from permits.transport.dispatch import Request, dispatch


def _make_handler(app: Any) -> type[BaseHTTPRequestHandler]:
    class _Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _run(self, method: str) -> None:
            length = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length else ""
            try:
                body = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                self._write(400, {"error": "malformed_json"})
                return

            request = Request(
                method=method,
                path=self.path.split("?")[0],
                headers={key.lower(): value for key, value in self.headers.items()},
                body=body,
                actor=self.headers.get("x-actor", app.settings.actor),
            )
            response = dispatch(request)
            self._write(response.status, response.body, response.headers)

        def _write(self, status: int, body: Any, headers: dict[str, str] | None = None) -> None:
            payload = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self) -> None:  # noqa: N802
            self._run("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._run("POST")

        def do_PUT(self) -> None:  # noqa: N802
            self._run("PUT")

        def log_message(self, fmt: str, *args: Any) -> None:
            app.logger.info("http " + fmt, *args)

    return _Handler


def serve(app: Any, port: int) -> None:
    """Blocking. The actor header is trusted here and checked much further down."""
    server = ThreadingHTTPServer(("0.0.0.0", port), _make_handler(app))
    server.serve_forever()
