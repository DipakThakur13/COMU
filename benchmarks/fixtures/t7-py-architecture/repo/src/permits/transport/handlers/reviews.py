from __future__ import annotations

from permits.transport.dispatch import Request, Response
from permits.wiring import app


def handle_post(request: Request) -> Response:
    """POST /reviews/<reference>  {"outcome": "granted"|"refused", "note": "..."}."""
    if not request.args:
        return Response(400, {"error": "reference_required"})

    outcome = str(request.body.get("outcome", ""))
    note = str(request.body.get("note", ""))
    current = app()
    decided = current.review.record_decision(request.args[0], outcome, note, actor=request.actor)

    # The handler queues the letter, not the service that made the decision. ReviewService holds
    # no notifier and no spool, so a decision recorded by any other caller sends nothing.
    current.notify.decision_reached(decided)
    return Response(200, {"reference": decided.reference, "state": decided.state})


def handle_get(request: Request) -> Response:
    """GET /reviews/<reference>."""
    if not request.args:
        return Response(400, {"error": "reference_required"})
    decision = app().review.decision_for(request.args[0])
    if decision is None:
        return Response(404, {"error": "no_decision"})
    return Response(200, decision)
