---
title: Billing migration off the legacy provider
summary: We finished the year-long migration off our legacy billing platform on May 24; here is what the cutover weekend looked like.
date: 2026-05-26
type: post
parent: posts
tags:
  - billing
  - migrations
---

The year-long billing migration finished on the morning of May 24.
Total downtime: zero. Total invoice replays: 14, all of which were
caught by an automated reconciliation step before any customer saw
the wrong number.

## Why it took a year

The legacy provider's data export format was a flat CSV with no
notion of prorations or credits. Reconstructing the prorations from
event logs took three months. The dual-write phase took another six.

## What changed for customers

Nothing visible. Invoices keep arriving on the same day of the month
in the same format with the same line items. The only change a
customer might notice is that the support reply on a billing
question now comes back in 12 hours rather than 36.
