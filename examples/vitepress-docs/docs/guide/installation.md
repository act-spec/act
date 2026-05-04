---
id: guide/installation
title: Installation
summary: Install the Tinybox SDK from npm, PyPI, or crates.io and verify the import.
type: tutorial
parent: root
locale: en-US
related:
  - guide/getting-started
  - reference/cli
---

# Installation

The Tinybox SDK is published to all three major package registries. Pick
the one that matches your runtime.

## Node.js

```bash
npm install @tinybox/sdk
```

```ts
import { TinyboxClient } from '@tinybox/sdk';
const client = new TinyboxClient({ token: process.env.TINYBOX_TOKEN });
```

## Python

```bash
pip install tinybox
```

```python
from tinybox import TinyboxClient
client = TinyboxClient(token=os.environ["TINYBOX_TOKEN"])
```

## Rust

```bash
cargo add tinybox
```

Verify your install by listing buckets in your default workspace; you
should see at least the auto-provisioned `default` bucket.
