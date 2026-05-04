# Changesets

This directory is managed by [changesets](https://github.com/changesets/changesets).

To record a change for a public package, run `pnpm changeset` from the repo root and follow the prompts. A markdown file will be created in this directory; commit it alongside your code change. The `release.yml` workflow consumes pending changesets to compute version bumps and publish to npm.

The `@act-spec/example-700-tinybox` package is `private` (per the PRD-700 reference build) and is ignored by changesets — it does not publish.
