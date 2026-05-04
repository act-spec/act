---
title: Notes on our observability stack
summary: The three tools we keep around (metrics, logs, traces) and the four we tried and dropped — with concrete reasons for each cut.
date: 2026-08-11
type: post
parent: posts
tags:
  - observability
  - tools
---

The current observability stack is three tools deep: a metrics store,
a log aggregator, and a tracing pipeline. We tried four others over
the last two years and dropped each for reasons that surprised us at
the time but look obvious in hindsight.

## What we kept

Metrics: Prometheus + a long-term store. Logs: a self-hosted Loki
cluster. Traces: OpenTelemetry pipeline routed to a hosted backend
with three months of full-fidelity retention.

## What we cut

Two APM tools (overlapping with traces, billing got out of hand at
our cardinality), a synthetic monitoring SaaS (replaced by a
home-grown probe network running on the edge fleet), and a profiler
(useful but the team did not check the dashboards).
