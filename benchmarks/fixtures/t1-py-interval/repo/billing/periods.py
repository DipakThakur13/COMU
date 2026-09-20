"""Helpers for splitting a subscription into billing periods."""

from datetime import date, timedelta


def days_in_period(start: date, end: date) -> int:
    """Number of days a billing period covers, counting both endpoints."""
    return (end - start).days


def split_periods(start: date, end: date, length_days: int) -> list[tuple[date, date]]:
    """Splits [start, end] into consecutive periods of at most length_days."""
    periods: list[tuple[date, date]] = []
    cursor = start
    while cursor <= end:
        stop = min(cursor + timedelta(days=length_days - 1), end)
        periods.append((cursor, stop))
        cursor = stop + timedelta(days=1)
    return periods
