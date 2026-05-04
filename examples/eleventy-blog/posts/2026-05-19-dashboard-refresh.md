---
title: New dashboard ships with the May minor release
summary: The dashboard refresh is generally available; the headline change is a faster bucket overview that loads in under 200ms even at 50k buckets.
date: 2026-05-19
type: post
parent: posts
tags:
  - product
  - dashboard
---

The dashboard refresh shipped this morning as part of the May minor
release. Two notable changes are below.

## Bucket overview

The bucket overview now loads in under 200ms at 50,000 buckets. The
old overview took 4 to 8 seconds at the same scale. The win came
from server-side pagination plus a row-virtualisation rewrite on the
client.

## Settings reorganisation

The settings tree is now four sections (Workspace, Billing, Access,
API) rather than fourteen. The reorganisation is the culmination of
six months of usage analysis; almost every individual setting moved.
