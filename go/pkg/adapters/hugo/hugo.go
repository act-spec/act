// Package hugo implements the Go Hugo adapter for ACT v0.2 per the
// normative mapping at spec/v0.2/adapters/hugo.md.
//
// The adapter walks a Hugo site directory (the one containing config.toml
// or hugo.toml plus a content/ tree) and returns:
//
//   - one Manifest envelope (the equivalent of /.well-known/act.json), and
//   - one Node envelope per Hugo page or section.
//
// Hugo's content model maps to ACT as follows (Hugo-spec §"Mapping to ACT
// nodes"):
//
//   - A directory with `_index.md`     → ACT branch node (`type: "section"`).
//   - A page (`*.md`, not `_index.md`) → ACT leaf node (`type` defaults to
//     "article"; front-matter `type`
//     overrides).
//   - A page bundle (directory whose
//     `index.md` carries the page)     → leaf node with bundled siblings
//     emitted as a future-extension
//     hint (v0.2 emits the leaf only).
//
// ID derivation strips the file extension, collapses `_index` into its
// parent directory, lowercases ASCII, and uses `/` as the path separator.
// A front-matter `id:` overrides the path-derived value.
//
// Multilingual mode: when the Hugo config declares a `[languages]` table,
// the adapter walks each per-language content tree (either content/<lang>/...
// or filename-suffix `intro.es.md`) and stamps `metadata.locale` on each
// emitted node. Cross-locale translation links flow into
// `metadata.translations` per the i18n mapping.
//
// What this package deliberately does NOT do (parity with the spec):
//
//   - Render shortcodes. Spec is open on shortcode handling; we emit them
//     verbatim in the prose block.
//   - Compute permalinks. Spec says permalinks live in
//     `metadata.canonical_url`; the adapter emits them only when the
//     config provides a `baseURL`.
//   - Run `hugo build`. The adapter sits NEXT to a Hugo build per the
//     spec's recommended `hugo && act-hugo emit` integration shape.
package hugo

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/act-spec/act/go/pkg/core"
)

// Adapter is the public entry point. The zero value is usable; pass a
// non-nil Logger to receive non-fatal warnings (unparseable config,
// reserved-key collisions, etc.).
type Adapter struct {
	// SiteName overrides the manifest's site.name; when empty the
	// adapter uses the directory name of the Hugo site root.
	SiteName string

	// IndexURL is the URL the manifest advertises for /act/index.json
	// (default "/act/index.json").
	IndexURL string

	// NodeURLTemplate is the manifest's node_url_template (default
	// "/act/nodes/{id}.json").
	NodeURLTemplate string

	// Logger receives warnings; nil-safe.
	Logger func(format string, args ...any)
}

// Result bundles a single Run's output: the manifest, the per-node
// envelopes (one per Hugo page or section), and a flat list of warnings
// (non-fatal issues encountered during the walk).
type Result struct {
	Manifest *core.Manifest
	Nodes    []*core.Node
	Warnings []string
}

