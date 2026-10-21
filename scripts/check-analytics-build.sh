#!/bin/sh
set -eu

# Public tokens are supplied by the approved build configuration, never logged.
if [ "${NEXT_PUBLIC_POSTHOG_ENVIRONMENT:-}" = "production" ]; then
  if [ -z "${NEXT_PUBLIC_POSTHOG_KEY:-}" ] || [ -z "${NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN:-}" ]; then
    echo "Production analytics requires current and legacy project tokens before cutover." >&2
    exit 1
  fi
fi
