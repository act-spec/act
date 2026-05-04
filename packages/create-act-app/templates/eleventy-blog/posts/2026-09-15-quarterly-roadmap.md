---
title: Q4 roadmap themes
summary: Three themes for the next quarter — multi-region replication, a richer audit log, and the long-promised CLI rewrite.
date: 2026-09-15
type: post
parent: posts
tags:
  - roadmap
---

The Q4 roadmap is short on purpose. Three themes, in priority order:
multi-region replication, audit log v2, and the CLI rewrite that has
been on the roadmap since the Q1 planning session.

## Multi-region replication

The current single-region default is the largest source of churn from
our enterprise pipeline. Multi-region writes ship as opt-in in October
with a default-on cutover scheduled for the December release.

## Audit log v2

The current audit log streams to S3 only. v2 adds Webhook delivery,
PII redaction at the transport layer, and a 13-month retention window
without per-event pricing.
