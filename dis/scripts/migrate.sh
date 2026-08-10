#!/usr/bin/env bash
#
# migrate.sh — thin wrapper around `npx dbmate` that loads env from
# `dis/dbmate.env` (if present) and forces the migrations dir to
# `dis/migrations`. Intended to be run from a checkout root:
#
#   dis/scripts/migrate.sh up
#   dis/scripts/migrate.sh rollback
#   dis/scripts/migrate.sh status
#
# Does NOT apply any migration automatically in CI. Wave 7 is responsible
# for staging/production application.

set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -f "${here}/dbmate.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${here}/dbmate.env"
  set +a
fi

cd "${here}"
exec npx dbmate --migrations-dir migrations "$@"
