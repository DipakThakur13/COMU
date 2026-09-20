"""Parses the deployment config format: one ``key = value`` per line.

A ``#`` starts a comment and blank lines are ignored. Keys and values are plain text; making sense
of a value is the caller's job.
"""


def parse_config(text: str) -> dict[str, str]:
    """Parses config text into a mapping of key to value."""
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator:
            raise ValueError(f"not a key/value pair: {raw_line!r}")
        values[key.strip()] = value
    return values
