/**
 * PRD-701-R3 / R5 / R7 — corpus generator.
 *
 * Authors a Docusaurus 3.x docs corpus matching PRD-701's normative
 * envelope: between 200 and 500 ACT nodes after PRD-201 / PRD-404 emission,
 * with a 4-level category hierarchy declared by `sidebars.js`.
 *
 * The corpus is regenerated each run so the markdown content stays a
 * deterministic function of this script (per the PRD's "regeneratable" note).
 * The hand-authored top of the tree (PRD-701-R5: intro / getting-started /
 * concepts / api / recipes / troubleshooting / changelog) is fixed; the
 * `recipes/` and `troubleshooting/` branches are expanded procedurally to
 * hit the corpus envelope.
 *
 * One recipes page (`recipes/lifecycle-policy.md`) embeds a fenced
 * `data` block per PRD-701-R7 / PRD-201-R13 / PRD-102-R4.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
const docsRoot = path.join(exampleRoot, 'docs');

interface Doc {
  /** Slug relative to docs/, no extension. */
  slug: string;
  title: string;
  summary: string;
  body: string;
  type?: string;
  related?: string[];
}

/** Hand-authored canonical pages per PRD-701-R5. */
const FIXED_DOCS: Doc[] = [
  {
    slug: 'intro',
    title: 'Tinybox SDK overview',
    summary: 'Introduction to the Tinybox storage SDK: data model, capabilities, and a tour of the docs.',
    type: 'doc',
    body: [
      'Tinybox is a fictional object-storage product used as the corpus for the PRD-701 conformance example.',
      'The docs are organised into Getting Started, Concepts, an API reference grouped by surface area, recipes,',
      'and a troubleshooting catalog. Each page is one ACT node per PRD-201; each `sidebars.js` category becomes a',
      'synthesized parent node per PRD-404-R6.',
      '',
      '## Where to start',
      '',
      'Start with [Getting started](/docs/getting-started/install) or jump to the [API reference](/docs/api/buckets/create).',
    ].join('\n'),
  },
  {
    slug: 'changelog',
    title: 'Changelog',
    summary: 'Release notes for the Tinybox SDK reference docs.',
    type: 'reference',
    body: [
      '## v0.1 — 2026-05-02',
      '',
      '- Initial public release.',
      '- Buckets, Objects, and Webhooks API surfaces.',
      '- 100+ recipes and 60+ troubleshooting entries.',
    ].join('\n'),
  },
  {
    slug: 'getting-started/install',
    title: 'Install the SDK',
    summary: 'Install the Tinybox SDK via the package manager of your choice.',
    body: [
      '## Install',
      '',
      '```bash',
      'npm install @tinybox/sdk',
      '```',
      '',
      'The SDK targets Node 20+ and modern browsers. ESM only.',
    ].join('\n'),
  },
  {
    slug: 'getting-started/quickstart',
    title: 'Quickstart',
    summary: 'Provision a bucket and upload your first object in under a minute.',
    body: [
      '## Five minutes',
      '',
      '```ts',
      "import { Tinybox } from '@tinybox/sdk';",
      "const tb = new Tinybox({ token: process.env.TINYBOX_TOKEN });",
      "await tb.buckets.create({ name: 'my-bucket', region: 'us-east-1' });",
      '```',
    ].join('\n'),
  },
  {
    slug: 'getting-started/first-project',
    title: 'Your first project',
    summary: 'Walk through wiring a real application against Tinybox storage.',
    body: [
      'A guided walkthrough that wires the SDK into an Express app and uploads',
      'user-supplied media to a fresh bucket. End-to-end in roughly 100 lines.',
    ].join('\n'),
  },
  {
    slug: 'concepts/data-model',
    title: 'Data model',
    summary: 'Buckets, Objects, and Webhooks: the three top-level resources.',
    body: [
      'Tinybox exposes three nouns: **Buckets** (containers), **Objects**',
      '(blobs), and **Webhooks** (lifecycle event delivery). Buckets nest objects;',
      'webhooks subscribe to events on either.',
    ].join('\n'),
  },
  {
    slug: 'concepts/auth',
    title: 'Authentication',
    summary: 'Bearer-token authentication and per-project scoping.',
    body: [
      'Authenticate via a bearer token in the `Authorization` header.',
      'Tokens are issued from the dashboard and scoped per project.',
    ].join('\n'),
  },
  {
    slug: 'concepts/storage/buckets',
    title: 'Buckets concept',
    summary: 'Buckets are regional containers that hold objects.',
    body: [
      'Buckets are the unit of regional placement and access policy. Each',
      'bucket lives in exactly one region; cross-region replication is opt-in.',
    ].join('\n'),
  },
  {
    slug: 'concepts/storage/objects',
    title: 'Objects concept',
    summary: 'Objects are immutable byte sequences keyed within a bucket.',
    body: [
      'Object keys are UTF-8 strings up to 1024 bytes. Object payloads are',
      'immutable; an upload to an existing key creates a new version when the',
      'bucket has versioning enabled.',
    ].join('\n'),
  },
  {
    slug: 'concepts/storage/lifecycle',
    title: 'Lifecycle policies',
    summary: 'Automatic transitions between storage classes by age or tag.',
    body: [
      'Lifecycle policies move objects between storage classes (STANDARD,',
      'INFREQUENT, ARCHIVE, DEEP) based on age or tag predicates.',
    ].join('\n'),
  },
  // API: buckets
  {
    slug: 'api/buckets/create',
    title: 'Create a bucket',
    summary: 'Provision a new storage bucket in the workspace.',
    type: 'reference',
    related: ['api/buckets/list', 'api/buckets/delete'],
    body: [
      '## Request',
      '',
      '```bash',
      "curl -X POST -H 'Authorization: Bearer $TOKEN' \\",
      "  -d '{\"name\":\"my-bucket\",\"region\":\"us-east-1\"}' \\",
      '  https://api.tinybox.dev/v1/buckets',
      '```',
      '',
      '## Response',
      '',
      'The API returns the created bucket descriptor. See [List buckets](/docs/api/buckets/list).',
    ].join('\n'),
  },
  {
    slug: 'api/buckets/get',
    title: 'Get a bucket',
    summary: 'Fetch a single bucket descriptor by name.',
    type: 'reference',
    related: ['api/buckets/list'],
    body: '`GET /v1/buckets/{name}` — returns the bucket descriptor or 404 when absent.',
  },
  {
    slug: 'api/buckets/list',
    title: 'List buckets',
    summary: 'List all buckets visible to the calling principal.',
    type: 'reference',
    related: ['api/buckets/get'],
    body: '`GET /v1/buckets` — paginates via `?cursor=` query parameter; default page size 100.',
  },
  {
    slug: 'api/buckets/delete',
    title: 'Delete a bucket',
    summary: 'Remove an empty bucket from the workspace.',
    type: 'reference',
    related: ['api/buckets/create'],
    body: '`DELETE /v1/buckets/{name}` — fails with 409 when the bucket contains objects.',
  },
  // API: objects
  {
    slug: 'api/objects/upload',
    title: 'Upload an object',
    summary: 'Stream a payload into a bucket under a chosen key.',
    type: 'reference',
    related: ['api/objects/download'],
    body: '`PUT /v1/buckets/{bucket}/objects/{key}` — `Content-Type` and `Content-Length` are required.',
  },
  {
    slug: 'api/objects/download',
    title: 'Download an object',
    summary: 'Fetch an object payload, optionally honoring a version selector.',
    type: 'reference',
    related: ['api/objects/upload'],
    body: '`GET /v1/buckets/{bucket}/objects/{key}` — supports `?version=` and HTTP range requests.',
  },
  {
    slug: 'api/objects/list',
    title: 'List objects',
    summary: 'Enumerate objects in a bucket with optional prefix filtering.',
    type: 'reference',
    body: '`GET /v1/buckets/{bucket}/objects` — `?prefix=` and `?cursor=` query parameters.',
  },
  {
    slug: 'api/objects/delete',
    title: 'Delete an object',
    summary: 'Remove an object key from a bucket.',
    type: 'reference',
    body: '`DELETE /v1/buckets/{bucket}/objects/{key}` — soft-deletes when versioning is on.',
  },
  // API: webhooks
  {
    slug: 'api/webhooks/register',
    title: 'Register a webhook',
    summary: 'Subscribe a callback URL to bucket or object lifecycle events.',
    type: 'reference',
    body: '`POST /v1/webhooks` — body declares `target_url`, `event_types`, and `bucket` filter.',
  },
  {
    slug: 'api/webhooks/list',
    title: 'List webhooks',
    summary: 'Enumerate webhook subscriptions for the current project.',
    type: 'reference',
    body: '`GET /v1/webhooks` — returns subscription records ordered by `created_at` descending.',
  },
  {
    slug: 'api/webhooks/delete',
    title: 'Delete a webhook',
    summary: 'Remove a webhook subscription by id.',
    type: 'reference',
    body: '`DELETE /v1/webhooks/{id}` — idempotent; 404 when the subscription is already gone.',
  },
];

