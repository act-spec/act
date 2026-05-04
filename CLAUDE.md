# Claude Code instructions for act

## Before every push

Run the full CI pipeline locally and verify zero errors:

```bash
pnpm -F @act-spec/core codegen
pnpm -r --filter "./packages/*" run build
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r conformance
```

All five commands must exit 0 before pushing. Never push after fixing just the package that appeared in the previous CI failure — run the full sweep every time.

## Commit requirements (DCO)

**Every commit** on a PR branch must include a `Signed-off-by` trailer:

```
Signed-off-by: Jeremy Forsythe <jeremy@act-spec.org>
```

Always pass `--signoff` (or `-s`) when creating commits:

```bash
git commit --signoff -m "message"
```

If a pushed commit is missing the sign-off, amend it and force-push:

```bash
git commit --amend --signoff --no-edit
git push --force-with-lease
```

## Co-authorship trailer

All Claude-assisted commits also include:

```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```
