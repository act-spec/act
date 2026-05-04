# ACT Spec Proposals (ASPs)

This directory holds **ASPs** — ACT Spec Proposals — the public, written record of every normative change to the ACT specification.

## What is an ASP?

An ASP is a single Markdown document that describes one normative change to the ACT spec, including its motivation, prior art, detailed design, examples, alternatives considered, migration impact, and acceptance criteria. The pattern is intentionally similar to MCP's **SEPs** and Rust's **RFCs**: a lightweight, GitHub-native process where the proposal lives in-repo, discussion happens on the PR, and the merged document is the canonical record of the decision.

ASPs are numbered sequentially: `0001-short-title.md`, `0002-...`, and so on. Once merged, an ASP's number and filename are stable.

## When to file an ASP

File an ASP for any **normative** change to the spec, including:

- Changes to the wire format under `spec/v0.2/` (or any future spec version directory).
- New, removed, or changed conformance levels.
- Changes to JSON schemas a producer or consumer must agree on.
- New required or recommended behavior for implementations.
- Renames, deprecations, or migrations of normative concepts.

If a producer or consumer would need to change something to remain conformant, it's an ASP.

## When NOT to file an ASP

Open a plain pull request for:

- Bug fixes in a reference implementation, validator, CLI, or example.
- Documentation improvements, prose rewrites, typo fixes.
- Refactors and dependency bumps with no behavior change.
- Adding examples that illustrate the existing spec without extending it.
- Editorial clarifications that don't change what implementations must do.

When in doubt, ask on a discussion issue first; it's cheaper to redirect a question than to retract a merged ASP.

## Lifecycle

Every ASP moves through these states, recorded in the document's front-matter:

1. **Draft** — Open as a PR. Author iterates in response to review.
2. **Review** — Maintainers signal that the proposal is ready for the public discussion window. Minimum **7 days** of public review before a decision.
3. **Accepted** — BDFL accepts the proposal. The ASP merges. Implementation lands in the next spec version (`spec-target` field in the front-matter).
4. **Rejected** — BDFL rejects the proposal with written reasoning recorded on the PR. The document still merges (with `status: Rejected`) so the rationale is preserved for future authors.
5. **Implemented** — Once the change has shipped in the targeted spec version, the ASP is updated to `status: Implemented` and cross-linked from the version's changelog.

An ASP can also be **Withdrawn** by the author at any time before acceptance.

## How to file an ASP

1. Optionally open an [ASP discussion issue](../../.github/ISSUE_TEMPLATE/asp.md) to socialize the idea early.
2. Copy [`template.md`](template.md) to `NNNN-short-title.md` — pick the next available number; the BDFL confirms the final number at merge.
3. Fill out every section. Sections that don't apply should say so explicitly ("N/A — purely additive change") rather than be deleted.
4. Open a PR against `main` titled `ASP NNNN: <title>`.
5. Engage with review feedback. The discussion window is a minimum of 7 days from the time the ASP enters `Review` status; the BDFL may extend it for proposals that need more input.

## Number assignment

PR authors propose the next available `NNNN` based on the highest-numbered file currently in this directory. If two ASPs are filed concurrently, the BDFL renumbers one at merge — this is a small, mechanical edit and is not a reason to block a proposal.

## Decision authority

The BDFL accepts or rejects every ASP after the public discussion window has elapsed and writes a short decision record on the PR. ASPs can be revised and resubmitted; a previous rejection is not a permanent veto.
