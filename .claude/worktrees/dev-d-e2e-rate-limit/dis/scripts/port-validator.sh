#!/usr/bin/env bash
# port-validator.sh — shell-level DIP enforcement (DIS-011).
#
# Fails if any file under dis/src/core/ or dis/src/ports/ imports from
# dis/src/adapters/. Complements (does not replace) the Node-based
# fitness.mjs rules core_no_adapter_imports / ports_no_adapter_imports;
# a redundant shell check guards against future breakage of the Node
# toolchain itself.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO"

targets=()
[ -d dis/src/core ] && targets+=(dis/src/core)
[ -d dis/src/ports ] && targets+=(dis/src/ports)

if [ "${#targets[@]}" -eq 0 ]; then
  echo "port-validator: no dis/src/core or dis/src/ports directory — nothing to check"
  exit 0
fi

# Match imports from any path containing src/adapters/ or ../adapters/.
# Single-quoted regex gets passed verbatim to grep -E.
pattern="from ['\"][^'\"]*(src/|\.\./|\./)adapters/"

viol="$(grep -rnE "$pattern" "${targets[@]}" 2>/dev/null || true)"

if [ -n "$viol" ]; then
  echo "PORT VIOLATION: core/ or ports/ imports from adapters/"
  echo "$viol"
  exit 1
fi

echo "port-validator: clean"
