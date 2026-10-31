#!/usr/bin/env bash
# Runs a command. On failure, publishes the tail of its output as error annotations,
# which are visible right in the pull request (no need to open the full job log).
#
# Usage: bash .github/scripts/run.sh <title> <command> [args...]
set -o pipefail

title="$1"
shift
log="$(mktemp)"

"$@" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}

if [ "$rc" -ne 0 ]; then
  # Strip ANSI colours and keep the last lines; split into annotation-sized chunks.
  tail -n 160 "$log" | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' >"$log.tail"
  split -b 3500 -d "$log.tail" "$log.part."
  n=0
  for part in "$log".part.*; do
    n=$((n + 1))
    [ "$n" -gt 9 ] && break
    msg="$(sed -e 's/%/%25/g' -e 's/\r/%0D/g' "$part" | awk 'BEGIN { ORS = "%0A" } { print }')"
    echo "::error title=${title} (${n})::${msg}"
  done
fi

exit "$rc"
