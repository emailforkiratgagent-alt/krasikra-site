#!/usr/bin/env bash
# Starts the built standalone server and checks what must hold in production.
set -euo pipefail

cp -r public .next/standalone/
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/

BASE=http://127.0.0.1:8080
CURL=(curl --silent --show-error --max-time 60)

# A fresh database, so that starting the production server really applies migrations.
SMOKE_DB=krasikra_smoke
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -qc "DROP DATABASE IF EXISTS $SMOKE_DB"
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -qc "CREATE DATABASE $SMOKE_DB"
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/$SMOKE_DB"
export DATABASE_SSL=disable
export SERVER_URL=$BASE

on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    for f in /tmp/server-*.log; do
      [ -f "$f" ] || continue
      echo "===== $f (last 40 lines)"
      tail -n 40 "$f"
    done
  fi
  pkill -f "node server.js" || true
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 124' TERM INT

start() {
  local name="$1" port="$2"
  shift 2
  (cd .next/standalone && exec env NODE_ENV=production PORT="$port" HOSTNAME=127.0.0.1 "$@" node server.js \
    </dev/null >"/tmp/server-$name.log" 2>&1 &)
  for _ in $(seq 1 60); do
    "${CURL[@]}" -fo /dev/null "http://127.0.0.1:$port/healthz" 2>/dev/null && return 0
    sleep 1
  done
  echo "Server $name did not start"
  return 1
}

stop() {
  pkill -f "node server.js" || true
  sleep 2
}

expect_code() {
  local expected="$1" method="$2" url="$3" code
  code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' -X "$method" "$url" || true)
  echo "$method $url -> $code (expected $expected)"
  [[ "$code" =~ ^($expected)$ ]]
}

# 1. Two instances start on the empty database at once: migrations must run exactly once.
start first 8080
start second 8081
expect_code '200|302|307' GET "$BASE/admin" &
p1=$!
expect_code '200|302|307' GET "http://127.0.0.1:8081/admin" &
p2=$!
wait "$p1"
wait "$p2"
applied=$(PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d "$SMOKE_DB" -tAc \
  "SELECT count(*) FROM payload_migrations WHERE batch > 0")
expected=$(find src/migrations -name '*.ts' ! -name 'index.ts' | wc -l)
echo "migrations applied: $applied, expected: $expected"
[ "$applied" = "$expected" ]

# 2. Public pages, noindex and closed integration settings.
"${CURL[@]}" -f "$BASE/healthz"
echo
"${CURL[@]}" -fI "$BASE/" | tee /tmp/home.txt
grep -qi '^x-robots-tag: noindex' /tmp/home.txt
"${CURL[@]}" -f "$BASE/robots.txt" | tee /tmp/robots.txt
grep -q 'Disallow: /' /tmp/robots.txt
"${CURL[@]}" -f "$BASE/" | grep -q 'Хозяин Камчатки'
expect_code '401|403' GET "$BASE/api/globals/xlabel-integration"
expect_code '401|403' POST "$BASE/api/globals/xlabel-integration/check-connection"
stop

# 3. Production mode: NOINDEX=false removes the header.
start indexed 8080 NOINDEX=false
"${CURL[@]}" -fI "$BASE/" | tee /tmp/home2.txt
if grep -qi '^x-robots-tag' /tmp/home2.txt; then
  echo "X-Robots-Tag must be absent with NOINDEX=false"
  exit 1
fi
echo "Smoke test passed"
