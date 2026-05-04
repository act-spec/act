---
title: Region-loss recovery drill, summer edition
summary: We pulled an entire region offline at 02:00 UTC on a Tuesday and recovered it in 7 minutes 14 seconds.
date: 2026-08-04
type: post
parent: posts
tags:
  - reliability
  - drills
---

Last Tuesday at 02:00 UTC we pulled the eu-west region offline as a
scheduled drill. Total outage from the customer's perspective: 41
seconds (load balancer failover) plus 6 minutes 33 seconds of degraded
write throughput while the secondary region took up the load.

## What worked

The failover path itself ran exactly as designed. The synthetic
probes detected the outage in 8 seconds; the load balancer drained
the failed region in 33 seconds.

## What did not

The dashboards we relied on for incident triage were partially
served from the failed region. Three of seven critical dashboards
were unavailable for the first 90 seconds of the drill.
