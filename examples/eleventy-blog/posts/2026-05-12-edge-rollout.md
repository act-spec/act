---
title: Edge fleet rollout, week two
summary: The edge fleet now serves 38% of traffic from 14 metro regions; performance numbers and the rollout plan for the remaining 62%.
date: 2026-05-12
type: post
parent: posts
tags:
  - edge
  - performance
---

The edge fleet entered week two today. 38% of read traffic now
serves from one of 14 metro regions; the median P50 read latency
dropped from 84ms to 22ms for traffic served from edge.

## What is on edge

Read-heavy operations only: bucket listing, object metadata reads,
and signed-URL generation. Writes continue to land in the origin
region; the edge fleet does not buffer writes in v1.

## Rollout plan

The remaining 62% of traffic moves over in batches of roughly 10%
per week, gated on the synthetic probe network reporting healthy
across the metro region for the previous 48 hours.
