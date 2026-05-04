# @act-spec/adapter-wordpress

WordPress adapter for ACT (Agent Content Tree). Consumes the WordPress
REST API and emits ACT envelopes against the shared adapter framework
(`@act-spec/adapter-framework`).

- Maps `wp/v2/posts` to leaf nodes (`type: 'article'`).
- Maps `wp/v2/pages` to branch nodes (`type: 'section'`), preserving the
  WordPress `parent` chain.
- Maps `wp/v2/categories` to branch nodes (`type: 'section'`),
  preserving the WordPress category-parent chain.
- Optionally enumerates `wp/v2/tags` and `wp/v2/users`.
- Detects **Polylang** and **WPML** automatically and surfaces the
  per-locale translation map under `metadata.translations`.
- Authentication: anonymous read, JWT bearer string, or WordPress
  application passwords (Basic Auth). All forms accept
  `{ from_env: 'NAME' }` for credential hygiene.
- Conformance target: **standard**.

## Status

Public release in ACT v0.2. Earlier ACT versions did not ship this
adapter.

## Install

```bash
npm install @act-spec/adapter-wordpress
```

Or, inside the ACT monorepo:

```jsonc
// package.json
{ "dependencies": { "@act-spec/adapter-wordpress": "workspace:*" } }
```

## Usage

### Public read-only blog

```ts
import { createWordPressAdapter } from '@act-spec/adapter-wordpress';

export default createWordPressAdapter({
  // No `provider` / `corpus` — the adapter wires the default HTTP
  // provider against `config.baseUrl`.
});
```

`act.config.{js,ts}`:

```js
export default {
  adapters: {
    '@act-spec/adapter-wordpress': {
      baseUrl: 'https://blog.example.com',
      include: { posts: true, pages: true, categories: true },
      perPage: 100,
    },
  },
};
```

### Private content via application passwords

```js
export default {
  adapters: {
    '@act-spec/adapter-wordpress': {
      baseUrl: 'https://cms.example.com',
      auth: {
        user: 'editor',
        appPassword: { from_env: 'WP_APP_PASSWORD' },
      },
    },
  },
};
```

The user / appPassword pair is sent as HTTP Basic Auth per the
WordPress 5.6+ application-password recommendation.

### JWT bearer token

```js
auth: { from_env: 'WP_JWT_TOKEN' }
```

### Locale fan-out (Polylang or WPML)

By default the adapter probes the first post for Polylang's `lang` /
`translations` fields and WPML's `wpml_current_locale` /
`wpml_translations`. Set `i18n.mode` explicitly to short-circuit the
probe:

```js
i18n: { mode: 'polylang' }   // or 'wpml' or 'none'
```

Each emitted post node carries `metadata.locale` and (when other
locales exist) `metadata.translations: Array<{ locale, id }>`. Node ids
are suffixed with `@<locale>` for non-default locales.

## Configuration reference

| Option         | Default                         | Notes                                                                |
| -------------- | ------------------------------- | -------------------------------------------------------------------- |
| `baseUrl`      | (required)                      | Site URL incl. protocol. REST root = `${baseUrl}/wp-json/wp/v2`.     |
| `auth`         | `undefined` (anonymous)         | Bearer string, `{ from_env }`, or `{ user, appPassword }`.           |
| `include`      | posts / pages / categories on   | Toggle each WP collection independently.                             |
| `perPage`      | `100`                           | REST page size; WordPress's hard cap.                                |
| `concurrency`  | `4`                             | Parallel transforms.                                                 |
| `namespace`    | `'wp'`                          | Prefix for emitted node ids.                                         |
| `i18n.mode`    | `'auto'`                        | `'auto'`, `'polylang'`, `'wpml'`, `'none'`.                          |
| `typeMap`      | `{}`                            | Override default ACT type per WP collection.                         |

## What's tested

`src/wordpress.test.ts` covers:

- Factory contract (`createWordPressAdapter`, defaults, capabilities).
- Config schema (positive + negative cases).
- Auth resolution (string, env var, application password, missing-env
  errors).
- HTTP fetch through a mocked `fetch`: pagination, header injection,
  401/403 → `auth_failed`, 5xx → `http_error`, transport rejections →
  `transport_error`, end-of-pagination 400 handling.
- HTML walker: paragraph splits, entity decoding, script / style
  scrubbing, comment stripping.
- i18n detection: Polylang via `lang` / `translations`, WPML via
  `wpml_current_locale` / `wpml_translations`, neither → `'none'`.
- Mapping: post / page / category / tag / user envelopes, parent
  chains, namespace + typeMap overrides, translation fan-out,
  extracted-vs-author summary classification.
- End-to-end through `runAdapter` + `validateNode` (every emitted
  envelope is gap-free).

The conformance gate runs `@act-spec/validator` against the bundled
fixture corpus and exits non-zero on any gap:

```bash
pnpm -F @act-spec/adapter-wordpress conformance
```

## Compatibility

- WordPress core: 5.6+ (application passwords) or any version exposing
  the v2 REST API for read-only public access.
- Polylang and WPML are detected at run time; either or neither can be
  installed.
- No first-party WordPress SDK dependency. The adapter speaks HTTP to
  `${baseUrl}/wp-json/wp/v2`; pass a custom `fetch` to wire it through
  a proxy or recorder.

## Links

- Adapter framework: [`@act-spec/adapter-framework`](../adapter-framework)
- Repository: <https://github.com/act-spec/act>
