---
id: reference/cli
title: CLI
summary: The tinybox CLI — every subcommand, flag, and exit code.
type: reference
parent: root
locale: en-US
related:
  - reference/configuration
  - guide/installation
---

# CLI

The `tinybox` binary ships with the Node SDK and reads `TINYBOX_TOKEN`
from the environment.

## Subcommands

### `tinybox buckets list`

List buckets in the active workspace. Output is JSON unless `--text` is
passed.

### `tinybox objects upload <path>`

Upload a local file to the default bucket. Use `--bucket <name>` to
target a specific bucket.

### `tinybox objects download <id> <path>`

Download an object by id to the local path. Streams; safe for large
blobs.

## Exit codes

| Code | Meaning                              |
| ---- | ------------------------------------ |
| 0    | Success                              |
| 1    | Generic failure                      |
| 2    | Authentication / authorization error |
| 3    | Rate-limit exceeded                  |
| 4    | Network or timeout                   |

> [!WARNING]
> The CLI buffers up to 16 MiB per response in memory. For larger
> payloads, prefer the SDK's streaming API directly.
