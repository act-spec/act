// Sample sidebars for the PRD-404 fixture site. Module export shape mirrors
// Docusaurus's sidebar config so the plugin's sidebar normalizer accepts it
// verbatim.
module.exports = {
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Getting started',
      items: ['install', 'quickstart'],
    },
    {
      type: 'category',
      label: 'API',
      items: ['api-reference', 'api-auth'],
    },
  ],
};
