/**
 * Tiny built-in prompt helpers. The runbook permits picking up a real
 * prompts library (`prompts` or `@inquirer/prompts`) but also says "avoid
 * heavy deps" — so we ship a minimal readline-based pair of helpers
 * sufficient for our two questions:
 *
 *   1. Which template? (numbered list)
 *   2. Project name? (free-form, validates non-empty)
 *
 * If we ever outgrow this we can swap in `prompts` without changing the
 * call-sites.
 */
import * as readline from 'node:readline/promises';

import type { Sink, TemplateManifestEntry } from './types.js';

/** Read a line from stdin, returning the trimmed value. */
async function readLine(promptText: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(promptText);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export async function promptForTemplate(
  templates: readonly TemplateManifestEntry[],
  sink: Sink,
): Promise<TemplateManifestEntry> {
  if (templates.length === 0) {
    throw new Error('create-act-app: no templates available');
  }
  sink.stdout('Pick a template:\n');
  templates.forEach((t, i) => {
    const desc = t.description ? ` — ${t.description}` : '';
    sink.stdout(`  ${String(i + 1).padStart(2)}) ${t.name}${desc}\n`);
  });

  // Loop until the user picks a valid index.
  // (Up to 5 attempts; bails to template[0] if all fail, matches create-vite's spirit.)
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = await readLine(`Template (1-${templates.length}, default 1): `);
    if (raw === '') {
      const first = templates[0];
      if (!first) throw new Error('create-act-app: empty template list');
      return first;
    }
    const idx = Number.parseInt(raw, 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= templates.length) {
      const picked = templates[idx - 1];
      if (picked) return picked;
    }
    // Allow typing the name verbatim too.
    const byName = templates.find((t) => t.name === raw);
    if (byName) return byName;
    sink.stderr(`  invalid choice: ${raw}\n`);
  }
  const fallback = templates[0];
  if (!fallback) throw new Error('create-act-app: empty template list');
  return fallback;
}

export async function promptForProjectName(
  defaultName: string,
  _sink: Sink,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = await readLine(`Project name (default ${defaultName}): `);
    const candidate = raw === '' ? defaultName : raw;
    if (isValidProjectName(candidate)) return candidate;
    process.stderr.write(`  invalid project name: ${candidate}\n`);
  }
  return defaultName;
}

/**
 * Loose validation aligned with npm package-name rules: lowercase, alnum,
 * `-`, `_`, `.`, may be scoped (`@scope/name`). Empty is rejected.
 *
 * (Full npm-name validation is gnarly; this catches the obvious foot-guns
 * — slashes other than scope separator, leading dots, whitespace.)
 */
export function isValidProjectName(name: string): boolean {
  if (name.length === 0) return false;
  if (name.length > 214) return false;
  if (/\s/.test(name)) return false;
  // Allow scoped names: @scope/name
  const scoped = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u;
  const plain = /^[a-z0-9][a-z0-9._-]*$/u;
  return scoped.test(name) || plain.test(name);
}