// Run walks hugoSiteRoot and produces a Result. The caller is responsible
// for serialising the envelopes (use core's JSON tags). Returns a non-nil
// error only on programmer misuse (the root directory does not exist or
// is not readable); per-file parse failures are logged and skipped so a
// single malformed page does not abort the whole walk.
func (a *Adapter) Run(ctx context.Context, hugoSiteRoot string) (*Result, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	abs, err := filepath.Abs(hugoSiteRoot)
	if err != nil {
		return nil, fmt.Errorf("hugo: resolve site root %q: %w", hugoSiteRoot, err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, fmt.Errorf("hugo: stat site root %q: %w", abs, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("hugo: site root %q is not a directory", abs)
	}

	cfg, err := loadConfig(abs)
	if err != nil {
		return nil, fmt.Errorf("hugo: load config: %w", err)
	}
	contentDir := filepath.Join(abs, "content")
	if _, err := os.Stat(contentDir); err != nil {
		return nil, fmt.Errorf("hugo: content/ not found under %s", abs)
	}

	res := &Result{Warnings: []string{}}

	// Per the i18n spec, a multilingual site walks each declared locale.
	// A site with no [languages] table walks the content tree once with
	// the default locale.
	locales := cfg.Locales()
	if len(locales) == 0 {
		locales = []string{cfg.DefaultContentLanguage}
	}

	allPages := []*hugoPage{}
	for _, loc := range locales {
		ctxPages, warns := scanContent(contentDir, loc, cfg)
		res.Warnings = append(res.Warnings, warns...)
		allPages = append(allPages, ctxPages...)
		_ = ctx // honoured by callers; scan is sequential and quick.
	}

	// Sort pages by ID for deterministic output.
	sort.Slice(allPages, func(i, j int) bool { return allPages[i].id < allPages[j].id })

	// Build parent→children index so section nodes carry the correct
	// children array. ID derivation already gives us the parent ID via
	// path arithmetic; we cross-check by collecting children at emit
	// time.
	childrenOf := map[string][]string{}
	knownIDs := map[string]bool{}
	for _, p := range allPages {
		knownIDs[p.id] = true
	}
	for _, p := range allPages {
		if p.id == "" {
			continue
		}
		parent := parentIDOf(p.id)
		if parent == "" {
			parent = "index"
		}
		// Only attach when the parent ID is also known so we don't
		// emit dangling section refs for orphan files.
		if parent != p.id && knownIDs[parent] {
			childrenOf[parent] = append(childrenOf[parent], p.id)
		}
	}
	// Keep child lists deterministic.
	for k := range childrenOf {
		sort.Strings(childrenOf[k])
	}

	for _, p := range allPages {
		node, warn := buildNode(p, childrenOf[p.id])
		if warn != "" {
			res.Warnings = append(res.Warnings, warn)
		}
		res.Nodes = append(res.Nodes, node)
	}

	siteName := a.SiteName
	if siteName == "" {
		if cfg.Title != "" {
			siteName = cfg.Title
		} else {
			siteName = filepath.Base(abs)
		}
	}
	indexURL := a.IndexURL
	if indexURL == "" {
		indexURL = "/act/index.json"
	}
	nodeTemplate := a.NodeURLTemplate
	if nodeTemplate == "" {
		nodeTemplate = "/act/nodes/{id}.json"
	}
	etagTrue := true
	res.Manifest = &core.Manifest{
		ACTVersion: "0.2",
		Site: core.Site{
			Name:         siteName,
			CanonicalURL: cfg.BaseURL,
			Locale:       cfg.DefaultContentLanguage,
		},
		IndexURL:        indexURL,
		NodeURLTemplate: nodeTemplate,
		Generator:       "act-hugo-go/0.2",
		Conformance:     core.Conformance{Level: core.ConformanceCore},
		Delivery:        core.DeliveryStatic,
		Capabilities:    &core.Capabilities{Etag: &etagTrue},
	}
	return res, nil
}

// parentIDOf returns the ID of the section that contains id. The synthetic
// root node has id "index" and is never the result of this function (it
// is returned as the empty string so callers can map "" → "index" once at
// the call site). For "posts/2026/intro" the parent is "posts/2026"; for
// "posts" the parent is "" (the synthetic root).
func parentIDOf(id string) string {
	i := strings.LastIndex(id, "/")
	if i <= 0 {
		return ""
	}
	return id[:i]
}

// buildNode translates a hugoPage into a core.Node envelope. Never
// returns nil. The string return is a non-fatal warning surfaced via
// Result.Warnings.
func buildNode(p *hugoPage, children []string) (*core.Node, string) {
	warn := ""
	id := p.id
	if id == "" {
		id = "index"
	}
	nodeType := p.frontMatter.stringOr("type", "")
	if nodeType == "" {
		if p.isSection {
			nodeType = "section"
		} else {
			nodeType = "article"
		}
	}
	title := p.frontMatter.stringOr("title", "")
	if title == "" {
		// fall back to derived ID's last segment, capitalised.
		seg := id
		if i := strings.LastIndex(seg, "/"); i >= 0 {
			seg = seg[i+1:]
		}
		title = strings.Title(seg) //nolint:staticcheck // good-enough fallback
	}
	summary := p.frontMatter.stringOr("summary", "")
	summarySource := ""
	if summary == "" {
		summary = extractSummary(p.body)
		if summary != "" {
			summarySource = "extracted"
		}
	} else {
		summarySource = "author"
	}
	if summary == "" {
		summary = title
	}

	body := p.body
	content := []core.ContentBlock{}
	if strings.TrimSpace(body) != "" {
		content = append(content, core.ContentBlock{
			Type: "prose",
			Extra: map[string]any{
				"format": "markdown",
				"text":   body,
			},
		})
	}

	tokens := core.Tokens{Summary: roughTokens(summary)}
	bodyTokens := roughTokens(body)
	tokens.Body = &bodyTokens

	metadata := map[string]any{}
	for k, v := range p.frontMatter.extras() {
		metadata[k] = v
	}
	metadata["source"] = map[string]any{
		"adapter":     "act-hugo-go",
		"source_id":   p.relPath,
		"source_path": p.absPath,
	}
	metadata["locale"] = p.locale
	if !p.isSection {
		// Per spec: extracted via filesystem walk.
		metadata["extracted_via"] = "filesystem"
	}

	node := &core.Node{
		ACTVersion: "0.2",
		ID:         id,
		Type:       nodeType,
		Title:      title,
		Summary:    summary,
		Content:    content,
		Tokens:     tokens,
		Metadata:   metadata,
		// Etag is derived elsewhere (the generator owns ETag emission per
		// PRD-103); placeholder here to satisfy the schema's "required"
		// shape, mirroring the TS markdown adapter.
		Etag: "placeholder",
	}
	if summarySource != "" {
		node.SummarySource = summarySource
	}
	if parent := parentIDOf(id); parent != "" {
		node.Parent = &parent
	} else if id != "index" {
		// Pages directly under content/ get the synthetic root as parent.
		root := "index"
		node.Parent = &root
	}
	if len(children) > 0 {
		node.Children = children
	}
	if updated, ok := p.frontMatter.data["date"].(string); ok {
		node.UpdatedAt = updated
	}
	if tags, ok := p.frontMatter.data["tags"].([]any); ok {
		// tags live in metadata; the schema's tags lives at IndexEntry,
		// not Node, so leave that to the index emitter.
		metadata["tags"] = tags
	}
	return node, warn
}

// extractSummary returns the first non-empty paragraph of body, trimmed
// of inline markdown emphasis. Mirrors the TS markdown adapter's
// extractSummary so Hugo and Markdown adapters produce comparable
// summaries when fed the same prose.
func extractSummary(body string) string {
	lines := strings.Split(body, "\n")
	paragraph := []string{}
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			if len(paragraph) > 0 {
				break
			}
			continue
		}
		if strings.HasPrefix(line, "<!--") {
			continue
		}
		if strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "```") {
			continue
		}
		paragraph = append(paragraph, line)
	}
	text := strings.TrimSpace(strings.Join(paragraph, " "))
	// strip simple inline markers
	text = stripInline(text)
	return text
}

// stripInline removes common markdown emphasis markers from a one-line
// summary. Not exhaustive; covers the same cases the TS markdown
// adapter handles.
func stripInline(s string) string {
	for _, pair := range [][2]string{{"**", "**"}, {"*", "*"}, {"`", "`"}} {
		s = stripPair(s, pair[0], pair[1])
	}
	return s
}

func stripPair(s, open, close string) string {
	out := strings.Builder{}
	i := 0
	for i < len(s) {
		if strings.HasPrefix(s[i:], open) {
			j := strings.Index(s[i+len(open):], close)
			if j >= 0 {
				out.WriteString(s[i+len(open) : i+len(open)+j])
				i = i + len(open) + j + len(close)
				continue
			}
		}
		out.WriteByte(s[i])
		i++
	}
	return out.String()
}

// roughTokens returns a whitespace-delimited word count. The adapter
// leaves real tokenisation to a later runbook item; the spec only
// requires `tokens.summary` to be a non-negative integer.
func roughTokens(s string) int {
	if strings.TrimSpace(s) == "" {
		return 0
	}
	return len(strings.Fields(s))
}
