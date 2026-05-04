# Governance

This document describes how the ACT (Agent Content Tree) project is run: who decides what, how spec changes happen, and how implementations get released.

## Project lead

ACT is led by **Jeremy Forsythe** as Benevolent Dictator For Life (BDFL). The BDFL has final authority over the spec, the reference implementations, the release schedule, and any changes to this governance document.

The maintainer contact address is **maintainers@act-spec.org**.

## Decision-making model

ACT uses a **BDFL-with-public-process** model. Day-to-day decisions — bug triage, implementation work, refactors, docs — are made by maintainers on pull requests in the usual GitHub-native way. **Normative spec changes** go through the public **ASP (ACT Spec Proposal)** process so that the rationale, alternatives, and migration impact are all captured in the open before the spec moves.

The BDFL holds the final call on every decision but commits to operating transparently: every spec change has a written ASP, every release has a changeset, and significant disagreements are resolved in public threads rather than private channels.

## Roles

- **BDFL** — Jeremy Forsythe. Sets direction, approves ASPs, cuts releases, resolves conflicts.
- **Maintainers** — Jeremy Forsythe ([@jdforsythe](https://github.com/jdforsythe)) — BDFL. Maintainers have commit and merge rights, triage issues, review PRs, and shepherd ASPs through review.
- **Contributors** — anyone who files an issue, opens a PR, drafts an ASP, contributes a fixture, or improves the docs. No formal status is required to contribute.

## Spec change process

Normative changes to the ACT spec — wire format, conformance levels, JSON schemas, anything that affects what a producer or consumer must do — go through the ASP process:

1. Optionally open an ASP discussion issue first.
2. Copy `spec/proposals/template.md` to `spec/proposals/NNNN-short-title.md`.
3. File a PR against `main` with the proposal, examples, and migration notes.
4. Public discussion happens on the PR for at least 7 days.
5. The BDFL accepts, rejects, or asks for revisions.
6. Accepted ASPs land in the next spec version (`spec/vX.Y/`).

See [`spec/proposals/README.md`](spec/proposals/README.md) for the full lifecycle.

Informative changes — clarifications, examples, typos, prose rewrites that do not change conformance — go through plain pull requests.

## Implementation bug process

Bugs in the reference implementations, validator, examples, or docs are tracked through GitHub Issues. Use the **Bug report** template, attach a reproduction, and a maintainer will triage. Fixes land as ordinary PRs with a [changeset](https://github.com/changesets/changesets) when they are user-facing.

## Release process

Releases are driven by [Changesets](https://github.com/changesets/changesets):

- Every user-facing PR includes a changeset (`pnpm changeset`).
- A bot-managed release PR aggregates pending changesets into a version bump and changelog.
- Merging the release PR triggers the publish workflow.
- npm publishes use **OIDC trusted publishing** from CI; no long-lived npm tokens live in the repo.
- Every published package carries `--provenance` so consumers can verify the build.

Tags follow `vX.Y.Z`. The spec lives at `spec/v0.2/`, `spec/v0.3/`, and so on; spec versions and implementation package versions move independently but are coordinated at major and minor boundaries.

## Path to a foundation

ACT begins as a single-maintainer open-source project. The medium-term governance plan is to file a **W3C Community Group** during the v0.2 release-candidate phase to provide a neutral home for the spec. The **OpenJS Foundation** is tracked as a possible longer-term home for the implementations, but the project is not committing to that path today; it is one option among several.

The criteria for moving to a formal foundation are: stable spec, more than one maintainer, and at least one independent third-party implementation in active use.

## Becoming a maintainer

The path to maintainership is **active sustained contribution** — substantive PRs, helpful issue triage, careful spec review, and good judgment about scope — followed by **nomination by an existing maintainer** and confirmation by the BDFL. There is no quota and no fixed time-in-grade requirement. As the project grows, this section will be tightened into an explicit policy.

## Conflict resolution

Most disagreements are resolved on the PR or issue thread by writing things down and listening. Where consensus cannot be reached, the **BDFL has the final call**. The BDFL will explain the decision in writing on the thread so the rationale is part of the public record.
