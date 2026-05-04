---
title: Buckets endpoint
summary: Create, list, and configure storage buckets within a workspace.
type: reference
parent: endpoints
related:
  - endpoints/objects
---

# Buckets

A bucket is a namespace within a workspace. Buckets carry a name, an
optional description, and a versioning policy.

## Create a bucket

```http
POST /v1/buckets
Content-Type: application/json

{ "name": "my-bucket", "versioning": "enabled" }
```

## List buckets

```http
GET /v1/buckets
```

Returns every bucket the calling token can read.

## Update a bucket's policy

```http
PATCH /v1/buckets/{name}
Content-Type: application/json

{ "versioning": "suspended" }
```

> [!WARNING]
> Suspending versioning does not delete prior versions; it only stops
> creating new ones. Use the [Objects](./objects.md) endpoint to clean up.
