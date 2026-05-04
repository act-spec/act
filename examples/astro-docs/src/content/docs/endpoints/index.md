---
title: Endpoints
summary: Full reference for every Tinybox HTTP endpoint, grouped by resource.
type: reference
parent: root
children:
  - endpoints/objects
  - endpoints/buckets
---

# Endpoints

Tinybox exposes two top-level resources: **objects** (the binary blobs you
store) and **buckets** (the namespaces that group them). Every endpoint
returns JSON, accepts JSON for write operations, and observes the
standardized error envelope documented in [Errors](../errors.md).

## Resources

- [Objects](./objects.md) — list, fetch, upload, delete object blobs.
- [Buckets](./buckets.md) — create, list, configure storage buckets.

All endpoints honor the `Authorization: Bearer …` header described in
[Authentication](../auth.md).
