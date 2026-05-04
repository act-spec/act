/**
 * PRD-705-R8 — `TenantResolver` for the SaaS workspace example.
 *
 * For authenticated principals, look up the principal's tenancy in the
 * database and return `{ kind: "scoped", key: tenantId }`. For anonymous
 * callers (unauthenticated requests allowed only for the public landing
 * node per PRD-705-R12), return `{ kind: "single" }` per PRD-500-R7's
 * anonymous default.
 *
 * Every `resolveIndex`, `resolveNode`, `resolveSubtree` query MUST filter
 * by `tenantId = ctx.tenant.kind === "scoped" ? ctx.tenant.key : null`.
 * Forgetting the filter is the catastrophic-impact risk in PRD-705-R8;
 * PRD-705-R20 (the security-test acceptance criterion) is the gate that
 * proves the filter is in place.
 */
import type { TenantResolver } from '@act-spec/runtime-core';

import { db } from '../db';

export const tenantResolver: TenantResolver = async (_req, identity) => {
  if (identity.kind !== 'principal') return { kind: 'single' };
  const user = db.users.findById(identity.key);
  if (!user) return { kind: 'single' };
  return { kind: 'scoped', key: user.tenantId };
};
