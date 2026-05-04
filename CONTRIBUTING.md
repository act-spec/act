# Contributing to ACT

Thanks for your interest in ACT (Agent Content Tree). ACT is an open standard plus a TypeScript reference implementation, and contributions of all kinds are welcome — bug reports, feature ideas, documentation fixes, new adapters, conformance fixtures, and proposals for the spec itself.

This document covers how to file issues, how to propose changes to the spec, and how to set up the repo for local development.

## Filing issues

Pick the template that matches what you're filing:

- [Bug report](.github/ISSUE_TEMPLATE/bug_report.md) — a defect in the reference implementation, validator, examples, or docs.
- [Feature request](.github/ISSUE_TEMPLATE/feature_request.md) — a non-normative enhancement to an implementation, tooling, or documentation.
- [ASP discussion](.github/ISSUE_TEMPLATE/asp.md) — early discussion of a normative change to the spec, before drafting an ASP PR.

If you're not sure which template applies, file a feature request and a maintainer will reroute it.

## Filing an ASP

ACT spec changes go through the **ASP (ACT Spec Proposal)** process — a lightweight, GitHub-native pattern modeled after MCP's SEPs and Rust's RFCs.

You should file an ASP for any **normative** change to the spec — wire format, conformance levels, JSON schemas, or anything else a producer or consumer needs to agree on. For **informative** changes (clarifications, examples, typo fixes, prose rewrites that don't change conformance), open a plain pull request.

To file an ASP:

1. Read [`spec/proposals/README.md`](spec/proposals/README.md) for the full lifecycle.
2. Optionally open an [ASP discussion issue](.github/ISSUE_TEMPLATE/asp.md) first to socialize the idea.
3. Copy [`spec/proposals/template.md`](spec/proposals/template.md) to `spec/proposals/NNNN-short-title.md` and fill it out.
4. Open a PR against `main`. The BDFL will assign the final ASP number at merge.

## Development setup

Requirements:

- Node.js ≥ 20.18
- pnpm ≥ 10

Clone and install:

```sh
git clone https://github.com/act-spec/act.git
cd act
pnpm install
```

## Common commands

| Command | What it does |
|---|---|
| `pnpm test` | Run unit tests across the workspace. |
| `pnpm build` | Build all packages. |
| `pnpm typecheck` | Type-check all packages. |
| `pnpm -r conformance` | Run the conformance suite across every package. **Every PR must pass this.** |

Conformance is the primary quality gate. CI runs `pnpm -r conformance` on every pull request, and a failing conformance check blocks merge.

## Commit style and DCO sign-off

Every commit must carry a Developer Certificate of Origin (DCO) sign-off. This certifies that you wrote (or have the right to submit) the change and that you license it under the project's terms. There is no separate CLA.

Sign off by passing `-s` to `git commit`:

```sh
git commit -s -m "Your commit message"
```

This adds a trailer like:

```
Signed-off-by: Your Name <you@example.com>
```

Sign-off is enforced automatically by [`.github/workflows/dco.yml`](.github/workflows/dco.yml). PRs with unsigned commits will fail the DCO check until every commit is signed.

If you forgot to sign off, you can amend or rebase to fix it. For a single commit:

```sh
git commit --amend -s --no-edit
```

For a series of commits, rebase interactively and add `-s` per commit, or use `git rebase --signoff`.

Commit messages should describe the change in the imperative mood ("add X", "fix Y", not "added X" / "fixes Y"). Keep the subject under 72 characters; add detail in the body if useful.

## Branch strategy

- All work happens on feature branches. PRs target `main`.
- PRs are merged with **squash merges** to keep `main` history linear.
- Required status checks before merge: CI (lint, typecheck, test, conformance) and DCO.
- Reviews: one approving review from a maintainer is required for non-trivial changes.

## Changesets

User-facing changes need a changeset so the release notes pick them up. Run:

```sh
pnpm changeset
```

Pick the affected packages, choose patch / minor / major, and write a one-line summary. Commit the generated `.changeset/*.md` file alongside your code.

## Code of Conduct and governance

- We follow the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Be respectful, give people the benefit of the doubt, report issues to **maintainers@act-spec.org**.
- The project's decision-making model, roles, and ASP process are described in [GOVERNANCE.md](GOVERNANCE.md).

Thanks again — looking forward to your contributions.
