// PRD-700-R5 — Astro Content Collection schema for the docs corpus.
//
// The schema is enforced by Astro's content collections at build time. The
// `@act-spec/adapter-markdown` consumes the same frontmatter keys (`title`,
// `summary`, `type`, `parent`, `related`) per PRD-201-R4; Astro's collection
// schema is the structural enforcement layer on the source side.
//
// Note: in this example the ACT artifact set is derived from the same
// markdown files via `@act-spec/adapter-markdown`'s file-walk in
// `astro.config.mjs`, NOT from the content collection runtime. The
// collection schema exists (a) to satisfy PRD-700-R5 and (b) to give a
// human-facing Astro page the typed content it needs.
import { defineCollection, z } from 'astro:content';

const docs = defineCollection({
  type: 'content',
  schema: z.object({
    id: z.string().optional(),
    title: z.string().min(1),
    summary: z.string().min(1).max(280),
    type: z.enum(['index', 'tutorial', 'concept', 'reference']).optional(),
    parent: z.string().optional(),
    related: z.array(z.string()).optional(),
    children: z.array(z.string()).optional(),
  }),
});

export const collections = { docs };
