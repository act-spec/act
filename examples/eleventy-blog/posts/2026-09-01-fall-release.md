---
title: Fall 2026 release notes
summary: The September release ships incremental backups, region-aware throttling, and a long-overdue redesign of the dashboard's billing tab.
date: 2026-09-01
type: post
parent: posts
tags:
  - release
---

The September release went out at 16:00 UTC today. Three highlights
are below; the full changelog is on the changelog page.

## Incremental backups

Backup runs now skip unchanged objects, cutting incremental backup
costs by 60–80% for write-light workloads. Existing scheduled backups
pick up the new behavior automatically.

## Region-aware throttling

Throttle limits now apply per region rather than per global account,
so a noisy region can no longer starve a quiet one.
