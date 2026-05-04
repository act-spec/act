#!/usr/bin/env bash
# Configure npm OIDC trusted publishing for every public @act-spec/* package.
#
# Run once after the first npm publish, then again whenever a new package is
# added to packages/. Requires npm >= 11.10.0 and an active `npm login` session.
#
# Usage:
#   bash scripts/setup-npm-trusted-publishers.sh
#
# The trust relationship allows the release.yml workflow to publish without
# a stored NPM_TOKEN — GitHub's OIDC token is used instead.

set -euo pipefail

WORKFLOW_FILE="release.yml"
REPO="act-spec/act"

# Require npm >= 11.10.0
NPM_MAJOR=$(npm --version | cut -d. -f1)
NPM_MINOR=$(npm --version | cut -d. -f2)
if [ "$NPM_MAJOR" -lt 11 ] || { [ "$NPM_MAJOR" -eq 11 ] && [ "$NPM_MINOR" -lt 10 ]; }; then
  echo "error: npm >= 11.10.0 required (found $(npm --version))"
  echo "  run: npm install -g npm@latest"
  exit 1
fi

# Collect all public package names from packages/*/package.json
PACKAGES=()
for f in packages/*/package.json; do
  name=$(node -e "const p=require('./$f'); if(!p.private) process.stdout.write(p.name)")
  [ -n "$name" ] && PACKAGES+=("$name")
done

echo "Configuring trusted publishing for ${#PACKAGES[@]} packages"
echo "  workflow : $WORKFLOW_FILE"
echo "  repo     : $REPO"
echo ""
echo "npm will prompt for 2FA on the first package, then batch the rest."
echo ""

for pkg in "${PACKAGES[@]}"; do
  echo "→ $pkg"
  npm trust github "$pkg" \
    --file "$WORKFLOW_FILE" \
    --repo "$REPO" \
    --yes
done

echo ""
echo "Done. All ${#PACKAGES[@]} packages now trust act-spec/act / $WORKFLOW_FILE."
echo ""
echo "Next steps:"
echo "  1. Remove NPM_TOKEN from .github/workflows/release.yml env block"
echo "  2. Delete the NPM_TOKEN GitHub Actions secret"
echo "  3. Revoke the granular npm access token at npmjs.com/settings/tokens"
