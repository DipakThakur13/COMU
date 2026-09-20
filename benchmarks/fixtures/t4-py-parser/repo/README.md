# appconfig

Reads the deployment config file: one `key = value` per line, `#` starts a comment, blank lines are
ignored. `config/parser.py` turns the text into a mapping; `config/settings.py` puts a typed
accessor over it.

Run the tests with `pytest`.
