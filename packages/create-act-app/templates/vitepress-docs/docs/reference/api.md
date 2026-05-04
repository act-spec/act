---
id: reference/api
title: HTTP API
summary: REST surface for Tinybox — endpoints, request shapes, and pagination.
type: reference
parent: root
locale: en-US
related:
  - guide/getting-started
  - reference/configuration
---

# HTTP API

Tinybox speaks REST over HTTPS and returns JSON. Every successful
response carries an `X-Request-Id` header you can quote in support
tickets.

## Endpoints

### `GET /v1/buckets`

List buckets in the workspace. Supports `?cursor=` pagination.

### `POST /v1/buckets`

Create a bucket. Body: `{ "name": "<dns-safe>" }`. Returns `201` on
success or `409` when the name is taken.

### `GET /v1/objects`

List objects across the workspace. Filter with `?bucket=<name>`.

### `POST /v1/objects`

Upload an object. Use multipart/form-data with a `file` part and an
optional `metadata` JSON part.

### `GET /v1/objects/{id}`

Fetch object metadata. Append `?include=body` to stream the blob in the
same response (counts as one request against your rate limit).

## Pagination

List endpoints return `{ "items": [...], "next_cursor": "<opaque>" }`.
Pass `next_cursor` as `?cursor=<value>` on the next request. When the
server omits `next_cursor`, you have walked the full list.
