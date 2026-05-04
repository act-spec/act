---
title: Tinybox Blog
summary: A flat chronological blog about building Tinybox, a fictional storage primitive used as a PRD-707 canonical example corpus.
type: page
tags:
  - home
---

Tinybox Blog is a fictional Eleventy site used by PRD-707's reference
example. Posts under `posts/` form a flat, date-prefixed chronological
feed; the synthetic `posts` parent node enumerates them in
reverse-chronological order so an agent can ask "what's new on this
site?" and traverse the subtree.

The site exists to exercise the full PRD-408 pipeline against a
realistic blog corpus: permalink-aware draft filtering, the
source-of-truth-is-markdown rule, the no-bindings invariant, and the
Standard-band subtree emission for the synthetic chronological parent.
