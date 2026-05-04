---
asp: NNNN
title: <one-line title>
status: Draft
author: <name + email or handle>
date: YYYY-MM-DD
spec-target: 0.3.0
---

## Summary

A one-paragraph, plain-language summary of the proposed change. A reader should be able to skim this and know whether the rest of the document is relevant to them.

## Motivation

What problem does this solve? Who is affected? What does the current spec do, and where does it fall short? Concrete scenarios — not abstractions — make the strongest case.

## Prior art

How is this problem handled in adjacent specs? Look at MCP, OpenAPI, Schema.org, JSON-LD, sitemaps, RSS, AsyncAPI, or anything else relevant. A short survey is fine; the goal is to show that the design space has been considered, not to write a literature review.

## Detailed design

The technical heart of the ASP. Spell out the change precisely enough that a competent implementer could build it from this section alone. Include schemas, field definitions, conformance text, and any normative MUST/SHOULD/MAY language.

## Examples

Concrete before/after examples — request bodies, file layouts, JSON snippets, CLI invocations, whatever fits. Examples often surface design problems that prose hides.

## Alternatives considered

What else did you think about, and why did you discard it? This includes "do nothing" — explain why a status-quo answer isn't acceptable. Reviewers will assume you considered the obvious alternatives; documenting them saves a round of review.

## Migration impact

What does this break for existing producers, consumers, or fixtures? What migration path do implementers have? Are there transitional aliases, deprecation windows, or dual-write strategies? If the change is purely additive, say so explicitly.

## Security & privacy considerations

Does this change introduce new failure modes, expand the attack surface, leak data, or change trust assumptions? Be specific. "None" is a valid answer if you can defend it.

## Implementation plan

How will this land? Which packages need changes? Are new conformance fixtures required? Is there a reference implementation PR that lands alongside the ASP, or does the spec change come first?

## Acceptance criteria

What must be true for the BDFL to mark this `Accepted`? List concrete, verifiable items — for example, "fixture suite updated", "validator implements the new check", "at least one third-party impl signals support".

## Open questions

Any unresolved design questions you want feedback on. Don't hide these — calling them out makes the review productive.

---

## Discussion link

<!-- Filled in once the PR is open. -->

## Decision log

<!-- Maintainers update this as the ASP progresses. -->

- YYYY-MM-DD — Filed as Draft.
