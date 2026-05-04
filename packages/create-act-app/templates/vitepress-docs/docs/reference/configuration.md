---
id: reference/configuration
title: Configuration
summary: Every Tinybox SDK config field, its default, and when to override it.
type: reference
parent: root
locale: en-US
related:
  - reference/cli
  - reference/api
---

# Configuration

The Tinybox client takes a single options object. All fields are optional
except `token`.

| Field        | Type     | Default                    | Notes                              |
| ------------ | -------- | -------------------------- | ---------------------------------- |
| `token`      | string   | —                          | Required. Workspace bearer token.  |
| `endpoint`   | string   | `https://api.tinybox.dev`  | Override for self-hosted installs. |
| `timeout`    | number   | `30000`                    | Per-request timeout in ms.         |
| `retries`    | number   | `3`                        | Idempotent retry count.            |
| `userAgent`  | string   | `tinybox-sdk/<version>`    | Suffixed onto outbound requests.   |

```ts
const client = new TinyboxClient({
  token: process.env.TINYBOX_TOKEN!,
  endpoint: 'https://tinybox.internal.example.com',
  timeout: 60_000,
  retries: 5,
});
```

The client never reads `.env` or any ambient config; pass everything
explicitly so test harnesses behave deterministically.
