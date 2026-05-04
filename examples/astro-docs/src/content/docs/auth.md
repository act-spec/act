---
title: Authentication
summary: Tinybox uses workspace-scoped Bearer tokens; this page explains how to mint, scope, and rotate them.
type: concept
parent: root
related:
  - quickstart
  - errors
tags:
  - auth
  - tokens
---

# Authentication

Tinybox authenticates every request with a workspace-scoped Bearer token.
Tokens are minted from the dashboard's **Settings → API tokens** page and
carry a stable `wks_` prefix followed by a 32-character random suffix.

## Token scope

A token authorizes one workspace. Cross-workspace requests fail with a
`403 forbidden` and a typed error body. Mint a separate token per
environment.

## Rotation

Rotate a token by minting a new one and revoking the old. Tinybox does not
auto-rotate; the lifecycle is operator-driven.

> [!IMPORTANT]
> Treat tokens like passwords. Never commit them to a repository. The
> dashboard's "regenerate" action invalidates the old token immediately.

```http
Authorization: Bearer wks_AAAAaBbCcDdEeFfGgHhIiJjKkLlMmNn
```
