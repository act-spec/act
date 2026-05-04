// Eleventy + ACT example.
//
// `@act-spec/plugin-eleventy` registers as a plugin via `addPlugin`. The
// `@act-spec/adapter-markdown` is auto-wired against Eleventy's input dir
// — no separate adapter wiring needed.
import actPlugin from '@act-spec/plugin-eleventy';

export default function (eleventyConfig) {
  // Default layout for every markdown file in the corpus. Posts under
  // `posts/` override it via `posts/posts.json` for the chronological
  // wrapper. Without this default, eleventy renders bare `<p>` HTML
  // with no nav, no styles, and no links — fine for the ACT pipeline
  // but unusable as a hosted demo.
  eleventyConfig.addGlobalData('layout', 'base.njk');

  // Cheap ISO-date filter for the post-list templates; Eleventy 2 does
  // not ship a built-in date formatter and pulling moment / date-fns in
  // for one-off use isn't worth the dependency weight.
  eleventyConfig.addFilter('isoDate', (value) => {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'string') return value.slice(0, 10);
    return '';
  });

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

  // Honor ACT_PAGES_BASE so the same example builds locally with `/`
  // and under `/examples/eleventy-blog/` for the hosted deploy.
  // Eleventy's `pathPrefix` rewrites the public `url` filter and
  // `<a href>` links; ACT envelope paths are managed independently by
  // the plugin.
  const PAGES_BASE = process.env['ACT_PAGES_BASE'] ?? '/';
  return {
    dir: { input: '.', output: '_site' },
    markdownTemplateEngine: 'njk',
    pathPrefix: PAGES_BASE,
  };
}
