from __future__ import annotations

from permits.adapters.system_clock import FrozenClock
from permits.cache.decision_cache import DecisionCache


def test_an_entry_is_returned_until_its_ttl_expires():
    clock = FrozenClock("2024-04-01T09:00:00+00:00")
    cache = DecisionCache(clock, ttl_s=60)
    cache.put("P2024-00001", {"outcome": "granted"})

    clock.advance(59)
    assert cache.get("P2024-00001") == {"outcome": "granted"}

    clock.advance(2)
    assert cache.get("P2024-00001") is None
    assert cache.size() == 0


def test_invalidate_removes_an_entry():
    clock = FrozenClock("2024-04-01T09:00:00+00:00")
    cache = DecisionCache(clock, ttl_s=60)
    cache.put("P2024-00001", {"outcome": "granted"})
    cache.invalidate("P2024-00001")
    assert cache.get("P2024-00001") is None
