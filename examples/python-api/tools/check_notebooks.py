#!/usr/bin/env python3
"""Notebooks must be committed with their outputs cleared."""
import json
import os
import sys

root = os.environ.get("PREFLIGHT_ROOT", os.getcwd())
problems = []

for rel in sys.argv[1:]:
    path = os.path.join(root, rel)
    if not os.path.exists(path):
        continue
    with open(path, encoding="utf-8") as handle:
        try:
            notebook = json.load(handle)
        except json.JSONDecodeError as error:
            problems.append(f"{rel}  is not valid JSON ({error})")
            continue
    for index, cell in enumerate(notebook.get("cells", [])):
        if cell.get("outputs") or cell.get("execution_count") is not None:
            problems.append(f"{rel}  cell {index} still has outputs")

if problems:
    print("\n".join(problems), file=sys.stderr)
    print("\nRun `nbstripout` on it before committing.", file=sys.stderr)
    sys.exit(1)
