#!/usr/bin/env bash
# Run the TS ↔ Go validator parity sweep (runbook §5.2g.11).
#
# Builds the host-arch actree binary (so the sweep doesn't pay `go run`
# compile cost on every fixture), then hands off to scripts/parity-check.mjs
# which walks fixtures/, calls both validators per fixture, and exits 1 on
# the first divergence in `valid` verdicts.
#
# Pass --no-build to skip the host build (e.g. when the binary already
# exists from a CI cache).
#
# Usage:
#   bash scripts/parity-check.sh
#   bash scripts/parity-check.sh --no-build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

NO_BUILD=0
for arg in "$@"; do
  case "${arg}" in
    --no-build) NO_BUILD=1 ;;
    *)
      echo "parity-check.sh: unknown arg ${arg}" >&2
      exit 2
      ;;
  esac
done

# Pick the host triple so we build only what we need locally.
GOOS_HOST="$(go env GOOS)"
GOARCH_HOST="$(go env GOARCH)"
EXT=""
if [[ "${GOOS_HOST}" == "windows" ]]; then
  EXT=".exe"
fi
ACTREE_BIN="${REPO_ROOT}/go/dist/actree-${GOOS_HOST}-${GOARCH_HOST}${EXT}"

if [[ "${NO_BUILD}" -eq 0 ]]; then
  echo "==> building host actree (${GOOS_HOST}/${GOARCH_HOST})"
  bash "${REPO_ROOT}/go/scripts/build.sh" "${GOOS_HOST}" "${GOARCH_HOST}"
fi

if [[ ! -x "${ACTREE_BIN}" ]]; then
  echo "parity-check.sh: ${ACTREE_BIN} not found or not executable" >&2
  exit 2
fi

# The TS validator is invoked in-process from the Node script, so the
# `dist/` build must be present. Surface a clearer error than a bare
# ESM resolution failure if it isn't.
if [[ ! -f "${REPO_ROOT}/packages/validator/dist/index.js" ]]; then
  echo "parity-check.sh: packages/validator/dist not found — run \`pnpm -F @act-spec/validator build\` first" >&2
  exit 2
fi

ACTREE_BIN="${ACTREE_BIN}" node "${SCRIPT_DIR}/parity-check.mjs" --actree "${ACTREE_BIN}"
