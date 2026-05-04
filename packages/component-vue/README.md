# @act-spec/component-vue

Vue 3 binding for the ACT component contract. Bridges Vue component trees
to the framework-agnostic `NodeDraft` shape exported by
`@act-spec/component-contract`.

Implements the Vue declaration patterns:

- SFC default-export static field — `Component.act = { … }`,
- composable — `useActContract({ … })`,
- `<script setup>` macro — `defineActContract({ … })`,
- page-level boundary — `<ActSection>` wrapper.

The collector uses `provide` / `inject` and walks via
`@vue/server-renderer.renderToString`. Variant replay constructs a fresh
Vue app per variant. Render-time errors surface through
`app.config.errorHandler` as truncated + secret-redacted placeholders.
Vue 2 is explicitly out of scope.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/component-vue": "workspace:*" } }
```

## Usage

Static field on an SFC:

```ts
// PricingTable.vue
import type { VueComponentWithAct } from '@act-spec/component-vue';

const PricingTable: VueComponentWithAct = defineComponent({ /* … */ });
PricingTable.act = {
  type: 'marketing:pricing',
  title: (p) => p.heading,
  contentBlocks: (p) => p.tiers.map(toBlock),
};
export default PricingTable;
```

Composable:

```ts
import { useActContract } from '@act-spec/component-vue';

setup(props) {
  useActContract({
    type: 'marketing:faq',
    contentBlocks: () => props.items.map(toBlock),
  });
}
```

`<script setup>` macro:

```vue
<script setup lang="ts">
import { defineActContract } from '@act-spec/component-vue';

defineActContract({
  type: 'marketing:cta',
  title: (p) => p.headline,
});
</script>
```

Generators (Nuxt, custom Vite-Vue) call `extractRoute`:

```ts
import { extractRoute, vueBinding } from '@act-spec/component-vue';

const drafts = await extractRoute({
  pageContract: { /* … */ },
  rootComponent: AppPage,
  variants: [/* … */],
});
```

## Conformance / what's tested

Every public API has a citing test in the package's test suite, including
the Vue 3+ floor (`assertVue3Plus`), the contract-version pin, the
variant replay loop, and the placeholder + redaction contract. The
conformance gate runs `@act-spec/validator` against the extracted nodes.

```bash
pnpm -F @act-spec/component-vue conformance
```

## Peer dependencies

| Peer | Range |
| --- | --- |
| `vue` | `>=3.4 <4` |
| `@vue/server-renderer` | `>=3.4 <4` |

Both peers are optional from npm's perspective; the binding only requires
them at extraction time.

## Links

- Component contract: [`@act-spec/component-contract`](../component-contract)
- Repository: <https://github.com/act-spec/act>
