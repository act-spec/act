---
title: Quickstart
summary: Send your first authenticated Tinybox request in under a minute.
type: tutorial
parent: root
related:
  - auth
  - endpoints/objects
---

# Quickstart

Mint a workspace token from the dashboard, then send an authenticated request
to list objects in your default bucket.

```bash
export TINYBOX_TOKEN='wks_…'
curl -H "Authorization: Bearer $TINYBOX_TOKEN" \
  https://api.tinybox.dev/v1/objects
```

> [!TIP]
> Tokens are scoped to a single workspace. Mint a separate token per
> environment (dev, staging, prod).

The response carries a `Link: …rel="next"` header when results are paginated.
Follow the header until it disappears to walk the full list.
