# WordPress blog with ACT

A runnable demo of [`@act-spec/adapter-wordpress`](../../packages/adapter-wordpress/README.md): the adapter consumes the WordPress REST API (`wp/v2/{posts,pages,categories,tags,users}`), the canonical generator pipeline emits ACT envelopes, and the result lands at `/.well-known/act.json` + `/act/...` next to the back-compat `llms.txt` / `llms-full.txt` surface.

To keep the example reproducible, no live WordPress server is required. The build script wires a custom `fetch` implementation that serves a baked WP REST fixture (`fixtures/wordpress-rest.json`) from disk. Swap that for `globalThis.fetch` and a real `baseUrl` and the same code points at a production site.

## Quick start

```sh
pnpm install                                          # from the repo root
pnpm -F @act-spec/example-wordpress-blog build        # ACT artefacts → public/
pnpm -F @act-spec/example-wordpress-blog conformance  # build + validator gate
pnpm -F @act-spec/example-wordpress-blog start        # serve public/ on :4325
```

After `build`, browse the emitted tree:

```
http://localhost:4325/.well-known/act.json
http://localhost:4325/act/index.json
http://localhost:4325/act/nodes/wp/post/welcome-to-act.json
http://localhost:4325/llms.txt
http://localhost:4325/llms-full.txt
```

## What it shows

- **The WordPress adapter end-to-end.** Posts, pages, categories, and tags all land as ACT nodes. The adapter takes care of: HTML excerpt → `summary`, rendered post body → `prose` blocks, category/tag relationships, stable namespaced ids (`wp/post/<slug>`, `wp/category/<slug>`, ...), default WP-kind → ACT-type mapping (`post` → `article`, `page` and `category` → `section`, `tag` → `tag`, `user` → `profile`), and `metadata.source.adapter = "act-wordpress"` attribution on every node.
- **Custom `fetch` injection.** The adapter accepts a `fetch` option; this example uses it to serve fixture JSON from disk so CI (and your laptop offline) can exercise the full pipeline. The same hook lets you intercept calls to a real WP site for caching, retries, or auth experiments.
- **Default-on `llms.txt` / `llms-full.txt`.** The generator emits both at the site root next to the ACT files, so legacy LLM crawlers still get something useful even before they learn the ACT manifest.
- **A complete conformance gate.** `scripts/validate.ts` walks the emitted tree through `@act-spec/validator` and asserts zero gaps at the Standard level. Plug it straight into CI.

The fixture is small on purpose (5 posts, 1 page, 2 categories, 2 tags, 1 user). It's enough to exercise the adapter's mappers without obscuring the build code.

## How to run

The example exposes the standard scripts every `examples/*` package follows:

| Script | What it does |
|---|---|
| `pnpm build` | Run the pipeline. Writes ACT artefacts and `llms*.txt` into `public/`. |
| `pnpm validate` | Run the validator over `public/` and fail on any gap. |
| `pnpm conformance` | `build` + `validate` in one shot — the CI gate. |
| `pnpm start` | `build` + serve `public/` on `http://localhost:4325` (CORS-enabled). |
| `pnpm typecheck` | Type-check the example sources. |

There is no human-facing UI in this example — the focus is the ACT output. Pair it with the validator SPA (`apps/validator-web`) or the site browser (`apps/site-browser`) running against `http://localhost:4325` to inspect the tree visually.

## Pointing this at a real WordPress site

The build script picks the adapter's data source in one place. To target a live WP install:

```ts
// scripts/build.ts
const adapter = createWordPressAdapter();   // drop the custom fetch

const config: GeneratorConfig = {
  // ...
  adapters: [
    {
      adapter,
      config: {
        baseUrl: 'https://your-blog.example',
        auth: { from_env: 'WP_APP_PASSWORD_TOKEN' },   // or { user, appPassword }
        include: { posts: true, pages: true, categories: true, tags: true, users: false },
      },
      actVersion: '0.1',
    },
  ],
};
```

That's the only delta. Everything else — id namespacing, summary derivation, schema validation, pipeline emission, conformance gate — works unchanged.

## Verifying ACT output

After `pnpm build`, sanity-check the manifest:

```sh
jq . public/.well-known/act.json
```

Expect `act_version: "0.1"`, `delivery: "static"`, `conformance.level: "standard"`, and a `node_url_template` of `/act/nodes/{id}.json`.

Then pick a post and inspect its node:

```sh
jq '{id, type, title, summary, parent, children, source: .metadata.source}' \
   public/act/nodes/wp/post/welcome-to-act.json
```

`metadata.source.adapter` should be `"act-wordpress"` and `source.human_url` should point at the post's WP permalink (`https://blog.example/welcome-to-act/` in the bundled fixture).

The conformance gate (`pnpm conformance`) covers the full validator walk plus example-specific shape checks (every WP kind is represented, every node has a non-empty summary, `llms*.txt` are non-trivial). It exits non-zero on any failure.

## File layout

```
examples/wordpress-blog/
├── README.md
├── package.json
├── tsconfig.json
├── fixtures/
│   └── wordpress-rest.json     # mock WP REST responses (5 posts, 1 page, 2 cats, 2 tags)
├── scripts/
│   ├── build.ts                # adapter + pipeline + emit
│   └── validate.ts             # validator gate over public/
└── public/                     # generated; git-ignored
    ├── .well-known/act.json
    ├── act/
    │   ├── index.json
    │   ├── nodes/wp/...         # one envelope per WP entity, namespaced
    │   └── subtrees/*.json
    ├── llms.txt
    ├── llms-full.txt
    └── .act-build-report.json
```
