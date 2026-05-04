# Test fixtures — `@act-spec/adapter-strapi`

Recorded Strapi REST/GraphQL responses, used by the unit + integration test
suite and the conformance gate to exercise PRD-205 end-to-end without live
Strapi API calls (per the role's "no live Strapi API calls in tests"
constraint).

Each subdirectory groups one positive scenario:

- `standard-emission-v5/` — Strapi v5 REST envelope (flat `{ id,
  documentId, ... }`); two `articles` entities; one with a markdown body
  + admonition + fenced code; relation resolution between siblings.
  Exercises PRD-205-R3, R4, R5, R7, R8, R9 (default), R12, R18, R19, R26.
- `standard-emission-v4/` — Strapi v4 REST envelope (`{ id, attributes }`);
  two `tutorials` entities; markdown body. Exercises PRD-205-R3 (v4 envelope
  handling) and PRD-205-R26 (`v4:<id>` source_id).
- `plus-emission/` — Plus build with locale fan-out (`en` + `de`) AND
  `componentMapping` that promotes Strapi `shared.hero` and
  `marketing.pricing-table` components to `marketing:hero` and
  `marketing:pricing-table`. Exercises PRD-205-R10, R11, R15, R20, R26, R28.

The fixtures are deliberately minimal: each captures the API shape under
test, not a production-sized corpus. Negative scenarios (auth failure,
schema invalid, `populate=*` rejected, depth>4, dynamicZoneMax invalid,
content-type 404, token-in-log, token-in-envelope, webhook signature
invalid) are exercised inline in `src/strapi.test.ts` since they
short-circuit before any fixture-shaped output exists.
