from __future__ import annotations

from permits.transport.dispatch import Request, Response
from permits.wiring import app


def handle_post(request: Request) -> Response:
    """POST /applications."""
    current = app()
    stored = current.intake.submit(request.body, actor=request.actor)
    current.notify.acknowledgement(stored)
    return Response(201, {"reference": stored.reference, "state": stored.state}, {"location": f"/applications/{stored.reference}"})


def handle_get(request: Request) -> Response:
    """GET /applications/<reference>."""
    if not request.args:
        return Response(400, {"error": "reference_required"})
    found = app().intake.fetch(request.args[0])
    if found is None:
        return Response(404, {"error": "unknown_application"})
    return Response(200, found.as_dict())


def handle_put(request: Request) -> Response:
    """PUT /applications/<reference>/withdraw."""
    if len(request.args) < 2 or request.args[1] != "withdraw":
        return Response(404, {"error": "no_such_route"})
    updated = app().review.withdraw(request.args[0], actor=request.actor)
    return Response(200, {"reference": updated.reference, "state": updated.state})
