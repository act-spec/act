# @act-spec/plugin-docusaurus

Docusaurus plugin for ACT (Agent Content Tree). Wraps the ACT generator pipeline as a Docusaurus plugin so a Docusaurus site can emit a conformant ACT file set alongside its built docs.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/plugin-docusaurus": "workspace:*" } }
```

## Usage

```js
// docusaurus.config.cjs
module.exports = {
  plugins: [
    ['@act-spec/plugin-docusaurus', {
      manifest: { site: { name: 'Example' } },
      conformanceTarget: 'standard',
    }],
  ],
};
```

See [`examples/docusaurus-docs/`](../../examples/docusaurus-docs) for a complete project.

## Links

- Generator core: [`@act-spec/generator-core`](../generator-core)
- Repository: <https://github.com/act-spec/act>
