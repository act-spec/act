#!/usr/bin/env bash
# Scoped PRD-reference sanitization check.
#
# Fails with exit 1 if any PRD-NNN reference is found in user-visible surfaces:
#   - Top-level README.md and package/example/app README.md files
#   - Top-level governance documents
#   - spec/v0.2/** (the normative spec text)
#
# Intentional exclusions:
#   - schemas/ and fixtures/: directory layout is PRD-numbered by design
#     (requires an ASP to restructure; deferred to v0.3).
#   - */test-fixtures/**: internal fixture documentation mapping fixtures to
#     specific spec rules; not user-visible in published packages.
#   - */.stryker-tmp/**: generated Stryker mutation-testing sandboxes.
#   - */node_modules/**: third-party code.
#   - docs/adr/**: internal architectural decision records.
#
# Usage:
#   bash scripts/check-prd-refs.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

FOUND=0
report() {
  echo "::error::PRD reference found: $1"
  FOUND=1
}

echo "==> checking README.md files..."
while IFS= read -r -d '' file; do
  if grep -qE "PRD-[0-9]" "${file}" 2>/dev/null; then
    while IFS= read -r line; do
      report "${file}: ${line}"
    done < <(grep -nE "PRD-[0-9]" "${file}")
  fi
done < <(find "${REPO_ROOT}" \
  -name "README.md" \
  -not -path "*/node_modules/*" \
  -not -path "*/schemas/*" \
  -not -path "*/fixtures/*" \
  -not -path "*/.git/*" \
  -not -path "*/test-fixtures/*" \
  -not -path "*/.stryker-tmp/*" \
  -not -path "*/docs/adr/*" \
  -print0)

echo "==> checking top-level governance documents..."
GOVERNANCE_DOCS=(
  "${REPO_ROOT}/CONTRIBUTING.md"
  "${REPO_ROOT}/CODE_OF_CONDUCT.md"
  "${REPO_ROOT}/SECURITY.md"
  "${REPO_ROOT}/GOVERNANCE.md"
)
for file in "${GOVERNANCE_DOCS[@]}"; do
  if [[ -f "${file}" ]] && grep -qE "PRD-[0-9]" "${file}" 2>/dev/null; then
    while IFS= read -r line; do
      report "${file}: ${line}"
    done < <(grep -nE "PRD-[0-9]" "${file}")
  fi
done

echo "==> checking spec/v0.2/**..."
if [[ -d "${REPO_ROOT}/spec/v0.2" ]]; then
  while IFS= read -r -d '' file; do
    if grep -qE "PRD-[0-9]" "${file}" 2>/dev/null; then
      while IFS= read -r line; do
        report "${file}: ${line}"
      done < <(grep -nE "PRD-[0-9]" "${file}")
    fi
  done < <(find "${REPO_ROOT}/spec/v0.2" -type f -print0)
fi

if [[ "${FOUND}" -eq 1 ]]; then
  echo ""
  echo "FAIL: PRD-NNN references found in user-visible surfaces."
  echo "      Strip rule citations or rewrite as spec/v0.2/... anchors."
  echo "      schemas/, fixtures/, test-fixtures/ are intentionally excluded."
  exit 1
fi

echo "PASS: no PRD-NNN references in user-visible surfaces."
