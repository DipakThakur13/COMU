from __future__ import annotations

import pytest

from permits.domain.application import (
    Application,
    DRAFT,
    GRANTED,
    IN_REVIEW,
    REFUSED,
    SUBMITTED,
    WITHDRAWN,
)
from permits.domain.errors import IllegalTransition
from permits.domain.state_machine import TERMINAL, may_transition, transition


def make(state: str = DRAFT) -> Application:
    return Application(
        reference="P2024-00001",
        applicant="ada",
        address="12 Long Street",
        work_kind="loft",
        estimated_cost_pence=1_000_00,
        state=state,
        submitted_at="2024-04-01T09:00:00+00:00",
    )


def test_a_draft_may_be_submitted():
    moved = transition(make(DRAFT), SUBMITTED, "2024-04-01T09:01:00+00:00")
    assert moved.state == SUBMITTED
    assert moved.history[-1].endswith("draft->submitted")


def test_withdrawal_is_reachable_from_every_non_terminal_state():
    for state in (DRAFT, SUBMITTED, IN_REVIEW):
        assert may_transition(state, WITHDRAWN)
    for state in TERMINAL:
        assert not may_transition(state, WITHDRAWN)


def test_a_refusal_may_be_resubmitted_but_a_grant_may_not_move():
    assert may_transition(REFUSED, SUBMITTED)
    assert not may_transition(GRANTED, SUBMITTED)


def test_an_illegal_transition_raises():
    with pytest.raises(IllegalTransition):
        transition(make(GRANTED), REFUSED, "2024-04-02T09:00:00+00:00")
