/**
 * PRD-409-R10 — parse a `--timeout` duration string (`5m`, `30s`, `1h`,
 * or a bare integer interpreted as milliseconds).
 *
 * Throws on malformed input so the CLI surfaces a usage error.
 */
export function parseDuration(input: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(input.trim());
  if (m === null) {
    throw new Error(`PRD-409-R10: invalid duration "${input}" (expected e.g. 5m, 30s, 1h)`);
  }
  const value = Number.parseFloat(m[1] ?? '0');
  const unit = m[2] ?? 'ms';
  switch (unit) {
    case 'ms':
      return Math.floor(value);
    case 's':
      return Math.floor(value * 1000);
    case 'm':
      return Math.floor(value * 60_000);
    case 'h':
      return Math.floor(value * 3_600_000);
    default:
      // Unreachable — regex restricts unit to the four cases.
      /* v8 ignore next 2 */
      throw new Error(`PRD-409-R10: invalid duration unit "${unit}"`);
  }
}