/**
 * PRD-701-R7 — the canonical recipes page that embeds a JSON `data` block.
 * This satisfies the "at least one node MUST embed a fenced data block"
 * normative requirement.
 */
const LIFECYCLE_DATA_PAGE: Doc = {
  slug: 'recipes/lifecycle-policy',
  title: 'Bucket lifecycle policy reference',
  summary: 'Lifecycle rules table for retention configuration.',
  type: 'reference',
  body: [
    'The supported lifecycle transitions:',
    '',
    '```json data',
    '{',
    '  "transitions": [',
    '    { "from": "STANDARD", "to": "INFREQUENT", "after_days": 30 },',
    '    { "from": "INFREQUENT", "to": "ARCHIVE",   "after_days": 90 },',
    '    { "from": "ARCHIVE",   "to": "DEEP",       "after_days": 365 }',
    '  ]',
    '}',
    '```',
    '',
    'Apply the policy with `PUT /v1/buckets/{bucket}/lifecycle`.',
  ].join('\n'),
};

/**
 * Procedurally expand recipes & troubleshooting branches to hit the
 * 200-500 node envelope (PRD-701-R3). Each page gets its own deterministic
 * title, summary, and body; both branches are split into sub-categories so
 * the 4-level hierarchy from PRD-701-R5 holds throughout.
 *
 * Recipe sub-categories (3 levels deep): recipes/<area>/<topic>.md
 *   - areas: ingestion, archival, security, performance, integrations
 *   - topics per area: 8-12 pages
 *
 * Troubleshooting sub-categories: troubleshooting/<surface>/<topic>.md
 *   - surfaces: buckets, objects, webhooks, auth, networking, billing
 *   - topics per surface: 8-12 pages
 */
