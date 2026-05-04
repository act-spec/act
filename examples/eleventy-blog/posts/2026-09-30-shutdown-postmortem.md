---
title: Postmortem on the September edge node shutdown
summary: A retrospective on the rolling restart that took our European edge fleet offline for 41 minutes on September 27.
date: 2026-09-30
type: post
parent: posts
tags:
  - postmortem
  - reliability
---

On September 27 at 14:12 UTC our European edge fleet went into a
rolling restart that we had marked as zero-downtime. It was not. The
fleet returned 5xx errors for 41 minutes before traffic stabilised.

## What happened

The restart hook drained connections in batches of four nodes at a
time. The depth of the shared queue meant that in-flight requests
arriving at a draining node had nowhere to fail over because all four
peers in the same rack were also draining. The intended overlap
window was 30 seconds; actual overlap was 4 minutes 12 seconds.

## Fixes

We have moved to per-rack rolling restarts, capped concurrent drains
at 25% of any rack, and added a synthetic probe that fails the deploy
if more than two peers in a rack report `draining` at once.
