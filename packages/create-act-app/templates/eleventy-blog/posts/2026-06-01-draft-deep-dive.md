---
title: Deep dive on lifecycle policies
summary: Work in progress draft on bucket lifecycle policies — excluded from public output via permalink false.
date: 2026-06-01
type: post
parent: posts
permalink: false
tags:
  - draft
---

(Work in progress.) Eleventy excludes this file from `_site/`
because of `permalink: false`. PRD-408's permalink-aware filter
drops it from ACT emission and surfaces an `excluded_by_permalink`
warning in the build report; the post is absent from
`_site/act/index.json` and from `_site/act/nodes/`.
