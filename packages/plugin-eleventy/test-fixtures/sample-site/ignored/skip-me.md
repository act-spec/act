---
title: Skip me
summary: This file lives under an .eleventyignore directory and is skipped.
type: page
---

This file MUST NOT appear in the ACT manifest because the path matches
an entry in `.eleventyignore`. The plugin threads the ignore patterns
into the markdown adapter's exclude glob (PRD-408-R3).
