from __future__ import annotations

from permits.domain.application import (
    DRAFT,
    GRANTED,
    IN_REVIEW,
    REFUSED,
    SUBMITTED,
    WITHDRAWN,
    Application,
)
from permits.domain.errors import IllegalTransition

#: The whole workflow, in one place. Read it before believing anything a handler name implies.
TRANSITIONS: dict[str, tuple[str, ...]] = {
    DRAFT: (SUBMITTED, WITHDRAWN),
    SUBMITTED: (IN_REVIEW, WITHDRAWN),
    IN_REVIEW: (GRANTED, REFUSED, WITHDRAWN),
    GRANTED: (),
    REFUSED: (SUBMITTED,),
    WITHDRAWN: (),
}

#: Terminal in the sense that no transition leaves them. REFUSED is deliberately not one of these:
#: a refused application can be resubmitted, which is why a reference can carry two decisions.
TERMINAL = (GRANTED, WITHDRAWN)


def may_transition(current: str, target: str) -> bool:
    return target in TRANSITIONS.get(current, ())


def transition(application: Application, target: str, at: str) -> Application:
    """Move an application, or refuse to.

    Withdrawal is reachable from every state except the two terminal ones, which is why the
    withdraw endpoint does not need to know what state it is looking at.
    """
    if not may_transition(application.state, target):
        raise IllegalTransition(f"{application.state} cannot become {target}")
    return application.with_state(target, at)
