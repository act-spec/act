// Starlight content collection wiring (Astro 4 / legacy
// content-collections style).
//
// `docsSchema()` is Starlight's canonical schema factory; we extend it
// with a handful of optional ACT-aware frontmatter keys (`summary`,
// `type`, `parent`, `related`, `children`) so the same markdown files
// drive both Starlight's renderer AND the ACT adapter's tree
// extraction.
import { defineCollection, z } from 'astro:content';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    type: 'content',
    schema: docsSchema({
      extend: z.object({
        summary: z.string().min(1).max(280).optional(),
        type: z.enum(['index', 'tutorial', 'concept', 'reference']).optional(),
        parent: z.string().optional(),
        related: z.array(z.string()).optional(),
        children: z.array(z.string()).optional(),
      }),
    }),
  }),
};
