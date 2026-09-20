"""Handler modules.

Nothing imports the modules in this package. :func:`permits.transport.dispatch.resolve_handler`
imports them by name on the first request that needs one, so adding a file here adds an endpoint
and deleting one removes it, with no registration step in between.
"""
