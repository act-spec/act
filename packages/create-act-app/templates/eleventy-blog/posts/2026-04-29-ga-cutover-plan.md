---
title: The GA cutover plan, in writing
summary: How we plan to flip the GA switch on May 1 — the order of operations, the rollback gates, and the on-call shape for the cutover weekend.
date: 2026-04-29
type: post
parent: posts
tags:
  - launch
  - process
---

The GA cutover is two days away. We are publishing the cutover plan
ahead of time so any customer running on the private beta knows
what to expect.

## Order of operations

The marketing site refresh goes live at 09:00 UTC on May 1. Pricing
flips at 10:00 UTC. Account self-signup opens at 12:00 UTC. The on-
call rotation doubles up for the 24 hours after self-signup opens.

## Rollback gates

If the new-account signup error rate exceeds 1% for ten minutes,
self-signup pauses automatically and the on-call lead is paged.
Pricing changes are rollback-able for 30 days; marketing site is
rollback-able indefinitely.
