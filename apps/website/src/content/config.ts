// Content collections for the ACT homepage.
//
// Starlight ships its own `docs` collection schema; we extend it with
// the optional fields ACT's own markdown adapter consumes (`summary`,
// `type`, `parent`, `related`) so the same source files can drive both
// the rendered Starlight pages and the ACT artifact set emitted by
// `@act-spec/plugin-astro`.
import { defineCollection, z } from 'astro:content';
import { docsSchema } from '@astrojs/starlight/schema';

const docs = defineCollection({
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
});

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1).max(280),
    pubDate: z.coerce.date(),
    author: z.string().default('Jeremy Forsythe'),
    draft: z.boolean().default(false),
  }),
});

export const collections = { docs, blog };
