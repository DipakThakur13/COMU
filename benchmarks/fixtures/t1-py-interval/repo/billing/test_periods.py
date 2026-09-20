from datetime import date

from billing.periods import days_in_period, split_periods


def test_a_single_day_period_covers_one_day():
    assert days_in_period(date(2026, 1, 1), date(2026, 1, 1)) == 1


def test_splitting_produces_consecutive_periods():
    periods = split_periods(date(2026, 1, 1), date(2026, 1, 6), 3)
    assert periods == [(date(2026, 1, 1), date(2026, 1, 3)), (date(2026, 1, 4), date(2026, 1, 6))]
