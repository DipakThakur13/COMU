from datetime import date

from billing.periods import days_in_period, split_periods


# Grader-only. The visible test covers a single day; these cover the general case, so a fix that
# special-cases equal dates does not pass.
def test_a_week_counts_seven_days():
    assert days_in_period(date(2026, 3, 2), date(2026, 3, 8)) == 7


def test_period_lengths_match_the_requested_length():
    periods = split_periods(date(2026, 1, 1), date(2026, 1, 10), 4)
    assert [days_in_period(a, b) for a, b in periods] == [4, 4, 2]


def test_the_periods_cover_the_whole_range_without_gaps():
    start, end = date(2026, 5, 1), date(2026, 5, 31)
    periods = split_periods(start, end, 7)
    assert periods[0][0] == start
    assert periods[-1][1] == end
    assert sum(days_in_period(a, b) for a, b in periods) == days_in_period(start, end)
