"""Monthly rollups over invoice lines."""

from decimal import Decimal

from ledger.invoice import Line
from ledger.totals import compute_total


def monthly_totals(months: dict[str, list[Line]]) -> dict[str, Decimal]:
    rolled: dict[str, Decimal] = {}
    for month, lines in sorted(months.items()):
        quantities = [quantity for quantity, _ in lines]
        prices = [Decimal(price) for _, price in lines]
        rolled[month] = compute_total(quantities, prices)
    return rolled


def grand_total(months: dict[str, list[Line]]) -> Decimal:
    return sum(monthly_totals(months).values(), Decimal("0"))
