/**
 * PRD-706-R6 (inherits PRD-705-R6) — IdentityResolver for the app mount.
 *
 * Cookie path first; bearer fallback for the validator's runtime-walk and
 * the MCP bridge's IdentityBridge. `Identity.key` is the stable database
 * user.id; never the cookie value or bearer token.
 */
import type { ActRequest, IdentityResolver } from '@act-spec/runtime-core';

import { validateBearer, validateSession } from '../auth.js';

export const identityResolver: IdentityResolver = async (req: ActRequest) => {
  const cookie = req.getCookie('session');
  if (typeof cookie === 'string' && cookie.length > 0) {
    const session = validateSession(cookie);
    if (!session) return { kind: 'auth_required', reason: 'invalid' };
    return { kind: 'principal', key: session.userId };
  }

  const auth = req.headers.get('authorization') ?? '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearerMatch && typeof bearerMatch[1] === 'string') {
    const session = validateBearer(bearerMatch[1]);
    if (!session) return { kind: 'auth_required', reason: 'invalid' };
    return { kind: 'principal', key: session.userId };
  }

  return { kind: 'anonymous' };
};
