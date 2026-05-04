---
title: Our API stability promise
summary: We are formalising the API stability promise we have been operating under informally — eighteen months of compatibility on every v1 endpoint.
date: 2026-07-21
type: post
parent: posts
tags:
  - api
  - policy
---

Today we are formalising the API stability promise. Every v1
endpoint we ship from this point on carries an eighteen-month
compatibility window. Breaking changes require a v2 endpoint and a
six-month coexistence period.

## Why eighteen months

Eighteen months matches the upper bound on how long our enterprise
customers take to absorb a major upgrade. Anything shorter would
have customers running unsupported code; anything longer would slow
us down to no benefit.

## What this does not promise

Performance characteristics, undocumented field semantics, and rate
limit shapes can change inside the eighteen-month window with two
weeks of notice on the customer status page.