const RECIPE_AREAS: Array<{ slug: string; label: string; topics: string[] }> = [
  {
    slug: 'ingestion',
    label: 'Ingestion',
    topics: [
      'multipart-upload',
      'streaming-upload',
      'parallel-shards',
      'resume-interrupted-upload',
      'upload-from-presigned-url',
      'browser-direct-upload',
      'mobile-direct-upload',
      'rate-limited-ingestion',
      'idempotent-uploads',
      'content-md5-verification',
    ],
  },
  {
    slug: 'archival',
    label: 'Archival',
    topics: [
      'archive-old-objects',
      'restore-from-archive',
      'expire-temporary-uploads',
      'tag-driven-lifecycle',
      'cross-region-archive',
      'compliance-retention',
      'legal-hold',
      'tiered-cold-storage',
      'archive-audit-trail',
    ],
  },
  {
    slug: 'security',
    label: 'Security',
    topics: [
      'rotate-tokens',
      'scope-tokens-per-project',
      'audit-access-logs',
      'encrypt-at-rest',
      'customer-managed-keys',
      'block-public-access',
      'signed-download-urls',
      'ip-allowlists',
      'vpc-peering',
      'mfa-protected-deletes',
    ],
  },
  {
    slug: 'performance',
    label: 'Performance',
    topics: [
      'use-byte-ranges',
      'parallel-downloads',
      'cdn-frontends',
      'request-coalescing',
      'reduce-listing-cost',
      'choose-region',
      'multi-region-reads',
      'avoid-listings-in-hot-paths',
      'edge-cache-invalidation',
    ],
  },
  {
    slug: 'integrations',
    label: 'Integrations',
    topics: [
      'cloudflare-workers',
      'aws-lambda',
      'github-actions',
      'vercel-edge-functions',
      'next-js-app-router',
      'astro-image-pipeline',
      'remix-loaders',
      'svelte-kit-endpoints',
      'flutter-mobile',
      'rails-active-storage',
      'django-storages',
      'spring-boot',
    ],
  },
];

