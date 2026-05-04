---
title: ACT — Agent Content Tree
description: An open standard for publishing AI-readable, structured content from any website, CMS, or app.
template: splash
hero:
  tagline: Drop a plugin into your site and ship typed, schema-validated content trees that any MCP-capable agent can read today.
  actions:
    - text: Quickstart
      link: /quickstart/
      icon: right-arrow
      variant: primary
    - text: Why ACT?
      link: /why-act/
      variant: minimal
    - text: View on GitHub
      link: https://github.com/act-spec/act
      icon: external
      variant: minimal
summary: ACT is an open standard for publishing structured, AI-discoverable content. One config line in Astro / Next / Nuxt / VitePress / Eleventy / Docusaurus and your site emits ACT alongside its normal output.
---

<section class="feature-row">
  <article class="feature-tile">
    <h3>Drop-in plugins</h3>
    <p>One config line in Astro / Next / Nuxt / VitePress / Eleventy / Docusaurus and your site emits ACT alongside its normal output. No bespoke pipeline, no extra hosting.</p>
    <a class="more" href="/quickstart/">See the quickstart →</a>
  </article>

  <article class="feature-tile">
    <h3>Hosted MCP</h3>
    <p>Paste 5 lines into Claude Desktop or Cursor and your agent can browse any ACT-emitting site through <code>mcp.act-spec.org</code>. ACT is useful before AI vendors ship native support.</p>
    <a class="more" href="/why-act/#the-hosted-mcp">Read more →</a>
  </article>

  <article class="feature-tile">
    <h3>Spec + governance</h3>
    <p>Wire format, conformance levels, JSON schemas — all open. Changes go through the public ASP process. Apache-2.0 reference impl, CC-BY-4.0 spec text, W3C Community Group filing in flight.</p>
    <a class="more" href="/spec/v0.2/">Read the spec →</a>
  </article>
</section>

<aside class="comparison-summary">
  <p style="margin:0;"><strong>How ACT compares.</strong> ACT is a strict superset of <code>/llms.txt</code> and <code>/llms-full.txt</code> — every plugin auto-emits both files for back-compat. ACT adds typed nodes, hierarchy, native i18n, schema validation, and runtime delivery. Different from schema.org (in-page semantics) and sitemap.xml (URL list with no content). Composes with MCP rather than competing. <a href="/why-act/">Read the full comparison →</a></p>
</aside>

<section class="mcp-snippet" id="try-act-with-your-ai-agent">
  <h3>Try ACT with your AI agent</h3>
  <p>Paste this into your <code>claude_desktop_config.json</code> (or the Cursor / Continue equivalent) and your agent can walk this site — or any ACT-emitting site — immediately.</p>
  <pre id="mcp-config-snippet"><code>{
  "mcpServers": {
    "act": {
      "command": "npx",
      "args": ["-y", "@act-spec/mcp-server", "https://act-spec.org"]
    }
  }
}</code></pre>
  <button class="copy-btn" type="button" data-copy-target="mcp-config-snippet" aria-label="Copy MCP config snippet to clipboard">Copy snippet</button>
  <p style="margin-top:0.7rem;font-size:0.88rem;">
    Want a hosted MCP server instead? Point your client at <code>https://mcp.act-spec.org</code> over SSE. See the <a href="/spec/v0.2/tooling/">tooling spec</a> for transport details.
  </p>
</section>

<script is:inline>
  document.querySelectorAll('button[data-copy-target]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var target = document.getElementById(btn.dataset.copyTarget);
      if (!target) return;
      navigator.clipboard.writeText(target.innerText).then(function(){
        var original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(function(){ btn.textContent = original; }, 1400);
      });
    });
  });
</script>

## Get started

- **Have an existing project?** Drop a plugin into your build config — see the
  [Quickstart](/quickstart/) for one-line snippets for Astro, Next.js,
  VitePress, Nuxt, Eleventy, and Docusaurus.
- **Starting fresh?** Run `npm create act-app@latest` and pick from the
  [examples gallery](/examples/).
- **Curious about the wire format?** Read the
  [v0.2 specification](/spec/v0.2/) — manifest, index, node envelopes,
  conformance levels, and security model.

## Status

v0.2.0 is the first public release. The spec is in Draft pending the v0.2.0
stable cut. Reference implementation packages are at `@act-spec/*`
(`workspace:*` in this monorepo, `^0.2.0` once published). Conformance
fixtures and a hosted validator at
[validator.act-spec.org](https://act-spec.github.io/act/validator/) are part
of the same release.
