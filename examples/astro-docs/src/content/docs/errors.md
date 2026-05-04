---
title: Error envelope
summary: Tinybox returns a typed JSON error on every non-2xx response. This page enumerates the error codes.
type: reference
parent: root
related:
  - auth
  - rate-limits
---

# Errors

Tinybox returns the same envelope for every error response:

```json
{
  "error": {
    "code": "object_not_found",
    "message": "No object at bucket=my-bucket key=missing.txt.",
    "request_id": "req_abc123"
  }
}
```

## Codes

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `bad_request` | Malformed JSON or missing required field. |
| 401 | `unauthorized` | Missing or invalid Bearer token. |
| 403 | `forbidden` | Token does not authorize the requested workspace or bucket. |
| 404 | `object_not_found` / `bucket_not_found` | Resource doesn't exist (or the caller can't see it). |
| 409 | `conflict` | Bucket name collision or version conflict. |
| 429 | `rate_limited` | Too many requests; see [Rate limits](./rate-limits.md). |
| 500 | `internal_error` | Server-side failure. Safe to retry idempotent reads. |

Always log the `request_id`. Support requests are routed by it.