const TROUBLE_SURFACES: Array<{ slug: string; label: string; topics: string[] }> = [
  {
    slug: 'buckets',
    label: 'Buckets',
    topics: [
      'bucket-name-conflict',
      'bucket-not-empty',
      'region-not-supported',
      'create-rate-limited',
      'replication-lag',
      'lifecycle-not-applied',
      'cross-account-access-denied',
      'unexpected-versioning-state',
    ],
  },
  {
    slug: 'objects',
    label: 'Objects',
    topics: [
      'upload-checksum-mismatch',
      'download-truncated',
      'multipart-upload-failed',
      'precondition-failed',
      'storage-class-mismatch',
      'object-not-found-after-write',
      'metadata-not-persisted',
      'range-request-rejected',
      'unexpected-size-difference',
    ],
  },
  {
    slug: 'webhooks',
    label: 'Webhooks',
    topics: [
      'callback-not-received',
      'duplicate-deliveries',
      'callback-times-out',
      'signature-verification-failed',
      'event-filter-not-applied',
      'subscription-quota-exceeded',
      'callback-host-unreachable',
      'tls-handshake-failed',
    ],
  },
  {
    slug: 'auth',
    label: 'Auth',
    topics: [
      'token-expired',
      'token-not-found',
      'permission-denied',
      'cross-project-token',
      'rotation-overlap-window',
      'mfa-required',
      'principal-disabled',
      'audit-log-missing',
    ],
  },
  {
    slug: 'networking',
    label: 'Networking',
    topics: [
      'connection-reset',
      'tls-version-too-old',
      'http2-required',
      'proxy-misconfigured',
      'dns-resolution-failed',
      'cross-region-latency',
      'mtu-issues',
      'ipv6-disabled',
    ],
  },
  {
    slug: 'billing',
    label: 'Billing',
    topics: [
      'over-quota',
      'unexpected-egress-charges',
      'spend-alert-not-firing',
      'invoice-mismatch',
      'tax-jurisdiction-changed',
      'plan-downgrade-blocked',
    ],
  },
];

/**
 * For each declared topic we synthesize a small family of variants
 * (`-overview`, `-cli`, `-sdk-node`, `-sdk-python`, `-sdk-go`, `-faq`) to
 * push the source-file count comfortably into the PRD-701-R3 envelope while
 * keeping each page's content non-trivial and topic-coherent. The exact
 * variants are deterministic functions of the topic so the corpus is
 * regeneratable byte-for-byte.
 */
const RECIPE_VARIANTS = ['overview', 'cli', 'sdk-node', 'sdk-python'] as const;
const TROUBLE_VARIANTS = ['symptom', 'resolution', 'reproduction'] as const;

function recipePages(): Doc[] {
  const docs: Doc[] = [];
  for (const area of RECIPE_AREAS) {
    for (const topic of area.topics) {
      const human = topic.replace(/-/g, ' ');
      for (const variant of RECIPE_VARIANTS) {
        const variantHuman = variant.replace(/-/g, ' ');
        docs.push({
          slug: `recipes/${area.slug}/${topic}-${variant}`,
          title: `${capitalize(human)} ${variantHuman} (${area.label})`,
          summary: `${capitalize(human)} ${variantHuman} — ${area.label.toLowerCase()} workflow walkthrough.`,
          type: 'recipe',
          body: recipeBody(area.label, `${human} (${variantHuman})`),
        });
      }
    }
  }
  return docs;
}

