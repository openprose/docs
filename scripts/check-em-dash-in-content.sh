#!/usr/bin/env bash
set -euo pipefail

# Find em dashes in MDX and Markdown content (excluding code blocks is hard
# in shell; allow false positives inside fenced blocks for v1).
FOUND=$(grep -rln "—" content/ README.md 2>/dev/null || true)
if [[ -n "$FOUND" ]]; then
  echo "Em dashes (—) found in content. Files:"
  echo "$FOUND"
  echo "Replace with -- per house style."
  exit 1
fi
exit 0
