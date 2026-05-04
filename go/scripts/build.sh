#!/usr/bin/env bash
# Cross-compile the actree binary for one or more target triples.
#
# Usage:
#   bash scripts/build.sh                 # build all 5 release targets
#   bash scripts/build.sh darwin arm64    # build a single GOOS/GOARCH pair
#   VERSION=0.2.0 bash scripts/build.sh   # override the injected version
#
# Outputs land under go/dist/. After a full sweep the script also writes a
# go/dist/SHA256SUMS file covering every artifact produced in this run.
#
# CGO is disabled so the binary is fully static and portable across libc
# variants (alpine ↔ glibc, etc.). -s -w trims the symbol table and DWARF
# data, which knocks ~25% off the binary size and is standard for release
# builds.
#
# Run from inside the go/ directory (the script chdirs there itself for
# safety so callers can invoke it from any cwd).

set -euo pipefail

# Resolve repo paths regardless of where the script was invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${GO_DIR}"

# Default release matrix when no GOOS/GOARCH is supplied. Mirrors the
# job matrix in .github/workflows/release-go.yml so local builds and CI
# stay aligned.
DEFAULT_TARGETS=(
  "darwin amd64"
  "darwin arm64"
  "linux amd64"
  "linux arm64"
  "windows amd64"
)

# Pull the version from $VERSION if set; otherwise derive from the git tag,
# falling back to the core.Version constant (the build will fail loudly if
# even that lookup breaks, which is the right signal).
if [[ -z "${VERSION:-}" ]]; then
  if VERSION="$(git describe --tags --exact-match 2>/dev/null)"; then
    VERSION="${VERSION#v}"
  else
    VERSION="$(grep -E '^const Version' pkg/core/types.go | sed -E 's/.*"([^"]+)".*/\1/')"
  fi
fi

DIST_DIR="${GO_DIR}/dist"
mkdir -p "${DIST_DIR}"

# build_one GOOS GOARCH — produces dist/actree-<goos>-<goarch>[.exe].
build_one() {
  local goos="$1"
  local goarch="$2"
  local ext=""
  if [[ "${goos}" == "windows" ]]; then
    ext=".exe"
  fi
  local out="${DIST_DIR}/actree-${goos}-${goarch}${ext}"
  echo "==> building ${out} (version=${VERSION})"
  CGO_ENABLED=0 GOOS="${goos}" GOARCH="${goarch}" \
    go build \
      -trimpath \
      -ldflags="-s -w -X github.com/act-spec/act/go/pkg/core.Version=${VERSION}" \
      -o "${out}" \
      ./cmd/actree
}

# Compute SHA-256 sums for every artifact in dist/ that matches actree-*.
# Uses sha256sum where available (Linux), falls back to `shasum -a 256` on
# macOS. Output format mirrors the GNU coreutils style so users can verify
# with `sha256sum --check SHA256SUMS` on any GNU environment.
write_sha256sums() {
  local sums_file="${DIST_DIR}/SHA256SUMS"
  rm -f "${sums_file}"
  cd "${DIST_DIR}"
  local files=(actree-*)
  if [[ ${#files[@]} -eq 0 || "${files[0]}" == "actree-*" ]]; then
    echo "no artifacts found in ${DIST_DIR}; skipping SHA256SUMS"
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${files[@]}" > "${sums_file}"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${files[@]}" > "${sums_file}"
  else
    echo "neither sha256sum nor shasum available; cannot write SHA256SUMS" >&2
    return 1
  fi
  cd "${GO_DIR}"
  echo "==> wrote ${sums_file}"
}

if [[ $# -eq 2 ]]; then
  build_one "$1" "$2"
elif [[ $# -eq 0 ]]; then
  for pair in "${DEFAULT_TARGETS[@]}"; do
    # shellcheck disable=SC2086
    build_one ${pair}
  done
  write_sha256sums
else
  echo "usage: $0 [GOOS GOARCH]" >&2
  exit 2
fi
