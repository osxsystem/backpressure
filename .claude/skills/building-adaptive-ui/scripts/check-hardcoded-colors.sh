#!/usr/bin/env bash
# check-hardcoded-colors.sh — fail if source files contain hardcoded colors.
#
# Usage: check-hardcoded-colors.sh <path> [<path> ...]
#
# Greps the given files/dirs for hardcoded color literals (hex like #1e1e1e or
# #fff, and rgb()/rgba()/hsl()/hsla() functions). Exits 1 and prints the
# offending lines if any are found, 0 otherwise. Adaptive UI uses design tokens
# (e.g. var(--color-surface)) instead — see SKILL.md.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: check-hardcoded-colors.sh <path> [<path> ...]" >&2
  exit 2
fi

# Hex (#rgb / #rrggbb / #rrggbbaa) or rgb()/rgba()/hsl()/hsla() function calls.
pattern='#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\('

if grep -rEn "$pattern" "$@"; then
  echo "error: hardcoded colors found — use design tokens instead." >&2
  exit 1
fi

echo "ok: no hardcoded colors found."
exit 0
