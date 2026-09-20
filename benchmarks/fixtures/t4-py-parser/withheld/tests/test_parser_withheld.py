from config.parser import parse_config
from config.settings import Settings

# Grader-only. These go at the parser itself and at a fourth accessor, so a fix that trims the
# value inside get_bool, get_int and endpoint leaves them failing.


def test_a_value_is_trimmed_like_its_key():
    assert parse_config("host = example.com\nport=8080\n") == {
        "host": "example.com",
        "port": "8080",
    }


def test_spaces_inside_a_value_are_kept():
    assert parse_config("greeting =  hello  world  \n") == {"greeting": "hello  world"}


def test_a_tab_around_the_separator_is_trimmed():
    assert parse_config("name\t=\tcomu\n") == {"name": "comu"}


def test_an_empty_value_stays_empty():
    assert parse_config("token =\n") == {"token": ""}


def test_a_value_containing_an_equals_sign_is_kept_whole():
    assert parse_config("dsn = db=main;replica=2\n") == {"dsn": "db=main;replica=2"}


def test_comments_and_blank_lines_are_still_ignored():
    assert parse_config("# a note\n\nkey = value\n  # indented note\n") == {"key": "value"}


def test_a_list_value_splits_into_items():
    assert Settings("regions = eu,us\n").get_list("regions") == ["eu", "us"]


def test_a_flag_written_without_spaces_is_still_a_flag():
    assert Settings("debug=yes\nquiet = off\n").get_bool("debug") is True
    assert Settings("debug=yes\nquiet = off\n").get_bool("quiet") is False
