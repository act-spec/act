---
title: Webhooks
summary: Tinybox can deliver bucket and object events to your endpoint as signed JSON webhooks.
type: concept
parent: root
related:
  - auth
  - endpoints/buckets
---

# Webhooks

Tinybox can deliver `object.created`, `object.deleted`, and
`bucket.versioning_changed` events to a URL of your choice.

## Subscribe

```http
POST /v1/webhooks
Content-Type: application/json

{
  "url": "https://example.com/tinybox-hook",
  "events": ["object.created", "object.deleted"]
}
```

## Signature verification

Every delivery carries a `Tinybox-Signature: v1=<hex>` header. Compute
HMAC-SHA256 over the raw body using the subscription's secret and
constant-time-compare.

> [!WARNING]
> A failing signature verification is not a recoverable error. Reject the
> request with `401`; do not retry.
