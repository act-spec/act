---
title: Objects endpoint
summary: List, fetch, upload, and delete object blobs in a workspace bucket.
type: reference
parent: endpoints
related:
  - endpoints/buckets
  - quickstart
---

# Objects

The `/v1/objects` endpoint family is the primary read/write surface for
binary blobs. Every object is identified by `(bucket, key)` and carries an
opaque ETag for cache validation.

## List objects

```http
GET /v1/objects?bucket={bucket}&limit=50
```

Returns a paginated list. Follow the `Link: …rel="next"` header until
exhausted.

## Fetch one object

```http
GET /v1/objects/{bucket}/{key}
```

Returns the object's metadata and a presigned download URL.

## Upload

```http
PUT /v1/objects/{bucket}/{key}
Content-Type: application/octet-stream
```

The request body is the raw blob bytes. Tinybox computes the content hash
server-side and returns it in the response's ETag header.

> [!CAUTION]
> Uploads are not idempotent across distinct bytes. Two uploads with the
> same `(bucket, key)` and different bodies overwrite; the second wins.
