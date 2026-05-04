---
title: Pagination
summary: Every list endpoint paginates with cursor links delivered in the Link response header.
type: concept
parent: root
related:
  - endpoints/objects
  - endpoints/buckets
---

# Pagination

Every Tinybox list endpoint returns at most `limit` items (default 50; max
500) and emits a `Link: <next>; rel="next"` header when more results exist.

## Walking the list

```bash
url='https://api.tinybox.dev/v1/objects?bucket=my-bucket'
while [ -n "$url" ]; do
  resp=$(curl -i -H "Authorization: Bearer $TOKEN" "$url")
  body=$(printf '%s' "$resp" | sed -n '/^$/,$p')
  url=$(printf '%s' "$resp" | grep -i '^Link:' | grep -oE 'https://[^>]+' | head -1)
  printf '%s\n' "$body"
done
```

Cursors are opaque and forward-only. Don't try to construct them by hand.
