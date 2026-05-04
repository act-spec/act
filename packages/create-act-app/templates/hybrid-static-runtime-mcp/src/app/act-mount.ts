/**
 * PRD-706-R6 — `defineActMount` for the runtime app mount.
 *
 * `basePath: "/app"` (PRD-501-R8). The SDK installs the canonical App
 * Router file layout under that base; the example bridges the
 * App Router-style mount to a plain Node HTTP server in `src/app/server.ts`
 * (the SDK is framework-agnostic at the Request/Response boundary).
 */
import { defineActMount } from '@act-spec/runtime-next';

import { identityResolver } from '../lib/act-host/identity.js';
import { tenantResolver } from '../lib/act-host/tenant.js';
import { logger } from '../lib/act-host/logger.js';
import { runtime, APP_MANIFEST } from '../lib/act-runtime/index.js';

export const actMount = defineActMount({
  manifest: APP_MANIFEST,
  runtime,
  identityResolver,
  tenantResolver,
  logger,
  basePath: '/app', // PRD-501-R8 / PRD-706-R6
});
