from __future__ import annotations

import pytest

from permits.transport.dispatch import NoSuchRoute, resolve_handler


def test_a_path_segment_names_the_handler_module():
    handler, rest = resolve_handler("GET", "/health")
    assert handler.__module__ == "permits.transport.handlers.health"
    assert rest == []


def test_remaining_segments_become_arguments():
    handler, rest = resolve_handler("GET", "/applications/P2024-00007")
    assert handler.__name__ == "handle_get"
    assert rest == ["P2024-00007"]


def test_an_unknown_head_segment_is_not_a_route():
    with pytest.raises(NoSuchRoute):
        resolve_handler("GET", "/does_not_exist")


def test_a_method_without_a_function_is_not_a_route():
    with pytest.raises(NoSuchRoute):
        resolve_handler("DELETE", "/applications/P2024-00007")


@pytest.mark.parametrize("path", ["/../etc", "/Applications", "/9lives", "/a-b"])
def test_only_plain_identifiers_are_allowed_through(path):
    with pytest.raises(NoSuchRoute):
        resolve_handler("GET", path)
