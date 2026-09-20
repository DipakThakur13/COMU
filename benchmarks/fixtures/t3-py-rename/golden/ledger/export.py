"""CSV export for the finance team. Nothing in the test suite imports this module."""

from decimal import Decimal

from ledger.invoice import Line
from ledger.totals import compute_total


def export_csv(invoices: dict[str, list[Line]]) -> str:
    rows = ["invoice,total"]
    for reference, lines in sorted(invoices.items()):
        quantities = [quantity for quantity, _ in lines]
        prices = [Decimal(price) for _, price in lines]
        rows.append(f"{reference},{compute_total(quantities, prices)}")
    return "\n".join(rows)
