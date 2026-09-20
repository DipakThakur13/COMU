"""Typed access to a parsed config file."""

from config.parser import parse_config

TRUE_WORDS = frozenset({"true", "yes", "on", "1"})


class Settings:
    """A parsed config file, read through typed accessors."""

    def __init__(self, text: str) -> None:
        self._values = parse_config(text)

    def get(self, key: str, default: str = "") -> str:
        """The raw value of a key, or ``default`` when it is absent."""
        return self._values.get(key, default)

    def get_bool(self, key: str) -> bool:
        """True when the value is one of the affirmative words."""
        return self.get(key).lower() in TRUE_WORDS

    def get_int(self, key: str) -> int:
        """The value as a whole number."""
        value = self.get(key)
        if not value.isdigit():
            raise ValueError(f"{key} is not a whole number: {value!r}")
        return int(value)

    def get_list(self, key: str) -> list[str]:
        """A comma separated value as a list."""
        value = self.get(key)
        if not value:
            return []
        return value.split(",")

    def endpoint(self) -> str:
        """The host and port the service listens on."""
        return f"{self.get('host')}:{self.get_int('port')}"
