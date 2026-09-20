"""Field-level checks for the order payloads the storefront posts to us."""

from dataclasses import dataclass


@dataclass(frozen=True)
class FieldError:
    """One thing wrong with one field.

    ``field`` is the dotted path to it, ``code`` says whether it was absent or unusable, and
    ``message`` is for whoever reads the rejection.
    """

    field: str
    code: str
    message: str


def is_text(value: object) -> bool:
    """True for a string with something other than whitespace in it."""
    return isinstance(value, str) and value.strip() != ""


def is_currency_code(value: object) -> bool:
    """True for exactly three uppercase ASCII letters, the way ISO 4217 writes them."""
    return (
        isinstance(value, str)
        and len(value) == 3
        and value.isascii()
        and value.isalpha()
        and value.isupper()
    )


def is_count(value: object) -> bool:
    """True for a whole number of at least one. A bool is not a count, however much it is an int."""
    return isinstance(value, int) and not isinstance(value, bool) and value >= 1


def is_money(value: object) -> bool:
    """True for a non-negative amount. A bool is not an amount; neither is a NaN."""
    if isinstance(value, bool):
        return False
    return isinstance(value, (int, float)) and value >= 0
