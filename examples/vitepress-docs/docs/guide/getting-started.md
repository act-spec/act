---
id: guide/getting-started
title: Getting Started
summary: Send your first authenticated Tinybox request in under a minute.
type: tutorial
parent: root
locale: en-US
related:
  - guide/installation
  - reference/configuration
---

# Getting Started

Mint a workspace token from the dashboard, then send an authenticated
request to list objects in your default bucket.

```bash
export TINYBOX_TOKEN='wks_…'
curl -H "Authorization: Bearer $TINYBOX_TOKEN" \
  https://api.tinybox.dev/v1/objects
```

> [!TIP]
> Tokens are scoped to a single workspace. Mint a separate token per
> environment (dev, staging, prod).

When you are ready to write code, head to [Installation](./installation.md)
and pick an SDK.
