import dataclasses

import pytest

from orders.validation import FieldError, is_count, is_currency_code, is_money, is_text


def test_is_text_accepts_a_word():
    assert is_text("A-1")


def test_is_text_rejects_blank_and_non_strings():
    assert not is_text("")
    assert not is_text("   ")
    assert not is_text(None)
    assert not is_text(7)


def test_is_currency_code_accepts_three_uppercase_letters():
    assert is_currency_code("EUR")
    assert is_currency_code("GBP")


def test_is_currency_code_rejects_anything_else():
    assert not is_currency_code("eur")
    assert not is_currency_code("EURO")
    assert not is_currency_code("E1R")
    assert not is_currency_code(978)


def test_is_count_requires_a_whole_number_of_at_least_one():
    assert is_count(1)
    assert is_count(40)
    assert not is_count(0)
    assert not is_count(-3)
    assert not is_count(1.0)
    assert not is_count("2")


def test_is_count_rejects_booleans():
    assert not is_count(True)
    assert not is_count(False)


def test_is_money_allows_zero_and_floats():
    assert is_money(0)
    assert is_money(12)
    assert is_money(9.99)


def test_is_money_rejects_negatives_booleans_and_text():
    assert not is_money(-0.01)
    assert not is_money(True)
    assert not is_money("9.99")


def test_field_error_is_a_frozen_record():
    error = FieldError("id", "missing", "id is required")
    assert (error.field, error.code, error.message) == ("id", "missing", "id is required")
    assert error == FieldError("id", "missing", "id is required")
    with pytest.raises(dataclasses.FrozenInstanceError):
        error.field = "customer"
