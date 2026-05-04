---
title: Q2 2026 in review
summary: Three things we shipped, two things we missed, and one we learned the hard way during the quarter that just ended.
date: 2026-06-30
type: post
parent: posts
tags:
  - retrospective
---

Q2 ended yesterday. Three things shipped, two slipped, one lesson
that cost the team a Friday evening.

## Shipped

The rate limiter rewrite, the new billing dashboard, and the docs
overhaul. All three landed inside their target weeks; the rate
limiter shipped two days early.

## Slipped

Multi-region replication moved to Q4; we underestimated the design
work needed to make conflict resolution acceptable for transactional
workloads. The CLI rewrite slipped to October for the same reason —
the design constraints were heavier than expected.

## Learned

A single misconfigured load-balancer health check probe pulled an
entire region offline for 12 minutes. The probe was supposed to
return 200 for healthy and timeout for unhealthy; instead it
returned 200 for healthy and 503 for "in maintenance." The load
balancer treated 503 as healthy.
