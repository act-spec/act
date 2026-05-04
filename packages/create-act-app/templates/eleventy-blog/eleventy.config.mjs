// Eleventy + ACT example.
//
// `@act-spec/plugin-eleventy` registers as a plugin via `addPlugin`. The
// `@act-spec/adapter-markdown` is auto-wired against Eleventy's input dir
// — no separate adapter wiring needed.
import actPlugin from '@act-spec/plugin-eleventy';

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(actPlugin, {
    conformanceTarget: 'standard',
    baseUrl: 'https://example.com',
    manifest: { site: { name: 'Tinybox Blog' } },
    urlTemplates: {
      indexUrl: '/act/index.json',
      nodeUrlTemplate: '/act/nodes/{id}.json',
      subtreeUrlTemplate: '/act/subtrees/{id}.json',
    },
    parseMode: 'fine',
  });

  return {
    dir: { input: '.', output: '_site' },
    markdownTemplateEngine: 'njk',
  };
}
