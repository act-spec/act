/**
 * Sketch session validator. Real deployments substitute NextAuth, Clerk, or
 * their own auth. Returns the principal's stable database `user.id`
 * (PRD-705-R6 — `Identity.key` MUST be the stable id, NOT the cookie value).
 */
import { db } from './db';

export interface ValidatedSession {
  /** Stable principal id — used as `Identity.key`. */
  readonly userId: string;
}

/** Validate a session cookie value. */
export function validateSession(cookie: string): ValidatedSession | null {
  const userId = db.sessions.findUserIdByCookie(cookie);
  return userId ? { userId } : null;
}

/** Validate a bearer token. PRD-705-R6 service-identity path. */
export function validateBearer(token: string): ValidatedSession | null {
  const userId = db.bearers.findUserIdByToken(token);
  return userId ? { userId } : null;
}
