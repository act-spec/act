/**
 * PRD-705-R6 — `IdentityResolver` for the SaaS workspace example.
 *
 * Tries cookie first (the primary user-facing path); falls back to bearer
 * (the service-identity path used by the validator's runtime-walk mode per
 * PRD-600-R32 / PRD-705-R18).
 *
 * `Identity.key` is the principal's stable database `user.id` per
 * PRD-705-R6 / PRD-501-R6 / PRD-500-R6 / PRD-109-R11. NEVER the cookie
 * value or the bearer token (the negative fixture
 * `fixtures/705/negative/identity-key-leaks-cookie.json` proves a faulty
 * implementation rotates ETags on every session refresh).
 */
import type { ActRequest, IdentityResolver } from '@act-spec/runtime-core';

import { validateBearer, validateSession } from '../auth';

export const identityResolver: IdentityResolver = async (req: ActRequest) => {
  // 1. Cookie path (primary).
  const cookie = req.getCookie('session');
  if (typeof cookie === 'string' && cookie.length > 0) {
    const session = validateSession(cookie);
    if (!session) return { kind: 'auth_required', reason: 'invalid' };
    return { kind: 'principal', key: session.userId };
  }

  // 2. Bearer path (service identity / probe).
  const auth = req.headers.get('authorization') ?? '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearerMatch && typeof bearerMatch[1] === 'string') {
    const session = validateBearer(bearerMatch[1]);
    if (!session) return { kind: 'auth_required', reason: 'invalid' };
    return { kind: 'principal', key: session.userId };
  }

  // 3. No credentials at all → anonymous. The dispatch pipeline does NOT
  // short-circuit on anonymous (it short-circuits only on `auth_required`),
  // so the resolver gets invoked and the PRD-705-R12 public-landing branch
  // can return 200 unauthenticated. Every other endpoint's resolver
  // explicitly returns `{ kind: 'auth_required' }` for anonymous callers,
  // which maps to 401 with the manifest-derived WWW-Authenticate set per
  // PRD-705-R9.
  return { kind: 'anonymous' };
};
