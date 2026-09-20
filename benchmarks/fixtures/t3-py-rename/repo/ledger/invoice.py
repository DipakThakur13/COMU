"""One invoice, made of (quantity, unit price) lines."""

from decimal import Decimal

from ledger.totals import calc_total

Line = tuple[int, str]


def invoice_total(lines: list[Line]) -> Decimal:
    quantities = [quantity for quantity, _ in lines]
    prices = [Decimal(price) for _, price in lines]
    return calc_total(quantities, prices)


def invoice_line_count(lines: list[Line]) -> int:
    return len(lines)
