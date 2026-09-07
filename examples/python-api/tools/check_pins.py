#!/usr/bin/env python3
"""Every requirement must be pinned with ==."""
import os
import sys

root = os.environ.get("PREFLIGHT_ROOT", os.getcwd())
problems = []

for rel in sys.argv[1:]:
    path = os.path.join(root, rel)
    if not os.path.exists(path):
        continue
    with open(path, encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            text = line.split("#")[0].strip()
            if not text or text.startswith("-"):
                continue
            if "==" not in text:
                problems.append(f"{rel}:{number}  {text!r} is not pinned")

if problems:
    print("\n".join(problems), file=sys.stderr)
    sys.exit(1)