function troubleshootingPages(): Doc[] {
  const docs: Doc[] = [];
  for (const surface of TROUBLE_SURFACES) {
    for (const topic of surface.topics) {
      const human = topic.replace(/-/g, ' ');
      for (const variant of TROUBLE_VARIANTS) {
        const variantHuman = variant.replace(/-/g, ' ');
        docs.push({
          slug: `troubleshooting/${surface.slug}/${topic}-${variant}`,
          title: `${capitalize(human)} ${variantHuman} (${surface.label})`,
          summary: `Resolve "${human}" — ${variantHuman} for the ${surface.label} surface.`,
          type: 'troubleshooting',
          body: troubleBody(surface.label, `${human} (${variantHuman})`),
        });
      }
    }
  }
  return docs;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function recipeBody(area: string, topic: string): string {
  return [
    `## Goal`,
    '',
    `Demonstrate "${topic}" against the Tinybox ${area.toLowerCase()} surface end to end.`,
    '',
    '## Walkthrough',
    '',
    '```bash',
    `# Step 1 — prepare a bucket for the ${area.toLowerCase()} workflow.`,
    `tinybox buckets create my-bucket --region us-east-1`,
    '```',
    '',
    `Apply the recipe; verify with the API reference under [API reference](/docs/api/buckets/get).`,
  ].join('\n');
}

function troubleBody(surface: string, topic: string): string {
  return [
    `## Symptom`,
    '',
    `An operation against the ${surface} surface fails with an error matching "${topic}".`,
    '',
    `## Resolution`,
    '',
    `1. Inspect the error envelope.\n2. Re-issue with corrected parameters.\n3. Confirm via the audit log.`,
    '',
    `See the [${surface} API reference](/docs/api/buckets/get) for the exact field set.`,
  ].join('\n');
}

function frontmatter(doc: Doc): string {
  const lines: string[] = ['---'];
  lines.push(`title: ${quoteIfNeeded(doc.title)}`);
  lines.push(`summary: ${quoteIfNeeded(doc.summary)}`);
  if (doc.type !== undefined) lines.push(`type: ${doc.type}`);
  if (doc.related !== undefined && doc.related.length > 0) {
    lines.push('related:');
    for (const r of doc.related) lines.push(`  - ${r}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function quoteIfNeeded(s: string): string {
  // YAML — quote only when the value contains a colon, hash, or starts oddly.
  if (/[:#]|^[\s>|*&!%@`]/.test(s)) return JSON.stringify(s);
  return s;
}

async function writeDoc(doc: Doc): Promise<void> {
  const filePath = path.join(docsRoot, `${doc.slug}.md`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const body = `${frontmatter(doc)}\n\n${doc.body}\n`;
  await fs.writeFile(filePath, body, 'utf8');
}

interface SidebarTree {
  fixed: typeof FIXED_DOCS;
  lifecycle: Doc;
  recipes: typeof RECIPE_AREAS;
  troubleshooting: typeof TROUBLE_SURFACES;
}

function emitSidebars(tree: SidebarTree): string {
  // CJS module exports — Docusaurus loads `sidebars.js` via `require()`.
  // We hand-author the structure to mirror PRD-701-R5 (4-level hierarchy).
  const lines: string[] = [];
  lines.push('// Generated by scripts/generate-corpus.ts — do not edit by hand.');
  lines.push('// Mirrors PRD-701-R5: 4-level category hierarchy.');
  lines.push('module.exports = {');
  lines.push('  docs: [');
  lines.push("    'intro',");
  lines.push('    {');
  lines.push("      type: 'category',");
  lines.push("      label: 'Getting started',");
  lines.push('      items: [');
  lines.push("        'getting-started/install',");
  lines.push("        'getting-started/quickstart',");
  lines.push("        'getting-started/first-project',");
  lines.push('      ],');
  lines.push('    },');
  lines.push('    {');
  lines.push("      type: 'category',");
  lines.push("      label: 'Concepts',");
  lines.push('      items: [');
  lines.push("        'concepts/data-model',");
  lines.push("        'concepts/auth',");
  lines.push('        {');
  lines.push("          type: 'category',");
  lines.push("          label: 'Storage',");
  lines.push('          items: [');
  lines.push("            'concepts/storage/buckets',");
  lines.push("            'concepts/storage/objects',");
  lines.push("            'concepts/storage/lifecycle',");
  lines.push('          ],');
  lines.push('        },');
  lines.push('      ],');
  lines.push('    },');
  lines.push('    {');
  lines.push("      type: 'category',");
  lines.push("      label: 'API reference',");
  lines.push('      items: [');
  lines.push('        {');
  lines.push("          type: 'category',");
  lines.push("          label: 'Buckets',");
  lines.push('          items: [');
  lines.push("            'api/buckets/create',");
  lines.push("            'api/buckets/get',");
  lines.push("            'api/buckets/list',");
  lines.push("            'api/buckets/delete',");
  lines.push('          ],');
  lines.push('        },');
  lines.push('        {');
  lines.push("          type: 'category',");
  lines.push("          label: 'Objects',");
  lines.push('          items: [');
  lines.push("            'api/objects/upload',");
  lines.push("            'api/objects/download',");
  lines.push("            'api/objects/list',");
  lines.push("            'api/objects/delete',");
  lines.push('          ],');
  lines.push('        },');
  lines.push('        {');
  lines.push("          type: 'category',");
  lines.push("          label: 'Webhooks',");
  lines.push('          items: [');
  lines.push("            'api/webhooks/register',");
  lines.push("            'api/webhooks/list',");
  lines.push("            'api/webhooks/delete',");
  lines.push('          ],');
  lines.push('        },');
  lines.push('      ],');
  lines.push('    },');
  // Recipes
  lines.push('    {');
  lines.push("      type: 'category',");
  lines.push("      label: 'Recipes',");
  lines.push('      items: [');
  lines.push(`        '${tree.lifecycle.slug}',`);
  for (const area of tree.recipes) {
    lines.push('        {');
    lines.push("          type: 'category',");
    lines.push(`          label: '${area.label}',`);
    lines.push('          items: [');
    for (const topic of area.topics) {
      for (const variant of RECIPE_VARIANTS) {
        lines.push(`            'recipes/${area.slug}/${topic}-${variant}',`);
      }
    }
    lines.push('          ],');
    lines.push('        },');
  }
  lines.push('      ],');
  lines.push('    },');
  // Troubleshooting
  lines.push('    {');
  lines.push("      type: 'category',");
  lines.push("      label: 'Troubleshooting',");
  lines.push('      items: [');
  for (const surface of tree.troubleshooting) {
    lines.push('        {');
    lines.push("          type: 'category',");
    lines.push(`          label: '${surface.label} issues',`);
    lines.push('          items: [');
    for (const topic of surface.topics) {
      for (const variant of TROUBLE_VARIANTS) {
        lines.push(`            'troubleshooting/${surface.slug}/${topic}-${variant}',`);
      }
    }
    lines.push('          ],');
    lines.push('        },');
  }
  lines.push('      ],');
  lines.push('    },');
  lines.push("    'changelog',");
  lines.push('  ],');
  lines.push('};');
  return lines.join('\n') + '\n';
}

async function main(): Promise<void> {
  // Wipe the docs tree so the corpus is fully regeneratable.
  await fs.rm(docsRoot, { recursive: true, force: true });
  await fs.mkdir(docsRoot, { recursive: true });

  const recipes = recipePages();
  const trouble = troubleshootingPages();
  const allDocs: Doc[] = [...FIXED_DOCS, LIFECYCLE_DATA_PAGE, ...recipes, ...trouble];

  for (const doc of allDocs) {
    await writeDoc(doc);
  }

  // Emit sidebars.js
  const sidebars = emitSidebars({
    fixed: FIXED_DOCS,
    lifecycle: LIFECYCLE_DATA_PAGE,
    recipes: RECIPE_AREAS,
    troubleshooting: TROUBLE_SURFACES,
  });
  // Use `.cjs` so the example's `package.json` "type": "module" doesn't
  // try to load it as ESM. The plugin's `loadSidebars` searches `sidebars.js`,
  // `sidebars.cjs`, and `sidebars.mjs` in order; `.cjs` is unambiguous.
  await fs.writeFile(path.join(exampleRoot, 'sidebars.cjs'), sidebars, 'utf8');

  // Sanity-stat: how many sources + categories?
  const categoryCount =
    1 /* getting-started */ +
    2 /* concepts + concepts/storage */ +
    1 /* api */ + 3 /* api children */ +
    1 /* recipes */ + RECIPE_AREAS.length +
    1 /* troubleshooting */ + TROUBLE_SURFACES.length;
  // Source-file nodes:
  const sourceCount = allDocs.length;
  const totalEstimate = sourceCount + categoryCount;
  console.log(
    `PRD-701 corpus generated: ${sourceCount} markdown files, ${categoryCount} sidebar categories.`,
  );
  console.log(`  Estimated total ACT nodes (sources + synthesized): ${totalEstimate}`);
  console.log(`  PRD-701-R3 envelope: 200 ≤ ${totalEstimate} ≤ 500 ${
    totalEstimate >= 200 && totalEstimate <= 500 ? 'OK' : 'OUT-OF-ENVELOPE'
  }`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
