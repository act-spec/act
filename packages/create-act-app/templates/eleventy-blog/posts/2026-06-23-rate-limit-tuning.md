---
title: Tuning the rate limiter — what changed and why
summary: The rate limiter rewrite shipped on June 12; here is what changed in the algorithm and the customer-visible behavior.
date: 2026-06-23
type: post
parent: posts
tags:
  - reliability
  - performance
---

The rate limiter rewrite shipped on June 12 and has been running on
all production traffic for ten days. Customer-visible 429s are down
38% relative to the previous month at equivalent load.

## Algorithm

The old limiter used a global token bucket per account. The new one
uses a sharded token bucket keyed on `(account, region, endpoint
class)`, which lets a noisy endpoint take its own throttling without
choking out the rest of the account's traffic.

## Customer-visible behavior

The retry-after hint in 429 responses is now a true window estimate
rather than a fixed two-second value. Customers using the official
SDK get smarter backoff for free; customers on hand-rolled clients
should switch to the `Retry-After` header for best results.
