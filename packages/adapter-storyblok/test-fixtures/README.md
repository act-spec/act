# Test fixtures — `@act-spec/adapter-storyblok`

Recorded Storyblok delivery-API responses, used by the unit + integration test
suite and the conformance gate to exercise PRD-204 end-to-end without live
Storyblok API calls (per the role's "no live Storyblok API calls in tests"
constraint).

Each subdirectory groups one positive scenario:

- `standard-emission/` — single-locale Standard build; rich text covering
  paragraph, heading, code, blockquote → callout, with marks; story-link
  reference resolved to `related[]`; default field heuristics. Exercises
  PRD-204-R3, R4, R6, R7, R8, R11, R17, R18, R20, R25, R27.
- `plus-emission/` — Plus build with folder-pattern translations + a
  `componentMapping` that promotes Storyblok `hero` and `feature-grid`
  bloks to `marketing:hero` and `marketing:feature-grid`. Exercises
  PRD-204-R10, R14, R17, R19, R25, R27.

The fixtures are deliberately minimal: each captures the API shape under
test, not a production-sized corpus. Negative scenarios (auth failure,
schema invalid, unmapped richtext type, depth>5, recursionMax invalid,
token-in-log, token-in-envelope, webhook signature invalid) are
exercised inline in `src/storyblok.test.ts` since they short-circuit
before any fixture-shaped output exists.
