from __future__ import annotations

from typing import Any

from permits.domain.application import WORK_KINDS, Application
from permits.domain.errors import InvalidApplication, NotPermitted

MAX_COST_PENCE = 500_000_000
CASEWORKER_PREFIX = "staff:"


def check_payload(payload: dict[str, Any]) -> list[str]:
    """Field level checks, used when an application is first built."""
    problems: list[str] = []

    applicant = str(payload.get("applicant", "")).strip()
    if len(applicant) < 3:
        problems.append("applicant is too short")

    address = str(payload.get("address", "")).strip()
    if len(address) < 6:
        problems.append("address is too short")

    work_kind = str(payload.get("workKind", ""))
    if work_kind not in WORK_KINDS:
        problems.append("workKind is not a known kind")

    try:
        cost = int(payload.get("estimatedCostPence", -1))
    except (TypeError, ValueError):
        cost = -1
    if cost < 0 or cost > MAX_COST_PENCE:
        problems.append("estimatedCostPence is out of range")

    return problems


def build_or_raise(payload: dict[str, Any], reference: str, at: str) -> Application:
    problems = check_payload(payload)
    if problems:
        raise InvalidApplication("; ".join(problems))
    return Application(
        reference=reference,
        applicant=str(payload["applicant"]).strip(),
        address=str(payload["address"]).strip(),
        work_kind=str(payload["workKind"]),
        estimated_cost_pence=int(payload["estimatedCostPence"]),
        state="draft",
        submitted_at=at,
    )


def assert_caller_may_write(actor: str, application: Application) -> None:
    """Authorisation.

    This is the only access control in the service, and nothing in the transport layer calls it.
    Its single caller is the persistence decorator, so a request is authorised at the moment it
    would be written and not a step earlier: an unauthorised caller still runs the whole service
    method and only fails when the repository is asked to save.

    An applicant may write their own application. Anyone whose actor id starts with the
    caseworker prefix may write any of them. An empty actor may write nothing.
    """
    if actor.startswith(CASEWORKER_PREFIX):
        return
    if actor and actor == application.applicant:
        return
    raise NotPermitted(f"{actor or 'anonymous'} may not write {application.reference}")
