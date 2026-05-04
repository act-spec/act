---
title: Security
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Security

> ACT publishes structured content over HTTP. The wire format itself
> carries no executable code, but the surrounding deployment — the
> origin's transport, CORS posture, authentication contract, and the
> consumer's rendering of prose blocks — has security implications
> that this document spells out. The requirements here apply alongside
> the per-document contracts in [manifest.md](./manifest.md),
> [node.md](./node.md), and [conformance.md](./conformance.md).

## Threat model

The v0.2 wire format treats the following threats as in scope:

- **T1. Cross-origin reads against private content.** A producer that
  publishes ACT to authenticated users MUST NOT inadvertently expose
  the same content to anonymous cross-origin readers. The static-vs-
  runtime delivery distinction encodes the producer's audience choice.
- **T2. Existence disclosure.** A 404 vs 401 distinction can leak the
  existence of a private resource. ACT collapses both cases to 404 on
  the runtime profile.
- **T3. Content tampering.** A man-in-the-middle that can modify ACT
  responses can poison the consumer's rendered output. Transport-level
  HTTPS is REQUIRED in production to mitigate.
- **T4. Denial of service.** Producers MAY rate-limit; consumers MUST
  cap subtree depth, body size, and parse memory.
- **T5. Prompt injection via crafted prose.** ACT prose blocks are
  consumed by AI agents; a hostile producer can embed instructions
  intended to subvert a downstream LLM consumer. This is fundamentally
  a consumer-side problem (the consumer's LLM is the trust boundary),
  but producers SHOULD NOT include script tags or active payloads in
  prose, and consumers MUST sanitize prose before rendering or
  passing to an LLM.
- **T6. Cross-origin mount trust.** A parent manifest that mounts a
  manifest at a different origin extends trust off-origin; consumers
  MUST evaluate origin trust before treating the mount as
  authoritative.
- **T7. Identity correlation via stable IDs.** ACT IDs are stable for
  `(resource, identity, tenant)` triples. An observer that can
  correlate one identity's traffic over time can correlate the
  identity's reads. This is a known property; producers requiring
  correlation resistance MUST layer it on top of ACT.

The schemas under
[`schemas/109/`](../../../schemas/109/) formalize the auth-scheme,
`WWW-Authenticate`, and cross-origin-mount-trust shapes referenced
below.

## Transport

### HTTPS

HTTPS is REQUIRED for any production ACT deployment. Static-profile
deployments served by a public CDN MUST use HTTPS; runtime-profile
deployments serving authenticated traffic MUST use HTTPS.

Local development and testing over plain HTTP is permitted; producers
deploying internally on private networks MAY use HTTP, but consumers
SHOULD warn when an HTTP origin is encountered in any production
context.

### CORS

Static-profile manifests are public discovery documents and SHOULD be
CORS-allowed: the CDN SHOULD send `Access-Control-Allow-Origin: *` on
every static-profile resource (manifest, index, node, subtree, NDJSON).
This unblocks browser-based consumers (validators, dashboards,
client-side agents) without compromising security — the resources are
already public.

Producers that intentionally restrict CORS (private-network or
authenticated deployments) MAY override the SHOULD; they then take
responsibility for any blocked client.

Runtime-profile producers that serve authenticated content MUST handle
CORS preflight (`OPTIONS`) correctly. Strict-level conformance requires
preflight handling.

### Content Security Policy

The producer's HTML pages (separate from the ACT JSON resources) MAY
declare a CSP that includes the ACT origin in `connect-src`. Consumers
that fetch ACT from a browser context MUST be prepared for CSP-related
fetch failures and SHOULD surface them to their caller.

The ACT JSON resources themselves do not require a CSP — they are
inert JSON.

## Authentication

A producer that requires authentication for some or all ACT endpoints
MUST be in delivery profile `runtime`. Static-profile manifests MUST
NOT advertise auth schemes; advertising `auth.schemes` on a static
manifest is a build-time error.

When authentication is required, the manifest MUST declare an
`auth.schemes` array — see
[`schemas/109/auth-schemes.schema.json`](../../../schemas/109/auth-schemes.schema.json).
The array MUST be ordered by server preference, most-preferred first.
Each scheme entry has a `kind` field; the v0.2 spec recognizes:

- `"oauth2"` — declares non-empty `authorization_endpoint`,
  `token_endpoint`, and `scopes_supported`. The minimum scope
  `act.read` is reserved by the spec; OAuth2 schemes MUST advertise
  either `act.read` or a superset that grants read access.
- `"api_key"` — SHOULD use the `Authorization: Bearer <key>` HTTP
  header. Custom header names are permitted but discouraged for new
  deployments.

When the manifest's `auth.schemes` advertises N schemes, a runtime 401
response MUST include exactly N `WWW-Authenticate` challenges, one per
scheme, in the manifest-declared preference order. The structured
shape is at
[`schemas/109/www-authenticate.schema.json`](../../../schemas/109/www-authenticate.schema.json).
A consumer SHOULD attempt schemes in the advertised order and SHOULD
fall back to the next scheme on per-scheme auth failure (not on
transport failure).

`WWW-Authenticate` auth-param values (`realm`, `scope`, etc.) MUST NOT
include user-identifying tokens, request-local nonces, or any value
that varies across requesting identities for the same protected
resource.

Authentication scoping is orthogonal to conformance level. A runtime
producer MAY require authentication at Core, Standard, or Strict.

## Existence disclosure

A runtime 404 response MUST NOT distinguish "the resource does not
exist" from "the resource exists but the requester is not authorized
to know it exists." Both cases MUST collapse to 404 with a
byte-equivalent body (modulo opaque, non-identity-correlated request
IDs that the validator treats as a tolerated nonce).

A 401 response is reserved for "authentication is required to access
this scope." A 403 ("explicitly forbidden when existence is already
known to the requester") is rare and SHOULD only be used when the
requester can already prove the resource's existence by other means;
otherwise prefer 404.

The well-known discovery path (`/.well-known/act.json`) reveals that
the site supports ACT. This is **by design**: the spec is a public
feature, not a secret. Producers wishing to limit ACT discovery to
authenticated contexts MUST use the runtime-only discovery hand-off
(HTTP `Link` header on authenticated responses) and MUST NOT serve
the well-known path publicly. Producers MUST NOT rely on path
obscurity for security at any level.

## Content sanitization

ACT prose blocks (`markdown`, `prose`, `callout`) are typed text
payloads. The wire format does not interpret markup; consumers do.

Consumers MUST sanitize prose-block content before rendering it in any
HTML context: a `markdown` block's `text` field rendered into an HTML
DOM MUST pass through a CommonMark renderer with HTML escaping enabled
and SHOULD pass through a sanitizer (DOMPurify or equivalent).
Consumers passing prose-block content to a downstream LLM SHOULD apply
prompt-injection defenses at their own boundary.

Producers SHOULD NOT include `<script>` tags, `javascript:` URIs, or
other active payloads in prose blocks. Producers that source content
from upstream user-generated content (a CMS with public commenting,
e.g.) MUST sanitize on the way in; the wire format itself does not
sanitize.

Free-text fields (`title`, `summary`, `abstract`) carry no markup
interpretation at the wire layer. Consumers rendering them in HTML
contexts MUST apply framework-appropriate escaping.

## Identifier safety

Producers MUST NOT include identity-correlated tokens in the public ID
grammar. Examples of prohibited material in `id`: a user's email, a
session token, a JWT `sub` claim, an OAuth access token.

The ID grammar (lowercase ASCII alphanumeric plus `.`, `_`, `-`, `/`)
is `pchar`-clean per RFC 3986 §3.3, which eliminates URL-injection
risk in `node_url_template` substitution.

Runtime IDs MUST be stable for a given `(resource, identity, tenant)`
triple across the lifetime of the resource. Producers MUST NOT mint
per-request-unique IDs.

## Error envelope hygiene

A runtime error envelope's `error.message` field MUST NOT contain
PII, identity tokens, raw user input, auth secrets, or any value that
varies across identities for the same condition. `error.message` is
for human-readable logging and MUST be safe to surface in any consumer
log without further redaction.

`error.details` MAY contain code-specific structured data, but the
same prohibitions apply: no PII, no identity tokens, no raw user
input, no auth secrets. Producers SHOULD prefer structured codes
(e.g., `details.field: "workspace_name"`) over free-form text.

## Rate limiting

Runtime producers SHOULD rate-limit by identity. The manifest's
`policy.rate_limit_per_minute` field is advisory only — it informs
consumers of the producer's expected limit but does not bind the
producer.

Consumers MUST handle 429 (`error.code: "rate_limited"`) responses.
When the producer sends an HTTP `Retry-After` header, the response
SHOULD also set `details.retry_after_seconds` in the error envelope
for parser convenience.

The search endpoint specifically (when offered) SHOULD apply tighter
rate limiting than other endpoints because search is the most
expensive path.

## Cross-origin mounts

When a parent manifest's `mounts` entry points to a manifest at a
different origin (scheme + host + port differing from the parent's
origin), the consumer MUST evaluate origin trust before treating the
mounted manifest as binding. The trust evaluation algorithm is at
[`schemas/109/cross-origin-mount-trust.schema.json`](../../../schemas/109/cross-origin-mount-trust.schema.json);
the consumer SHOULD warn its caller when a cross-origin mount is
followed.

Producers that publish cross-origin mounts SHOULD ensure that the
mount target's origin is under the same operational control as the
parent (e.g., `example.com` mounting `app.example.com`).
Cross-organization mounts are technically allowed but operationally
fragile.

## Anti-spoofing (informative)

Signed manifests via a `signature` extension are reserved for a future
spec revision. The v0.2 spec does not normatively define signing; the
threat model in the meantime relies on transport-level HTTPS and the
producer's origin authority. Producers requiring strong cryptographic
provenance MUST layer it on top of ACT for v0.2.

## Per-node "agents only" flags (out of scope)

Per-node "agents only" / "no train" / "no AI training" flags are
explicitly **OUT OF SCOPE** for v0.2. Producers MUST NOT emit such
fields and consumers MUST NOT treat any such field as binding access
control. The rationale:

1. ACT does not control downstream AI training pipelines; an
   informational flag has no enforcement.
2. The legal/policy landscape is unsettled; the v0.2 spec declines to
   pick a side.

Producers wishing to express these preferences SHOULD use existing
mechanisms (`robots.txt`, `meta` tags, the `X-Robots-Tag` header) at
the HTML/origin layer.

## Conformance

| Requirement | Core | Standard | Strict |
|---|---|---|---|
| HTTPS in production | SHOULD | MUST | MUST |
| `Access-Control-Allow-Origin: *` on static manifests | SHOULD | SHOULD | SHOULD |
| 404 vs 401 disclosure rule (runtime) | MUST when runtime | MUST when runtime | MUST when runtime |
| `WWW-Authenticate` 1:1 with `auth.schemes` | MUST when runtime+auth | MUST when runtime+auth | MUST when runtime+auth |
| Bearer token on per-node fetches (runtime+auth) | n/a | n/a | MUST |
| CORS preflight (runtime cross-origin) | n/a | SHOULD | MUST |
| Content sanitization on consumer side | MUST | MUST | MUST |
| Producers omit active payloads in prose | SHOULD | SHOULD | SHOULD |
| `error.message` PII-free | MUST when runtime | MUST when runtime | MUST when runtime |
| Rate limiting by identity (runtime) | SHOULD | SHOULD | SHOULD |
| Cross-origin mount trust evaluation | MUST when consumed | MUST when consumed | MUST when consumed |
| Signed manifests (`signature` extension) | INFORMATIVE | INFORMATIVE | INFORMATIVE |

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |
