"""Line-item arithmetic."""

from decimal import Decimal


def compute_total(quantities: list[int], unit_prices: list[Decimal]) -> Decimal:
    """Sum of quantity times unit price over every line item."""
    if len(quantities) != len(unit_prices):
        raise ValueError("quantities and unit_prices must be the same length")
    total = Decimal("0")
    for quantity, price in zip(quantities, unit_prices):
        total += Decimal(quantity) * price
    return total
