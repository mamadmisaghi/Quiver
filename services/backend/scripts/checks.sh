#!/usr/bin/env bash
# Quiver backend gate. Prints each step and exits non-zero if ANY step fails.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2   # backend/, relative to this script (M5.26)
# M5.27: never regenerate fixtures here (that hid stale ones). Fixtures are checked in memory (--check) against the
# committed files, and the run fails if ANY tracked file changes while it runs.
tree() { git status --porcelain --untracked-files=no -- . ; git diff --no-ext-diff -- . | sha256sum; }
before=$(tree)
fail=0
step() { local name=$1; shift; local log; log=$(mktemp); if "$@" >"$log" 2>&1; then echo "$name ok"; else echo "$name FAIL"; tail -15 "$log"; fail=1; fi; rm -f "$log"; }
step TC npm run -s typecheck
step LINT npm run -s lint
step FIXTURES_GEN_CHECK npm run -s fixtures:gen:check
step FIXTURES_CHECK npm run -s fixtures:check
vlog=$(mktemp); if npx vitest run >"$vlog" 2>&1; then grep -E "Test Files|Tests " "$vlog"; echo "VITEST ok"; else grep -E "Test Files|Tests |FAIL" "$vlog" | head -30; echo "VITEST FAIL"; fail=1; fi; rm -f "$vlog"
flog=$(mktemp); if (cd foundry && "${FORGE:-$HOME/.foundry/bin/forge}" test) >"$flog" 2>&1; then tail -1 "$flog"; echo "FORGE ok"; else grep -E "FAIL|Error|failed" "$flog" | head -20; tail -1 "$flog"; echo "FORGE FAIL"; fail=1; fi; rm -f "$flog"
git status --short
after=$(tree)
if [ "$before" != "$after" ]; then echo "TREE_UNCHANGED FAIL (tracked files changed during checks):"; diff <(echo "$before") <(echo "$after") | head -20; fail=1; else echo "TREE_UNCHANGED ok"; fi
if [ "$fail" -ne 0 ]; then echo "CHECKS FAILED"; exit 1; fi
echo "ALL CHECKS PASSED"
