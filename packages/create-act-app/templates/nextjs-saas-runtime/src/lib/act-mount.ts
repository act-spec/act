// `defineActMount` wires the runtime SDK against the example's identity /
// tenant resolvers and content runtime. The returned handlers
// (`manifest`, `index`, `node`, `subtree`) are App Router-shape — a real
// Next.js deployment maps each to a route.ts file (see `src/app/`).
//
// In the absence of Next.js, the same handlers can be invoked directly
// over a WHATWG `Request` — that's how the probe and validator scripts
// dispatch in-process.
import { defineActMount } from '@act-spec/runtime-next/mount';

import { identityResolver } from './act-host/identity';
import { tenantResolver } from './act-host/tenant';
import { logger } from './act-host/logger';
import { runtime, MANIFEST } from './act-runtime/index';

export const actMount = defineActMount({
  manifest: MANIFEST,
  runtime,
  identityResolver,
  tenantResolver,
  logger,
  basePath: '',
});
