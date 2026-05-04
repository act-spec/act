/**
 * PRD-706-R6 (inherits PRD-705-R8) — TenantResolver for the app mount.
 *
 * Authenticated principals get `{ scoped, tenantId }`. Anonymous callers
 * receive `{ single }` so the dispatch pipeline can still serve the
 * (optional) public-landing branch per PRD-705-R12 — though PRD-706-R6
 * notes the public branch may be dropped on the app mount because the
 * marketing mount covers the unauthenticated public surface. We retain
 * it for symmetry with PRD-705 (the canonical PRD-706-R6 shape).
 */
import type { TenantResolver } from '@act-spec/runtime-core';

import { db } from '../db.js';

export const tenantResolver: TenantResolver = async (_req, identity) => {
  if (identity.kind !== 'principal') return { kind: 'single' };
  const user = db.users.findById(identity.key);
  if (!user) return { kind: 'single' };
  return { kind: 'scoped', key: user.tenantId };
};
