---
title: GA readiness checklist (the public version)
summary: The 24-item checklist we ran the platform through before declaring general availability in May, lightly redacted and published as a template.
date: 2026-08-18
type: post
parent: posts
tags:
  - process
  - reliability
---

We get asked roughly twice a month what our pre-GA checklist looked
like. Here it is, lightly redacted. Twenty-four items spanning
reliability, security, billing, support, and documentation.

## Reliability

Eight items on reliability: SLO definitions, paging rotation, on-call
runbooks for the top ten incident classes, chaos engineering drills
for two regions, dependency graph audited for single points of
failure, capacity headroom verified at 3x peak load, fail-open default
removed for the auth path, and a quarterly drill cadence committed.

## Security

Six items on security: penetration test closed with no high
findings, secrets management migrated off environment variables,
audit log retention promised contractually, response-time SLA for
P0 disclosure, customer-managed keys supported, and a third-party
SOC 2 Type II in flight.
