from decimal import Decimal

from ledger.invoice import invoice_line_count, invoice_total
from ledger.report import grand_total


def test_an_invoice_totals_quantity_times_price():
    assert invoice_total([(2, "3.50"), (1, "10.00")]) == Decimal("17.00")


def test_the_line_count_is_the_number_of_lines():
    assert invoice_line_count([(2, "3.50"), (1, "10.00")]) == 2


def test_the_grand_total_adds_every_month():
    months = {"2026-01": [(1, "5.00")], "2026-02": [(2, "2.50")]}
    assert grand_total(months) == Decimal("10.00")
