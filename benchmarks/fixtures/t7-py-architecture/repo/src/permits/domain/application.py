from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

DRAFT = "draft"
SUBMITTED = "submitted"
IN_REVIEW = "in_review"
GRANTED = "granted"
REFUSED = "refused"
WITHDRAWN = "withdrawn"

WORK_KINDS = ("extension", "loft", "change_of_use", "demolition", "new_build")


@dataclass(frozen=True)
class Application:
    reference: str
    applicant: str
    address: str
    work_kind: str
    estimated_cost_pence: int
    state: str
    submitted_at: str
    decided_at: str | None = None
    outcome: str | None = None
    note: str = ""
    history: tuple[str, ...] = field(default_factory=tuple)

    def with_state(self, state: str, at: str) -> "Application":
        return replace(self, state=state, history=self.history + (f"{at} {self.state}->{state}",))

    def as_dict(self) -> dict[str, Any]:
        return {
            "reference": self.reference,
            "applicant": self.applicant,
            "address": self.address,
            "workKind": self.work_kind,
            "estimatedCostPence": self.estimated_cost_pence,
            "state": self.state,
            "submittedAt": self.submitted_at,
            "decidedAt": self.decided_at,
            "outcome": self.outcome,
            "note": self.note,
            "history": list(self.history),
        }


def reference_for(sequence: int, at: str) -> str:
    return f"P{at[:4]}-{sequence:05d}"
