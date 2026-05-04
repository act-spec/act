# Test fixtures — `@act-spec/adapter-builder`

Recorded Builder.io v3 Content API responses, used by the unit + integration
test suite and the conformance gate to exercise PRD-206 end-to-end without
live Builder.io API calls (per the role's "no live Builder.io API calls"
constraint).

Each subdirectory groups one positive scenario:

- `extraction-standard/` — Two `page` model entries; one with a Text +
  Image + CustomCode component tree and a `references` array pointing at the
  second page; second page is the reference target. Exercises
  PRD-206-R1, R2, R5, R7, R8, R9, R14, R21.
- `extraction-plus/` — Plus build with locale fan-out (`en` + `de`) AND
  `componentMapping` that promotes Builder `Hero` and `PricingTable`
  components to `marketing:hero` and `marketing:pricing-table`. Exercises
  PRD-206-R11, R13, R17, R22.
- `passthrough-plus/` — Plus build with `mode: "pass-through"`. Single
  page emitted as one `marketing:builder-page` block carrying the raw
  Builder `data` as `payload`. Exercises PRD-206-R10, R11, R22.

The fixtures are deliberately minimal: each captures the API shape under
test, not a production-sized corpus. Negative scenarios (missing apiKey,
private key detected, auth failure, model 404, referenceDepth > 3,
symbolRecursionMax > 3, mode invalid, empty filter without `allowEmpty`,
unmapped components, Symbol recursion exceeded, rate-limit exhausted,
key-in-log, key-in-envelope, webhook signature invalid) are exercised
inline in `src/builder.test.ts` since they short-circuit before any
fixture-shaped output exists.
