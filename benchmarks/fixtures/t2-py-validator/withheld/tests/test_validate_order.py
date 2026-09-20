"""Grader-only.

The feature does not exist in the starting tree, so nothing the agent can see covers it. These are
the whole specification of the new behaviour, edge cases included.
"""

from orders import validation
from orders.validation import FieldError


def validate_order(payload):
    """Resolved when a test runs, not when this module is imported.

    A top-level ``from orders.validation import validate_order`` would make the missing feature a
    collection error, and pytest then reports one error instead of the suite, which loses the
    baseline the grader compares against.
    """
    return validation.validate_order(payload)


def valid_order(**overrides):
    order = {
        "id": "ord-1",
        "customer": "ada@example.com",
        "currency": "EUR",
        "items": [{"sku": "A-1", "quantity": 2, "unit_price": 9.99}],
    }
    order.update(overrides)
    return order


def codes(errors):
    return [(error.field, error.code) for error in errors]


def test_a_valid_order_has_no_errors():
    assert validate_order(valid_order()) == []


def test_missing_top_level_fields_are_reported_in_order():
    assert codes(validate_order({})) == [
        ("id", "missing"),
        ("customer", "missing"),
        ("currency", "missing"),
        ("items", "missing"),
    ]


def test_a_blank_id_is_invalid_rather_than_missing():
    assert codes(validate_order(valid_order(id="   "))) == [("id", "invalid")]
    assert codes(validate_order(valid_order(customer=None))) == [("customer", "invalid")]


def test_a_bad_currency_code_is_invalid():
    for bad in ["eur", "EURO", "E1R", 978]:
        assert codes(validate_order(valid_order(currency=bad))) == [("currency", "invalid")]


def test_a_missing_items_key_is_missing_not_invalid():
    order = valid_order()
    del order["items"]
    assert codes(validate_order(order)) == [("items", "missing")]


def test_items_must_be_a_non_empty_list():
    for bad in [[], {}, "A-1", None]:
        assert codes(validate_order(valid_order(items=bad))) == [("items", "invalid")]


def test_item_error_paths_carry_the_index():
    order = valid_order(
        items=[
            {"sku": "A-1", "quantity": 1, "unit_price": 1},
            {"quantity": 0, "unit_price": -2},
        ]
    )
    assert codes(validate_order(order)) == [
        ("items[1].sku", "missing"),
        ("items[1].quantity", "invalid"),
        ("items[1].unit_price", "invalid"),
    ]


def test_quantity_must_be_a_whole_number_of_at_least_one():
    for bad in [0, -1, 1.5, "2"]:
        order = valid_order(items=[{"sku": "A-1", "quantity": bad, "unit_price": 1}])
        assert codes(validate_order(order)) == [("items[0].quantity", "invalid")]


def test_a_boolean_is_not_a_quantity_or_a_price():
    order = valid_order(items=[{"sku": "A-1", "quantity": True, "unit_price": False}])
    assert codes(validate_order(order)) == [
        ("items[0].quantity", "invalid"),
        ("items[0].unit_price", "invalid"),
    ]


def test_a_unit_price_of_zero_is_allowed_but_a_negative_one_is_not():
    assert validate_order(valid_order(items=[{"sku": "A-1", "quantity": 1, "unit_price": 0}])) == []
    order = valid_order(items=[{"sku": "A-1", "quantity": 1, "unit_price": -0.01}])
    assert codes(validate_order(order)) == [("items[0].unit_price", "invalid")]


def test_a_non_mapping_item_is_reported_once():
    order = valid_order(items=["A-1", {"sku": "B-2", "quantity": 1, "unit_price": 1}])
    assert codes(validate_order(order)) == [("items[0]", "invalid")]


def test_a_non_mapping_payload_is_reported():
    for bad in [None, [], "an order", 7]:
        errors = validate_order(bad)
        assert len(errors) == 1
        assert errors[0].field == "payload"
        assert errors[0].code == "invalid"


def test_unknown_keys_are_ignored():
    assert validate_order(valid_order(gift_wrap=True, note="leave at the door")) == []


def test_every_error_carries_a_message():
    errors = validate_order({"currency": "eur", "items": [{"quantity": 0}]})
    assert errors
    for error in errors:
        assert isinstance(error, FieldError)
        assert isinstance(error.message, str) and error.message.strip()


def test_several_fields_are_all_reported_together():
    order = {"id": "", "currency": "usd", "items": [{"sku": "A-1", "quantity": 1, "unit_price": 1}]}
    assert codes(validate_order(order)) == [
        ("id", "invalid"),
        ("customer", "missing"),
        ("currency", "invalid"),
    ]
