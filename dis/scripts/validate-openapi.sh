#!/usr/bin/env bash
# validate-openapi.sh — lint dis/openapi.yaml with @redocly/cli.
# Invoked by .github/workflows/dis-ci.yml (openapi-validate step) and
# runnable locally from any cwd.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO/dis"

npx @redocly/cli lint openapi.yaml
