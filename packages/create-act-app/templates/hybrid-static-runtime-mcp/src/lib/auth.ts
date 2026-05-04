/**
 * Sketch session validator for the PRD-706 runtime app mount. Inherits the
 * PRD-705 pattern: cookie + bearer schemes; `Identity.key` is the stable
 * `user.id` (PRD-705-R6 / PRD-501-R6 / PRD-109-R11).
 */
import { db } from './db.js';

export interface ValidatedSession {
  readonly userId: string;
}

export function validateSession(cookie: string): ValidatedSession | null {
  const userId = db.sessions.findUserIdByCookie(cookie);
  return userId ? { userId } : null;
}

export function validateBearer(token: string): ValidatedSession | null {
  const userId = db.bearers.findUserIdByToken(token);
  return userId ? { userId } : null;
}
