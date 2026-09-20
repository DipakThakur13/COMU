from __future__ import annotations

import importlib
import re
from dataclasses import dataclass, field
from types import ModuleType
from typing import Any, Callable

HANDLERS_PACKAGE = "permits.transport.handlers"
_SEGMENT = re.compile(r"^[a-z][a-z0-9_]*$")
_module_cache: dict[str, ModuleType] = {}


@dataclass
class Request:
    method: str
    path: str
    headers: dict[str, str] = field(default_factory=dict)
    body: dict[str, Any] = field(default_factory=dict)
    args: list[str] = field(default_factory=list)
    actor: str = ""


@dataclass
class Response:
    status: int
    body: Any
    headers: dict[str, str] = field(default_factory=dict)


Handler = Callable[[Request], Response]


class NoSuchRoute(LookupError):
    pass


def resolve_handler(method: str, path: str) -> tuple[Handler, list[str]]:
    """Find a handler by naming convention rather than by looking it up in a table.

    There is no route table in this package. The first path segment names a module inside
    :data:`HANDLERS_PACKAGE` and the method names a function inside it: ``POST /applications``
    resolves to ``permits.transport.handlers.applications.handle_post`` and every remaining
    segment is passed along as a positional argument. A segment that is not a plain lowercase
    identifier is refused before any import is attempted, which is the only thing standing
    between a URL and :func:`importlib.import_module`.

    The import is also lazy and cached here, so a handler module that fails to import does not
    break start-up; it produces a 500 the first time somebody calls that endpoint and never
    before.
    """
    segments = [segment for segment in path.split("/") if segment]
    if not segments:
        raise NoSuchRoute(path)

    head, rest = segments[0], segments[1:]
    if not _SEGMENT.match(head):
        raise NoSuchRoute(path)

    module = _module_cache.get(head)
    if module is None:
        try:
            module = importlib.import_module(f"{HANDLERS_PACKAGE}.{head}")
        except ModuleNotFoundError as exc:  # the module genuinely does not exist
            raise NoSuchRoute(path) from exc
        _module_cache[head] = module

    function = getattr(module, f"handle_{method.lower()}", None)
    if function is None:
        raise NoSuchRoute(f"{method} {path}")
    return function, rest


def dispatch(request: Request) -> Response:
    from permits.domain.errors import DomainError

    try:
        handler, rest = resolve_handler(request.method, request.path)
    except NoSuchRoute:
        return Response(404, {"error": "no_such_route", "path": request.path})

    request.args = rest
    try:
        return handler(request)
    except DomainError as exc:
        return Response(exc.status, {"error": exc.code, "detail": str(exc)})
