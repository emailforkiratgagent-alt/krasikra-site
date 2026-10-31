#!/usr/bin/env bash
# Starts the built standalone server and checks what must hold in production.
set -euo pipefail

cp -r public .next/standalone/
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/

BASE=http://127.0.0.1:8080

start() {
  local name="$1"
  shift
  (cd .next/standalone && env NODE_ENV=production PORT=8080 HOSTNAME=127.0.0.1 "$@" node server.js >"/tmp/server-$name.log" 2>&1 &)
  for _ in $(seq 1 60); do
    curl -fs "$BASE/healthz" >/dev/null && return 0
    sleep 1
  done
  echo "Server did not start:"
  cat "/tmp/server-$name.log"
  return 1
}

stop() {
  pkill -f "node server.js" || true
  sleep 2
}

expect_code() {
  local expected="$1" method="$2" path="$3" code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path")
  echo "$method $path -> $code (expected $expected)"
  [[ "$code" =~ ^($expected)$ ]] || { tail -n 60 /tmp/server-*.log; return 1; }
}

trap stop EXIT

start noindex
curl -fsS "$BASE/healthz"
echo
curl -fsSI "$BASE/" | tee /tmp/home.txt
grep -qi '^x-robots-tag: noindex' /tmp/home.txt
curl -fsS "$BASE/robots.txt" | tee /tmp/robots.txt
grep -q 'Disallow: /' /tmp/robots.txt
curl -fsS "$BASE/" | grep -q 'Хозяин Камчатки'
expect_code '200|302|307' GET /admin
# Integration settings are closed without an admin session.
expect_code '401|403' GET /api/globals/xlabel-integration
expect_code '401|403' POST /api/globals/xlabel-integration/check-connection
stop

start indexed NOINDEX=false
curl -fsSI "$BASE/" | tee /tmp/home2.txt
if grep -qi '^x-robots-tag' /tmp/home2.txt; then
  echo "X-Robots-Tag must be absent with NOINDEX=false"
  exit 1
fi
echo "Smoke test passed"
