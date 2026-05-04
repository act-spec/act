// Minimal Docusaurus config used by the PRD-404 fixture site. The ACT
// plugin reads `url`, `baseUrl`, `i18n`, and the docs/blog presets to build
// its `LoadedContent` snapshot.
module.exports = {
  title: 'Acme Docs',
  url: 'https://docs.acme.com',
  baseUrl: '/',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      'classic',
      {
        docs: {
          path: 'docs',
          sidebarPath: './sidebars.js',
        },
        blog: {
          path: 'blog',
        },
      },
    ],
  ],
  plugins: [
    ['@act-spec/plugin-docusaurus', {}],
  ],
};
