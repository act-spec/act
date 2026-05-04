---
title: Customer spotlight — Acme Storage Co.
summary: How Acme Storage Co. moved 4.2 PB onto Tinybox over six weeks with zero customer-visible downtime.
date: 2026-08-25
type: post
parent: posts
tags:
  - customers
  - case-study
---

Acme Storage Co. completed their migration from a self-hosted Ceph
cluster onto Tinybox last week, six weeks ahead of plan. The full
case study is below; we publish a short version here.

## Migration shape

4.2 PB across 38 buckets, dual-write window of 11 days, rollback
window of 90 days. Peak write throughput during the dual-write window
was 4.4 GB/s; peak read throughput at cutover was 12 GB/s.

## Lessons

The rate limiter we shipped in July is what made the dual-write
window cheap; without per-region throttling Acme would have spent an
extra week on careful rollout sequencing.
