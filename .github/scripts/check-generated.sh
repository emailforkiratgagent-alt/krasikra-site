#!/usr/bin/env bash
# Fails when tool-generated files differ from what the tools produce now,
# or when the Payload schema changed without a migration.
set -euo pipefail

pnpm run generate:xlabel-types
pnpm run generate:importmap
pnpm run generate:types

# Payload 3 always writes a migration file; an empty one (no SQL) means the schema matches
# the committed migrations. Inspect it, then remove it.
pnpm payload migrate:create schema-check --force-accept-warning
schema_drift=0
for f in $(git ls-files --others --exclude-standard -- 'src/migrations/*schema_check*.ts'); do
  if grep -q 'db.execute' "$f"; then
    schema_drift=1
    echo "--- Schema changed without a migration. Pending SQL ($f):"
    head -n 60 "$f"
  fi
done
git ls-files --others --exclude-standard -z -- 'src/migrations/*schema_check*' | xargs -0 -r rm -f
git checkout -- src/migrations/index.ts

if [ "$schema_drift" = 1 ] || [ -n "$(git status --porcelain)" ]; then
  git status --porcelain
  git --no-pager diff | head -n 80
  # Restore the tree so the following CI steps test the committed code.
  git checkout -- .
  git clean -fdq -- src
  echo "Generated files are stale or a migration is missing."
  echo "Push a commit with [regen] (and [migration:<name>] for schema changes) in its message."
  exit 1
fi
echo "Generated files are up to date"
