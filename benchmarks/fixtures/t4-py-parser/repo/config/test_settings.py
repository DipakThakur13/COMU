from config.parser import parse_config
from config.settings import Settings

CONFIG = """
# deployment settings for staging

host = example.com
port = 8080
debug = true
regions = eu,us
"""


def test_the_keys_of_the_file_are_read():
    assert set(parse_config(CONFIG)) == {"host", "port", "debug", "regions"}


def test_a_missing_key_falls_back_to_the_default():
    assert Settings(CONFIG).get("timezone", "UTC") == "UTC"


def test_a_flag_is_read_as_a_boolean():
    assert Settings(CONFIG).get_bool("debug") is True


def test_a_number_is_read_as_a_whole_number():
    assert Settings(CONFIG).get_int("port") == 8080


def test_the_endpoint_joins_the_host_and_the_port():
    assert Settings(CONFIG).endpoint() == "example.com:8080"
