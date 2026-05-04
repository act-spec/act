---
id: marketing/about
type: page
title: About Acme
summary: Who we are, why we built ACT, and how the hybrid topology composes static marketing plus authenticated app surfaces under one well-known manifest.
---

Acme is the maintainer of the Agent Content Tree (ACT) reference
implementation. We built ACT because every agent-friendly content stack
should look the same on the wire: one well-known manifest, predictable URL
templates, and stable ETags that agents can cache.

The hybrid topology demonstrated in this PRD-706 example pairs an
unauthenticated static `/marketing` mount with an authenticated runtime
`/app` mount, exposed jointly through the ACT-MCP bridge at
`act://acme.local/...`. Same tree, two transports, one manifest.
