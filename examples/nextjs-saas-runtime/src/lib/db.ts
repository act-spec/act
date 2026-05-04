/**
 * In-memory database sketch for the PRD-705 example.
 *
 * Real deployments substitute their own persistence layer; the example only
 * needs a tiny multi-tenant fixture with two tenants and two principals so
 * the two-principal probe has something to attack.
 *
 * Schema sketch (per PRD-705 implementation notes §"Database schema sketch"):
 *
 *   users      (id, tenant_id)
 *   sessions   (cookie -> user_id)        — sketch NextAuth-style store
 *   tokens     (bearer -> user_id)        — sketch service-identity store
 *   documents  (id, tenant_id, title, summary, body)
 *
 * Index `(tenant_id, id)` is implicit (Map keyed by id; queries filter by
 * tenant). Tenancy moves are NEW IDs per PRD-705-R4 / PRD-106-R16.
 */

export interface User {
  readonly id: string;
  readonly tenantId: string;
}

export interface Document {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
}

const users: User[] = [
  { id: 'user-A', tenantId: 'tenant-acme' },
  { id: 'user-B', tenantId: 'tenant-beta' },
];

const sessions: Record<string, string> = {
  // Sketch: cookie value → stable user id (PRD-705-R6).
  'session-cookie-A': 'user-A',
  'session-cookie-B': 'user-B',
};

const bearers: Record<string, string> = {
  // Sketch: bearer token → stable user id (PRD-705-R6 service-identity path).
  'bearer-token-A': 'user-A',
  'bearer-token-B': 'user-B',
};

const documents: Document[] = [
  // tenant-acme — visible only to user-A.
  {
    id: 'doc/acme-roadmap-2026',
    tenantId: 'tenant-acme',
    title: 'Acme 2026 Roadmap',
    summary: 'Quarterly roadmap; private to Acme workspace.',
    body: 'Q1: ship the foundation. Q2: launch the runtime profile. Q3: deepen integrations. Q4: rest.',
  },
  {
    id: 'doc/acme-onboarding',
    tenantId: 'tenant-acme',
    title: 'Acme Onboarding Guide',
    summary: 'How new Acme employees get set up.',
    body: 'Step 1: pick a laptop. Step 2: read the handbook. Step 3: ship something small.',
  },
  // tenant-beta — visible only to user-B.
  {
    id: 'doc/beta-launch-plan',
    tenantId: 'tenant-beta',
    title: 'Beta Launch Plan',
    summary: 'Cross-functional launch coordination.',
    body: 'Marketing handoff: Tuesday. Press blast: Wednesday. Investor call: Thursday.',
  },
  {
    id: 'doc/beta-customer-list',
    tenantId: 'tenant-beta',
    title: 'Beta Customer List',
    summary: 'Top accounts by ARR.',
    body: 'Confidential. See CRM for live numbers. Updated weekly.',
  },
];

export const db = {
  users: {
    findById(id: string): User | undefined {
      return users.find((u) => u.id === id);
    },
  },
  sessions: {
    /** Validate a session cookie and return the principal's stable user id. */
    findUserIdByCookie(cookie: string): string | undefined {
      return sessions[cookie];
    },
  },
  bearers: {
    /** Validate a bearer token and return the principal's stable user id. */
    findUserIdByToken(token: string): string | undefined {
      return bearers[token];
    },
  },
  documents: {
    /** PRD-705-R8 — every query filters by tenantId. */
    findByIdScoped(id: string, tenantId: string): Document | undefined {
      return documents.find((d) => d.id === id && d.tenantId === tenantId);
    },
    /** PRD-705-R8 — index queries also filter. */
    listByTenant(tenantId: string): readonly Document[] {
      return documents.filter((d) => d.tenantId === tenantId);
    },
  },
};

/** Test-only export: principal/tenant fixture for the probe harness. */
export const PROBE_FIXTURE = {
  principalA: { userId: 'user-A', tenantId: 'tenant-acme', cookie: 'session-cookie-A', bearer: 'bearer-token-A' },
  principalB: { userId: 'user-B', tenantId: 'tenant-beta', cookie: 'session-cookie-B', bearer: 'bearer-token-B' },
} as const;
