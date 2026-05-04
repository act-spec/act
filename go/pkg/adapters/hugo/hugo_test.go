package hugo

import (
	"context"
	"encoding/json"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/act-spec/act/go/pkg/core"
)

// fixturePath resolves the in-tree sample-site Hugo fixture.
func fixturePath(t *testing.T) string {
	t.Helper()
	return filepath.Join("testdata", "sample-site")
}

// Run against the bundled fixture and verify the manifest's spec-level
// fields plus the emitted nodes' titles, IDs, types, and locales.
func TestAdapter_Run_FixtureSite(t *testing.T) {
	a := &Adapter{}
	res, err := a.Run(context.Background(), fixturePath(t))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Manifest == nil {
		t.Fatal("expected manifest")
	}
	// Manifest sanity.
	if res.Manifest.Site.Name != "Sample Hugo Site" {
		t.Errorf("site.name: got %q", res.Manifest.Site.Name)
	}
	if res.Manifest.Site.CanonicalURL != "https://example.com/" {
		t.Errorf("site.canonical_url: got %q", res.Manifest.Site.CanonicalURL)
	}
	if res.Manifest.IndexURL != "/act/index.json" {
		t.Errorf("index_url: got %q", res.Manifest.IndexURL)
	}
	if res.Manifest.NodeURLTemplate != "/act/nodes/{id}.json" {
		t.Errorf("node_url_template: got %q", res.Manifest.NodeURLTemplate)
	}
	if res.Manifest.Conformance.Level != core.ConformanceCore {
		t.Errorf("conformance.level: got %q", res.Manifest.Conformance.Level)
	}
	if res.Manifest.Delivery != core.DeliveryStatic {
		t.Errorf("delivery: got %q", res.Manifest.Delivery)
	}

	// Group nodes by locale to make the assertions readable.
	byLocale := map[string][]*core.Node{}
	for _, n := range res.Nodes {
		loc, _ := n.Metadata["locale"].(string)
		byLocale[loc] = append(byLocale[loc], n)
	}
	if got, want := len(byLocale["en"]), 5; got != want {
		t.Errorf("en nodes: got %d want %d (%v)", got, want, idsOf(byLocale["en"]))
	}
	if got, want := len(byLocale["es"]), 2; got != want {
		t.Errorf("es nodes: got %d want %d (%v)", got, want, idsOf(byLocale["es"]))
	}

	// English IDs.
	wantEn := []string{"about", "index", "posts", "posts/post-1", "posts/post-2"}
	if got := idsOf(byLocale["en"]); !equalStrings(got, wantEn) {
		t.Errorf("en ids: got %v want %v", got, wantEn)
	}

	// Verify section vs leaf classification on the english tree.
	for _, n := range byLocale["en"] {
		switch n.ID {
		case "index", "posts":
			if n.Type != "section" {
				t.Errorf("%s: type %q want section", n.ID, n.Type)
			}
		case "posts/post-1":
			if n.Type != "article" {
				t.Errorf("%s: type %q want article (default)", n.ID, n.Type)
			}
		case "posts/post-2":
			if n.Type != "tutorial" {
				t.Errorf("%s: type %q want tutorial (front-matter override)", n.ID, n.Type)
			}
		case "about":
			if n.Type != "article" {
				t.Errorf("%s: type %q want article", n.ID, n.Type)
			}
		}
	}

	// Children flow: posts must list its leaves.
	posts := findNode(byLocale["en"], "posts")
	if posts == nil {
		t.Fatal("missing posts section")
	}
	wantChildren := []string{"posts/post-1", "posts/post-2"}
	if !equalStrings(posts.Children, wantChildren) {
		t.Errorf("posts.children: got %v want %v", posts.Children, wantChildren)
	}

	// Parent assignment: post-1's parent is posts.
	post1 := findNode(byLocale["en"], "posts/post-1")
	if post1 == nil || post1.Parent == nil || *post1.Parent != "posts" {
		t.Errorf("posts/post-1 parent: got %v want posts", post1.Parent)
	}

	// Title fallback chain: posts uses the front-matter title.
	if posts.Title != "Posts" {
		t.Errorf("posts.title: got %q want Posts", posts.Title)
	}
}

// JSON-roundtrip sanity: every emitted node must marshal cleanly under
// the wire-format JSON tags carried by core.Node.
func TestAdapter_Run_NodesMarshalJSON(t *testing.T) {
	a := &Adapter{}
	res, err := a.Run(context.Background(), fixturePath(t))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	for _, n := range res.Nodes {
		body, err := json.Marshal(n)
		if err != nil {
			t.Errorf("marshal %s: %v", n.ID, err)
			continue
		}
		if !json.Valid(body) {
			t.Errorf("marshal %s produced invalid JSON", n.ID)
		}
	}
}

// Smoke-test the per-front-matter-format detection by feeding a
// hand-rolled payload through parseFrontMatter directly.
func TestParseFrontMatter_AllFormats(t *testing.T) {
	cases := []struct {
		name, input, wantTitle, wantBody, wantFormat string
	}{
		{"yaml", "---\ntitle: Hi\n---\nbody\n", "Hi", "body\n", "yaml"},
		{"toml", "+++\ntitle = \"Hi\"\n+++\nbody\n", "Hi", "body\n", "toml"},
		{"json", "{\"title\":\"Hi\"}\nbody\n", "Hi", "body\n", "json"},
		{"none", "no frontmatter\n", "", "no frontmatter\n", "none"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			fm, body, err := parseFrontMatter(c.input)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			if fm.format != c.wantFormat {
				t.Errorf("format: got %q want %q", fm.format, c.wantFormat)
			}
			if got := fm.stringOr("title", ""); got != c.wantTitle {
				t.Errorf("title: got %q want %q", got, c.wantTitle)
			}
			if body != c.wantBody {
				t.Errorf("body: got %q want %q", body, c.wantBody)
			}
		})
	}
}

func TestParentIDOf(t *testing.T) {
	cases := []struct{ in, want string }{
		{"posts/post-1", "posts"},
		{"posts/2026/intro", "posts/2026"},
		{"about", ""},
		{"index", ""},
		{"", ""},
	}
	for _, c := range cases {
		if got := parentIDOf(c.in); got != c.want {
			t.Errorf("parentIDOf(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func idsOf(nodes []*core.Node) []string {
	out := make([]string, 0, len(nodes))
	for _, n := range nodes {
		out = append(out, n.ID)
	}
	sort.Strings(out)
	return out
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	aa := append([]string{}, a...)
	bb := append([]string{}, b...)
	sort.Strings(aa)
	sort.Strings(bb)
	return strings.Join(aa, "|") == strings.Join(bb, "|")
}

func findNode(nodes []*core.Node, id string) *core.Node {
	for _, n := range nodes {
		if n.ID == id {
			return n
		}
	}
	return nil
}
