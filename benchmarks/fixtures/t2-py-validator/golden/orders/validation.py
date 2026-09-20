"""Field-level checks for the order payloads the storefront posts to us."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Callable


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


def validate_order(payload: object) -> list[FieldError]:
    """Everything wrong with an order payload, in the order a reader would go looking.

    An empty list means the payload is usable. One error per offending field at most: the first
    thing wrong with a field is the thing worth saying about it.
    """
    if not isinstance(payload, Mapping):
        return [FieldError("payload", "invalid", "the order must be a mapping")]

    errors: list[FieldError] = []
    _check(errors, payload, "id", is_text, "must be a non-empty string")
    _check(errors, payload, "customer", is_text, "must be a non-empty string")
    _check(errors, payload, "currency", is_currency_code, "must be a three-letter uppercase currency code")
    errors.extend(_item_errors(payload))
    return errors


def _item_errors(payload: Mapping) -> list[FieldError]:
    if "items" not in payload:
        return [FieldError("items", "missing", "items is required")]

    items = payload["items"]
    if not isinstance(items, list) or not items:
        return [FieldError("items", "invalid", "items must be a non-empty list")]

    errors: list[FieldError] = []
    for index, item in enumerate(items):
        path = f"items[{index}]"
        if not isinstance(item, Mapping):
            errors.append(FieldError(path, "invalid", f"{path} must be a mapping"))
            continue
        _check(errors, item, "sku", is_text, "must be a non-empty string", path)
        _check(errors, item, "quantity", is_count, "must be a whole number of at least one", path)
        _check(errors, item, "unit_price", is_money, "must be a non-negative amount", path)
    return errors


def _check(
    errors: list[FieldError],
    mapping: Mapping,
    key: str,
    usable: Callable[[object], bool],
    requirement: str,
    prefix: str = "",
) -> None:
    field = f"{prefix}.{key}" if prefix else key
    if key not in mapping:
        errors.append(FieldError(field, "missing", f"{field} is required"))
    elif not usable(mapping[key]):
        errors.append(FieldError(field, "invalid", f"{field} {requirement}"))
