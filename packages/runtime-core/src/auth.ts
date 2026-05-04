/**
 * PRD-500-R14 auth challenge helper.
 *
 * `buildAuthChallenges(manifest)` returns one `WWW-Authenticate` header
 * value per advertised scheme in `auth.schemes` order, per PRD-106-R8 +
 * PRD-109-R5. The set is a function of the **manifest**, never of the
 * request URL — leaking different challenge sets per URL is a documented
 * negative fixture (`fixtures/500/negative/401-www-authenticate-varies-by-url.json`).
 */
import type { Manifest } from './types.js';

/**
 * PRD-500-R14 — build challenge strings for `WWW-Authenticate`.
 *
 * For an ordered `auth.schemes` array, returns one string per scheme:
 *  - `"cookie"`  → `Cookie realm="<site.name>"`
 *  - `"bearer"`  → `Bearer realm="<site.name>"`
 *  - `"oauth2"`  → `Bearer realm="<site.name>", error="invalid_token", scope="<scopes>", authorization_uri="<url>"`
 *  - `"api_key"` → `Bearer realm="<site.name>"` (PRD-106-R10 default)
 *
 * Returns `[]` when the manifest declares no `auth` block (anonymous public
 * access permitted per PRD-106-R11) — a 401 in that case is a misuse and
 * leaf SDKs MAY assert it never happens.
 */
export function buildAuthChallenges(manifest: Manifest): string[] {
  const auth = manifest.auth as
    | {
        schemes?: ReadonlyArray<'cookie' | 'bearer' | 'oauth2' | 'api_key'>;
        oauth2?: {
          authorization_endpoint: string;
          token_endpoint: string;
          scopes_supported: ReadonlyArray<string>;
        };
        api_key?: { header?: string; format?: 'bearer' | 'raw' };
      }
    | undefined;
  if (!auth || !auth.schemes || auth.schemes.length === 0) return [];

  const realm = manifest.site.name;
  const out: string[] = [];
  for (const scheme of auth.schemes) {
    switch (scheme) {
      case 'cookie':
        out.push(`Cookie realm="${realm}"`);
        break;
      case 'bearer':
        out.push(`Bearer realm="${realm}"`);
        break;
      case 'oauth2': {
        const o = auth.oauth2;
        if (!o) {
          // Construction-time validation (PRD-500-R10) should have caught
          // this; defensive guard keeps the helper total and predictable.
          out.push(`Bearer realm="${realm}", error="invalid_token"`);
          break;
        }
        const scopeStr = o.scopes_supported.join(' ');
        out.push(
          `Bearer realm="${realm}", error="invalid_token", scope="${scopeStr}", authorization_uri="${o.authorization_endpoint}"`,
        );
        break;
      }
      case 'api_key':
        // PRD-106-R10 default — `Authorization: Bearer <key>`.
        out.push(`Bearer realm="${realm}"`);
        break;
    }
  }
  return out;
}
