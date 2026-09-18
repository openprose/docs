#!/usr/bin/env bash
set -euo pipefail

# Checks a running docs site's /robots.txt the way a crawler fetches it:
# HTTP 200, text/plain, a Googlebot allow rule, and the canonical sitemap.
# A 5xx on this route makes Google stop crawling the whole site, and the Fly
# health check only probes /, so a healthy homepage can hide it. The body
# checks mirror the public-mode checks in scripts/smoke-standalone.ts.
#
# Usage: scripts/check-live-robots.sh [BASE_URL]
#   BASE_URL defaults to https://docs.prose.md. Point it at a local
#   standalone server (http://127.0.0.1:3100) to try it against a build.

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [BASE_URL]" >&2
  exit 2
fi

BASE_URL="${1:-https://docs.prose.md}"
URL="${BASE_URL%/}/robots.txt"
# app/robots.ts always advertises the canonical host, whatever host serves it.
SITEMAP_LINE="Sitemap: https://docs.prose.md/sitemap.xml"
# The machine may be stopped and take a few seconds to start, so retry until
# the route answers 200: at most 10 requests, 6 seconds apart.
ATTEMPTS=10
RETRY_DELAY_SECONDS=6

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
body="$tmp_dir/body"
headers="$tmp_dir/headers"

print_body_head() {
  if [[ -s "$body" ]]; then
    echo "      body (first 200 bytes):"
    head -c 200 "$body" | awk '{ print "        " $0 }'
  fi
}

attempt=0
while true; do
  attempt=$((attempt + 1))
  rm -f "$body" "$headers"
  curl_exit=0
  # With no HTTP response at all, curl prints 000 and exits non-zero.
  status=$(curl -sS -A "Googlebot" --connect-timeout 10 --max-time 20 \
    -o "$body" -D "$headers" -w '%{http_code}' "$URL") || curl_exit=$?
  if [[ "$curl_exit" -eq 0 && "$status" == "200" ]]; then
    break
  fi

  result="HTTP ${status:-000}"
  if [[ "$curl_exit" -ne 0 ]]; then
    result="$result (curl exit $curl_exit)"
  fi
  if [[ "$attempt" -ge "$ATTEMPTS" ]]; then
    echo "FAIL  GET $URL returned $result after $attempt attempt(s)"
    print_body_head
    exit 1
  fi
  echo "Attempt $attempt of $ATTEMPTS: $result, retrying in ${RETRY_DELAY_SECONDS}s"
  sleep "$RETRY_DELAY_SECONDS"
done
echo "PASS  GET $URL -> 200 (attempt $attempt of $ATTEMPTS)"

# Last Content-Type header, without the name or a trailing CR.
content_type=$(awk '
  tolower($0) ~ /^content-type:/ {
    sub(/\r$/, ""); sub(/^[^:]*:[ \t]*/, ""); value = $0
  }
  END { print value }
' "$headers")

is_text_plain() {
  local lowered
  lowered=$(printf '%s' "$content_type" | tr '[:upper:]' '[:lower:]')
  [[ "$lowered" == text/plain* ]]
}

# True when the body has a line equal to $1.
has_line() {
  awk -v want="$1" '
    { sub(/\r$/, "") }
    $0 == want { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$body"
}

# True when the body has a line equal to $1 directly followed by one equal to $2.
has_line_pair() {
  awk -v first="$1" -v second="$2" '
    { sub(/\r$/, "") }
    previous == first && $0 == second { found = 1 }
    { previous = $0 }
    END { exit found ? 0 : 1 }
  ' "$body"
}

failures=0
check() {
  local name=$1
  shift
  if "$@"; then
    echo "PASS  $name"
  else
    echo "FAIL  $name"
    failures=$((failures + 1))
  fi
}

check "content-type is text/plain (got \"$content_type\")" is_text_plain
check "\"User-Agent: Googlebot\" is followed by \"Allow: /\"" \
  has_line_pair "User-Agent: Googlebot" "Allow: /"
check "advertises \"$SITEMAP_LINE\"" has_line "$SITEMAP_LINE"

if [[ "$failures" -gt 0 ]]; then
  echo "$failures check(s) failed for $URL"
  print_body_head
  exit 1
fi
echo "robots.txt OK after $attempt attempt(s)"
