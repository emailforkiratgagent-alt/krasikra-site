#!/usr/bin/env bash
# Starts the built standalone server and checks what must hold in production.
set -euo pipefail

cp -r public .next/standalone/
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/

BASE=http://127.0.0.1:8080
# A fresh database, so that starting the production server really applies migrations.
SMOKE_DB=krasikra_smoke
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -qc "DROP DATABASE IF EXISTS $SMOKE_DB" -c "CREATE DATABASE $SMOKE_DB"
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/$SMOKE_DB"
export DATABASE_SSL=disable
export SERVER_URL=$BASE

start() {
  local name="$1" port="$2"
  shift 2
  (cd .next/standalone && env NODE_ENV=production PORT="$port" HOSTNAME=127.0.0.1 "$@" node server.js >"/tmp/server-$name.log" 2>&1 &)
  for _ in $(seq 1 60); do
    curl -fs "http://127.0.0.1:$port/healthz" >/dev/null && return 0
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

# Two instances start on the empty database at once: migrations must run exactly once.
start noindex 8080
start second 8081
curl -s -o /dev/null -w 'admin on 8080: %{http_code}\n' "$BASE/admin" &
curl -s -o /dev/null -w 'admin on 8081: %{http_code}\n' "http://127.0.0.1:8081/admin" &
wait
applied=$(PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d "$SMOKE_DB" -tAc "SELECT count(*) FROM payload_migrations WHERE batch > 0")
expected=$(ls src/migrations/*.ts | grep -vc 'index.ts')
echo "migrations applied: $applied, expected: $expected"
[ "$applied" = "$expected" ] || { tail -n 80 /tmp/server-*.log; exit 1; }

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

start indexed 8080 NOINDEX=false
curl -fsSI "$BASE/" | tee /tmp/home2.txt
if grep -qi '^x-robots-tag' /tmp/home2.txt; then
  echo "X-Robots-Tag must be absent with NOINDEX=false"
  exit 1
fi
echo "Smoke test passed"
