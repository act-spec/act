/**
 * PRD-300-R26 / R27 — `contract_version` parsing + tolerance gate.
 *
 * Per PRD-108-R7, MINOR mismatches within the same MAJOR are tolerated;
 * MAJOR mismatches above the binding's supported MAJOR are fast-rejected.
 * The grammar is `^[0-9]+\.[0-9]+$`.
 */
import { BuildError } from './errors.js';

const VERSION_RE = /^([0-9]+)\.([0-9]+)$/;

export interface ParsedVersion {
  major: number;
  minor: number;
}

/** PRD-300-R26 — parser. Returns null on malformed input. */
export function parseContractVersion(v: string): ParsedVersion | null {
  const m = VERSION_RE.exec(v);
  if (m === null) return null;
  // Match groups for `^([0-9]+)\.([0-9]+)$` are guaranteed when the regex matches.
  const majorStr = m[1] as string;
  const minorStr = m[2] as string;
  const major = Number.parseInt(majorStr, 10);
  const minor = Number.parseInt(minorStr, 10);
  return { major, minor };
}

/**
 * PRD-300-R26 / R27 — gate. Throws `BuildError("PRD-300-R27")` when the
 * contract's MAJOR exceeds the binding's. MINOR mismatches are silent
 * (per PRD-108-R7 forward compat). Malformed contract_version throws
 * `BuildError("PRD-300-R27")` since the contract surface is broken.
 */
export function gateContractVersion(
  contractVersion: string,
  bindingVersion: string,
): void {
  const c = parseContractVersion(contractVersion);
  const b = parseContractVersion(bindingVersion);
  if (c === null) {
    throw new BuildError(
      'PRD-300-R27',
      `contract_version "${contractVersion}" violates ^[0-9]+\\.[0-9]+$ (PRD-300-R26)`,
    );
  }
  if (b === null) {
    throw new BuildError(
      'PRD-300-R27',
      `binding contractVersion "${bindingVersion}" malformed`,
    );
  }
  if (c.major > b.major) {
    throw new BuildError(
      'PRD-300-R27',
      `contract_version ${contractVersion} exceeds binding's supported MAJOR ${String(b.major)}`,
    );
  }
}
