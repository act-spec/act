/**
 * PRD-204-R11 / R12 / R13 — story-link resolution with depth bound + cycle
 * tolerance. Storyblok `{ linktype: "story", id, slug, uuid }` link → ACT
 * `related[]` entry per PRD-102-R18.
 *
 * Depth ≥0 and ≤5 (R12). 0 = no resolution; 1 = immediate refs only.
 * URL-link fields (`linktype: "url"`) MUST NOT produce `related[]` entries
 * per PRD-204-R11.
 */
import type { StoryblokAdapterConfig, StoryblokLink, StoryblokStory } from './types.js';

export interface StoryLookup {
  /** Look up a referenced story by uuid. Undefined when not in corpus. */
  getStoryByUuid(uuid: string): StoryblokStory | undefined;
}

export interface StoryReferenceResult {
  related: Array<{ id: string; relation: string }>;
  cycles: number;
}

/**
 * Resolve every story-link field configured under `fieldMapping.related`.
 * Returns related ACT IDs (resolved via `idResolver`) plus a cycle count.
 */
export function resolveStoryLinks(
  story: StoryblokStory,
  config: StoryblokAdapterConfig,
  lookup: StoryLookup,
  idResolver: (target: StoryblokStory) => string,
): StoryReferenceResult {
  const out: Array<{ id: string; relation: string }> = [];
  const fields = config.fieldMapping?.related ?? {};
  const depth = clampDepth(config.linkResolutionDepth ?? 1);
  if (depth === 0) return { related: out, cycles: 0 };

  const seen = new Set<string>([story.uuid]);
  let cycles = 0;

  for (const [fieldName, relation] of Object.entries(fields)) {
    const value = (story.content as Record<string, unknown>)[fieldName];
    const links = collectStoryLinks(value);
    for (const link of links) {
      const targetUuid = link.uuid ?? link.story?.uuid;
      if (typeof targetUuid !== 'string') continue;
      if (seen.has(targetUuid)) {
        cycles += 1;
        continue;
      }
      seen.add(targetUuid);
      const target = lookup.getStoryByUuid(targetUuid);
      if (!target) continue;
      const actId = idResolver(target);
      out.push({ id: actId, relation });
      if (depth > 1) {
        const inner = resolveStoryLinksInner(target, config, lookup, idResolver, seen, depth - 1);
        for (const e of inner.related) out.push(e);
        cycles += inner.cycles;
      }
    }
  }
  return { related: out, cycles };
}

function resolveStoryLinksInner(
  story: StoryblokStory,
  config: StoryblokAdapterConfig,
  lookup: StoryLookup,
  idResolver: (target: StoryblokStory) => string,
  seen: Set<string>,
  depth: number,
): StoryReferenceResult {
  const out: Array<{ id: string; relation: string }> = [];
  let cycles = 0;
  const fields = config.fieldMapping?.related ?? {};
  for (const [fieldName, relation] of Object.entries(fields)) {
    const value = (story.content as Record<string, unknown>)[fieldName];
    const links = collectStoryLinks(value);
    for (const link of links) {
      const targetUuid = link.uuid ?? link.story?.uuid;
      if (typeof targetUuid !== 'string') continue;
      if (seen.has(targetUuid)) {
        cycles += 1;
        continue;
      }
      seen.add(targetUuid);
      const target = lookup.getStoryByUuid(targetUuid);
      if (!target) continue;
      out.push({ id: idResolver(target), relation });
      if (depth > 1) {
        const inner = resolveStoryLinksInner(target, config, lookup, idResolver, seen, depth - 1);
        for (const e of inner.related) out.push(e);
        cycles += inner.cycles;
      }
    }
  }
  return { related: out, cycles };
}

/** Clamp / validate depth — PRD-204-R12. */
export function clampDepth(d: number): number {
  if (!Number.isInteger(d)) return 1;
  if (d < 0) return 0;
  if (d > 5) return 5;
  return d;
}

/**
 * Collect Storyblok story-link entries from a value. Accepts:
 *  - a single link object ({ linktype: "story", uuid, ... });
 *  - an array of links;
 *  - a "multilink" wrapper ({ linktype, story, ... });
 *  - URL/asset/email links — silently skipped (PRD-204-R11).
 */
function collectStoryLinks(v: unknown): StoryblokLink[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.flatMap((x) => collectStoryLinks(x));
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['linktype'] === 'string') {
      if (o['linktype'] === 'story') return [o as unknown as StoryblokLink];
      // url / asset / email links → not story refs.
      return [];
    }
    // Bare uuid / id object — treat as a story reference.
    if (typeof o['uuid'] === 'string') {
      return [{ linktype: 'story', uuid: o['uuid'] }];
    }
  }
  return [];
}
