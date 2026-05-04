/**
 * In-memory database sketch for the PRD-706 runtime app mount.
 *
 * Mirrors the PRD-705 pattern: two principals, two tenants, one private
 * document per tenant. The two-principal probe runs against this fixture
 * to verify cross-tenant 404 byte-equivalence + per-tenant ETag scoping
 * per PRD-705-R10 / R17 / R20 (inherited via PRD-706-R6 / R10).
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
  'session-cookie-A': 'user-A',
  'session-cookie-B': 'user-B',
};

const bearers: Record<string, string> = {
  'bearer-token-A': 'user-A',
  'bearer-token-B': 'user-B',
};

const documents: Document[] = [
  {
    id: 'doc/acme-roadmap-2026',
    tenantId: 'tenant-acme',
    title: 'Acme 2026 Roadmap',
    summary: 'Quarterly roadmap; private to Acme workspace.',
    body: 'Q1: ship the runtime mount. Q2: open PRD-706 to partners.',
  },
  {
    id: 'doc/beta-launch-plan',
    tenantId: 'tenant-beta',
    title: 'Beta Launch Plan',
    summary: 'Cross-functional launch coordination.',
    body: 'Press blast Wednesday. Investor call Thursday.',
  },
];

export const db = {
  users: {
    findById(id: string): User | undefined {
      return users.find((u) => u.id === id);
    },
  },
  sessions: {
    findUserIdByCookie(cookie: string): string | undefined {
      return sessions[cookie];
    },
  },
  bearers: {
    findUserIdByToken(token: string): string | undefined {
      return bearers[token];
    },
  },
  documents: {
    findByIdScoped(id: string, tenantId: string): Document | undefined {
      return documents.find((d) => d.id === id && d.tenantId === tenantId);
    },
    listByTenant(tenantId: string): readonly Document[] {
      return documents.filter((d) => d.tenantId === tenantId);
    },
  },
};

export const PROBE_FIXTURE = {
  principalA: { userId: 'user-A', tenantId: 'tenant-acme', cookie: 'session-cookie-A', bearer: 'bearer-token-A' },
  principalB: { userId: 'user-B', tenantId: 'tenant-beta', cookie: 'session-cookie-B', bearer: 'bearer-token-B' },
} as const;
