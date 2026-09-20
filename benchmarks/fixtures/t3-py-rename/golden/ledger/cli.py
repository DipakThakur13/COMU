"""Command line entry point. Nothing in the test suite imports this module."""

import sys
from decimal import Decimal

from ledger.totals import compute_total


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) % 2 != 0:
        print("usage: ledger QUANTITY PRICE [QUANTITY PRICE ...]")
        return 2
    quantities = [int(value) for value in args[0::2]]
    prices = [Decimal(value) for value in args[1::2]]
    print(compute_total(quantities, prices))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
