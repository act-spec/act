---
id: api-auth
title: Authentication
type: reference
tags: [api, auth]
---

Authenticate via a bearer token in the `Authorization` header. Tokens are
issued from the Acme dashboard and scoped per project.

## Token rotation

Rotate tokens monthly; the API supports overlap windows for zero-downtime
rotation.
