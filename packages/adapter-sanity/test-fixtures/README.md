# Test fixtures — `@act-spec/adapter-sanity`

Recorded Sanity GROQ-shaped responses, used by the unit + integration test
suite and the conformance gate to exercise PRD-203 end-to-end without live
Sanity API calls (per the role's "no live Sanity API calls in tests"
constraint).

Each subdirectory groups one positive scenario:

- `standard-emission/` — single-locale Standard build; portable text covering
  paragraph, heading, code, callout; references resolved to `related[]`;
  default field heuristics. Exercises PRD-203-R3, R4, R6, R7, R8, R10,
  R16, R17, R22, R25, R27.
- `plus-emission/` — Plus build with document-level translations + a
  `componentMapping` that promotes Sanity `heroBlock` to `marketing:hero`.
  Exercises PRD-203-R9, R13, R18, R22, R25, R27.

The fixtures are deliberately minimal: each captures the API shape under
test, not a production-sized corpus. Negative scenarios (auth failure,
schema invalid, unmapped portable-text type, depth>5, token-in-log,
token-in-envelope) are exercised inline in `src/sanity.test.ts` since they
short-circuit before any fixture-shaped output exists.
