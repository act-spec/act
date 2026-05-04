---
title: Community
description: How to join the ACT community — Discussions, chat, and the contributor guide.
summary: GitHub Discussions, contributor guide, and the chat invite (placeholder until launch).
type: reference
---

ACT is a small, BDFL-led project. The fastest way to get help, propose ideas,
or follow what's coming is one of the channels below.

## GitHub Discussions

The primary forum lives at
[github.com/act-spec/act/discussions](https://github.com/act-spec/act/discussions).
Use it for questions, ideas, show-and-tell, and informal proposals before
they become full ASPs.

## Chat

A public chat channel lands at v0.2.0 stable. Until then, GitHub
Discussions is the venue.

> *Discord/Matrix invite — TBD post-launch.*

## Reporting issues

- **Bugs** — file via the
  [bug report issue template](https://github.com/act-spec/act/issues/new?template=bug_report.md).
- **Feature requests** — use the
  [feature request template](https://github.com/act-spec/act/issues/new?template=feature_request.md).
- **Spec changes (ASPs)** — start with the
  [ASP discussion template](https://github.com/act-spec/act/issues/new?template=asp.md),
  then graduate to a full proposal under
  [`spec/proposals/`](https://github.com/act-spec/act/tree/main/spec/proposals).
- **Security** — see the [security policy](https://github.com/act-spec/act/blob/main/SECURITY.md).

## Contributor guide

The full contributor guide lives at
[`CONTRIBUTING.md`](https://github.com/act-spec/act/blob/main/CONTRIBUTING.md).
The short version:

1. Fork the repo and create a feature branch.
2. `pnpm install`, then run `pnpm test && pnpm -r conformance`.
3. Sign your commits with `-s` (DCO is enforced via CI).
4. Open a PR against `main` with a changeset describing the change.

## Code of conduct

ACT follows the
[Contributor Covenant 2.1](https://github.com/act-spec/act/blob/main/CODE_OF_CONDUCT.md).
Maintainer contact for conduct issues: `maintainers@act-spec.org`.

## Reference adopters

If you ship a public docs or product site and want to be one of the marquee
reference adopters for the v0.2 launch, open a Discussion or email
`maintainers@act-spec.org`. We'll co-author the integration PR and the
co-launch blog post.
