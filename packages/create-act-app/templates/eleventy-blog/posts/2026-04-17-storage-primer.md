---
title: A short primer on object storage
date: 2026-04-17
type: post
parent: posts
tags:
  - primer
---

Object storage is one of the most-used and least-understood
primitives in cloud infrastructure. This post is a short primer on
what object storage is, what it is good at, and where it falls down
relative to the alternatives.

## The model

An object store maps an opaque key (a string) to an opaque value
(bytes plus a small fixed metadata bag). The key namespace is flat;
the apparent directory hierarchy is a UI convention enforced by
delimiters in the listing API.

## Where it shines

Read-heavy workloads where the reads are large enough that the per-
request overhead does not dominate. Backup, archival, static asset
hosting, and data lake patterns all fit naturally.

## Where it falls down

Transactional workloads where multiple objects need to update
atomically. Object stores typically offer single-object atomicity
only; coordinating across objects is a layer the application has
to build.
