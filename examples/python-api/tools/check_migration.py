#!/usr/bin/env python3
"""models.py changed; a migration must have been added alongside it."""
import os
import sys

changed = [f for f in os.environ.get("PREFLIGHT_CHANGED_FILES", "").split("\n") if f]
migrations = [f for f in changed if f.startswith("migrations/") and f.endswith(".py")]

if not migrations:
    print("app/models.py changed but no new file under migrations/", file=sys.stderr)
    print("Run `alembic revision --autogenerate -m '<what changed>'` and commit it.", file=sys.stderr)
    sys.exit(1)
