---
title: Cleaning up 122 stale feature flags in one quarter
summary: A short retrospective on the project that took our feature flag count from 240 down to 118 and stopped a few production incidents along the way.
date: 2026-07-14
type: post
parent: posts
tags:
  - process
  - engineering
---

The feature flag store had 240 flags in it at the start of Q2. As
of last week, 118. The cleanup retrospective is below.

## How the count grew

A flag-creation policy change two years ago made flags free to
create and never asked anyone to remove them. The result was
predictable: flags accumulated, and the ones that were left on by
default after the experiment ended were the most dangerous.

## What changed

Every flag now has an owner, an expected sunset date, and an alert
that pages the owner if the flag is still around 90 days after the
expected sunset. The change took two engineers four weeks to roll
out across the codebase.
