from __future__ import annotations


class DomainError(Exception):
    code = "domain_error"
    status = 422


class InvalidApplication(DomainError):
    code = "invalid_application"
    status = 422


class IllegalTransition(DomainError):
    code = "illegal_transition"
    status = 409


class NotPermitted(DomainError):
    """Raised where the caller is checked, which is not where you would expect."""

    code = "not_permitted"
    status = 403


class UnknownApplication(DomainError):
    code = "unknown_application"
    status = 404
