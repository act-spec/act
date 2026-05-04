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

Also run `git status` before pushing to catch unstaged fixes. The committed code is what CI checks — not the working tree. If the working tree has lint fixes that haven't been committed, CI will still fail.

## Lint rules to never violate

**No non-null assertions (`!`).** The rule `@typescript-eslint/no-non-null-assertion` is configured as a warning project-wide. Never add `!` to assert non-null. Instead:
- Use an explicit `if (x === undefined) throw ...` / `if (!x) return` guard
- Use nullish coalescing: `x ?? fallback`
- Use optional chaining: `x?.property`

**No unnecessary type assertions.** After a `typeof x === 'string'` narrowing, TypeScript already knows the type — do not add `as string`. After `?? {}`, do not cast the result.

**`prefer-const`.** Never use `let` for a variable that is never reassigned.

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
