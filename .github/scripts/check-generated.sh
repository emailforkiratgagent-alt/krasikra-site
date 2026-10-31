#!/usr/bin/env bash
# Fails when tool-generated files differ from what the tools produce now,
# or when the Payload schema changed without a migration.
set -euo pipefail

pnpm run generate:xlabel-types
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create schema-check --skip-empty --force-accept-warning

if [ -n "$(git status --porcelain)" ]; then
  git status --porcelain
  git --no-pager diff --stat
  git --no-pager diff | head -n 80
  # Restore the tree so the following CI steps test the committed code.
  git checkout -- .
  git clean -fdq -- src
  echo "Generated files are stale or a migration is missing."
  echo "Push a commit with [regen] (and [migration:<name>] for schema changes) in its message."
  exit 1
fi
