---
name: ASP — spec proposal discussion
about: Discuss a normative spec change before drafting an ASP PR
title: "[ASP]: "
labels: ["asp", "spec"]
---

> **Note:** An ASP is for **normative** spec changes — wire format, conformance levels, JSON schemas, anything a producer or consumer must agree on. For informative changes (clarifications, examples, typos, prose rewrites that don't change conformance), use a plain PR.
>
> This issue is for **early discussion** before you draft a full ASP. If you already have a concrete proposal, you can skip straight to a PR using [`spec/proposals/template.md`](../../spec/proposals/template.md).

## ASP number

`TBD` (the BDFL will assign a final number at merge time. If you've reserved one in a draft PR, list it here.)

## Motivation

What's the problem you're trying to solve at the spec level? Who is affected? What does the current spec do, and where does it fall short?

## Summary of proposed change

A short, plain-language description of the change you have in mind. One or two paragraphs is plenty at this stage — detailed design lives in the ASP document itself.

## Link to PR (if any)

If you've already opened a draft ASP PR, link it here so the discussion can move there once it's ready.

## Discussion goals

What feedback are you looking for in this thread? Examples:

- Does the motivation resonate, or is this solving a non-problem?
- Are there prior approaches in adjacent specs (MCP, OpenAPI, Schema.org, JSON-LD) that should be evaluated?
- Are the proposed semantics ambiguous in any obvious cases?
- Would this break existing producers or consumers?

The clearer your asks, the more useful the responses will be.
