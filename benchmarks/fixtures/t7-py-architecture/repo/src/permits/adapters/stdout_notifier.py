from __future__ import annotations

import sys


class StdoutNotifier:
    """Prints the letter. Used on a laptop and by the acceptance tests."""

    kind = "stdout"

    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send(self, to: str, subject: str, body: str) -> None:
        self.sent.append((to, subject))
        sys.stdout.write(f"--- to {to}: {subject}\n{body}\n")
