from decimal import Decimal

from ledger.invoice import invoice_total
from ledger.report import grand_total, monthly_totals

# Grader-only. Every assertion goes through a name the rename does not touch, so the suite is green
# both before the rename and after it. Whether the rename was finished is decided by the
# forbidden-string check, not by these tests.


def test_an_empty_invoice_totals_zero():
    assert invoice_total([]) == Decimal("0")


def test_fractional_prices_are_not_rounded():
    assert invoice_total([(3, "0.10")]) == Decimal("0.30")


def test_monthly_totals_are_keyed_by_month():
    months = {"2026-02": [(2, "2.50")], "2026-01": [(1, "5.00")]}
    assert monthly_totals(months) == {"2026-01": Decimal("5.00"), "2026-02": Decimal("5.00")}


def test_the_grand_total_of_no_months_is_zero():
    assert grand_total({}) == Decimal("0")


def test_the_grand_total_matches_the_sum_of_the_months():
    months = {"2026-01": [(1, "5.00"), (2, "1.25")], "2026-02": [(4, "0.75")]}
    assert grand_total(months) == sum(monthly_totals(months).values(), Decimal("0"))
