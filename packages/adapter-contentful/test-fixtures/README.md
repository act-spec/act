# Test fixtures — `@act-spec/adapter-contentful`

Recorded Contentful Delivery API and Sync API responses, used by the
unit + integration test suite and the conformance gate to exercise
PRD-202 end-to-end without live API calls (per the role's "no live CDA"
constraint).

Each subdirectory groups one positive scenario:

- `standard-blog-post/` — single-locale Standard build; Rich Text covering
  paragraph, heading, list, blockquote, hr; tag metadata; default field
  heuristics. Exercises PRD-202-R3, R5, R7, R10, R15, R20, R21.
- `plus-multi-locale/` — three-locale Plus build with one fully-translated
  entry and one en-US-only entry (the fallback path). Exercises
  PRD-202-R12, R14, R20, R21.
- `plus-marketing-hero/` — Plus build with a `landingPage` entry whose
  `type=hero` field triggers a user-supplied `marketing:hero` mapping;
  Rich Text body has an embedded-asset-block that renders as
  `marketing:image`. Exercises PRD-202-R8, R10, R11, R21.
- `sync-delta/` — Contentful Sync API responses (initial + delta). Exercises
  PRD-202-R16.

The fixtures are deliberately minimal: each captures the API shape under
test, not a production-sized corpus. Negative scenarios (auth failure,
schema invalid, reserved metadata key, locale not in space) are exercised
inline in `src/contentful.test.ts` since they short-circuit before any
fixture-shaped output exists.
