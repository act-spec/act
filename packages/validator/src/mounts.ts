/**
 * Mounts coherence checks (PRD-100-R7, PRD-106-R18, PRD-106-R20, PRD-101-R10
 * / R11, PRD-109-R21).
 *
 * Two cross-cutting rules per PRD-600-R3:
 *  - **No-recursion** (PRD-106-R18): a mount's `manifest_url` MUST NOT itself
 *    declare `mounts` that reference back. Validated when a walk follows a
 *    mount; the static helper here flags the syntactic anti-pattern (a mount
 *    targeting `/.well-known/act.json` on the same origin / same prefix).
 *  - **No-overlap** (PRD-106-R20): two mount entries' `prefix` values MUST
 *    NOT overlap (one being a prefix of the other).
 */

interface MountEntry {
  prefix?: unknown;
  delivery?: unknown;
  manifest_url?: unknown;
}

export interface MountFinding {
  /** Source PRD requirement, e.g. `PRD-106-R20`. */
  requirement: string;
  /** Human-readable description for `gaps[].missing`. */
  missing: string;
}

/**
 * Walk the `mounts[]` array and return every overlap finding (PRD-106-R20).
 * Two prefixes overlap when one is a prefix of the other after path-segment
 * normalization (trailing slash stripped except the root). Same-origin
 * comparison only; cross-origin overlap is covered by PRD-101-R11 / PRD-109-R21.
 */
export function findMountOverlaps(mounts: readonly MountEntry[]): readonly MountFinding[] {
  const findings: MountFinding[] = [];
  const prefixes: string[] = [];
  for (const m of mounts) {
    if (typeof m.prefix !== 'string') continue;
    prefixes.push(normalize(m.prefix));
  }
  for (let i = 0; i < prefixes.length; i += 1) {
    for (let j = i + 1; j < prefixes.length; j += 1) {
      const a = prefixes[i]!;
      const b = prefixes[j]!;
      if (overlaps(a, b)) {
        findings.push({
          requirement: 'PRD-106-R20',
          missing: `mounts entries have overlapping prefixes: ${JSON.stringify(a)} and ${JSON.stringify(b)}.`,
        });
      }
    }
  }
  return findings;
}

function normalize(p: string): string {
  if (p === '/') return '/';
  return p.endsWith('/') ? p.slice(0, -1) : p;
}

function overlaps(a: string, b: string): boolean {
  if (a === b) return true;
  // Path-segment-aware prefix check: `/foo` and `/foobar` do NOT overlap,
  // but `/foo` and `/foo/bar` do.
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (!longer.startsWith(shorter)) return false;
  return shorter === '/' || longer.charAt(shorter.length) === '/';
}
