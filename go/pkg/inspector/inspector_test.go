package inspector

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeSite assembles a minimal in-memory ACT site (well-known + index +
// nodes) so the walker can be exercised without touching the network.
// All endpoints return ETags so the conditional-request path can be
// covered too.
type fakeSite struct {
	mu           sync.Mutex
	manifest     string
	manifestETag string
	index        string
	indexETag    string
	nodes        map[string]string
	nodeETags    map[string]string

	hits map[string]int
}

func newFakeSite() *fakeSite {
	return &fakeSite{
		nodes:     map[string]string{},
		nodeETags: map[string]string{},
		hits:      map[string]int{},
	}
}

func (f *fakeSite) handler(t *testing.T) http.HandlerFunc {
	t.Helper()
	return func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.hits[r.URL.Path]++
		f.mu.Unlock()
		writeJSON := func(body, etag string) {
			if etag != "" {
				w.Header().Set("ETag", "\""+etag+"\"")
				if inm := r.Header.Get("If-None-Match"); inm == "\""+etag+"\"" {
					w.WriteHeader(http.StatusNotModified)
					return
				}
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(body))
		}
		switch {
		case r.URL.Path == "/.well-known/act.json":
			if f.manifest == "" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			writeJSON(f.manifest, f.manifestETag)
		case r.URL.Path == "/act/index.json":
			writeJSON(f.index, f.indexETag)
		case strings.HasPrefix(r.URL.Path, "/act/nodes/"):
			id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/act/nodes/"), ".json")
			body, ok := f.nodes[id]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			writeJSON(body, f.nodeETags[id])
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}
}

// happy path: well-known → index → two nodes, all with ETags. Walker
// reports both nodes as ok and aggregates no error findings.
func TestWalkSite_Happy(t *testing.T) {
	site := newFakeSite()
	site.manifest = `{
		"act_version": "0.2.0",
		"site": {"name": "demo"},
		"index_url": "/act/index.json",
		"node_url_template": "/act/nodes/{id}.json",
		"conformance": {"level": "core"},
		"delivery": "static"
	}`
	site.manifestETag = "abc"
	site.index = `{
		"act_version": "0.2.0",
		"nodes": [
			{"id": "alpha", "type": "doc", "title": "Alpha", "etag": "etag-alpha"},
			{"id": "beta",  "type": "doc", "title": "Beta",  "etag": "etag-beta"}
		]
	}`
	site.indexETag = "idx-1"
	site.nodes["alpha"] = `{"act_version":"0.2.0","id":"alpha","type":"doc","title":"Alpha","summary":"a","etag":"etag-alpha","content":[],"tokens":{"summary":1}}`
	site.nodeETags["alpha"] = "etag-alpha"
	site.nodes["beta"] = `{"act_version":"0.2.0","id":"beta","type":"doc","title":"Beta","summary":"b","etag":"etag-beta","content":[],"tokens":{"summary":1}}`
	site.nodeETags["beta"] = "etag-beta"

	srv := httptest.NewServer(site.handler(t))
	defer srv.Close()

	w := NewWalker()
	res, err := w.WalkSite(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("WalkSite: %v", err)
	}
	if res.Manifest == nil {
		t.Fatal("manifest should be populated")
	}
	if got, want := len(res.Nodes), 2; got != want {
		t.Fatalf("nodes: got %d want %d", got, want)
	}
	for i, n := range res.Nodes {
		if n.Status != "ok" {
			t.Errorf("node %d (%s): status %q want ok", i, n.ID, n.Status)
		}
		if n.CacheHit {
			t.Errorf("node %d (%s): unexpected cache hit on first walk", i, n.ID)
		}
	}
	if errCount := countSeverity(res.Findings, SeverityError); errCount != 0 {
		t.Errorf("expected 0 error findings, got %d: %+v", errCount, res.Findings)
	}
	if res.Summary.RequestsMade < 4 {
		t.Errorf("expected >= 4 requests (manifest+index+2 nodes), got %d", res.Summary.RequestsMade)
	}
}

// 404 on the manifest must surface as an endpoint-404 finding and yield
// a nil-ish WalkResult (no nodes walked).
func TestWalkSite_ManifestMissing(t *testing.T) {
	site := newFakeSite() // manifest empty → 404
	srv := httptest.NewServer(site.handler(t))
	defer srv.Close()

	w := NewWalker()
	res, err := w.WalkSite(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("WalkSite: %v", err)
	}
	if res.Manifest != nil {
		t.Errorf("manifest should be nil on 404, got %+v", res.Manifest)
	}
	if !findingPresent(res.Findings, "endpoint-404") {
		t.Errorf("expected endpoint-404 finding, got %+v", res.Findings)
	}
	if len(res.Nodes) != 0 {
		t.Errorf("expected no nodes on manifest-404, got %d", len(res.Nodes))
	}
}

// ETag round-trip: walk once to prime the cache, walk again with the
// same Walker (shared cache) and confirm the second walk's nodes are
// served from the 304 path (CacheHit=true).
func TestWalkSite_EtagRoundTrip(t *testing.T) {
	site := newFakeSite()
	site.manifest = `{
		"act_version": "0.2.0",
		"site": {"name": "demo"},
		"index_url": "/act/index.json",
		"node_url_template": "/act/nodes/{id}.json",
		"conformance": {"level": "core"},
		"delivery": "static"
	}`
	site.manifestETag = "m1"
	site.index = `{"act_version":"0.2.0","nodes":[{"id":"alpha","type":"doc","title":"A","etag":"ea"}]}`
	site.indexETag = "i1"
	site.nodes["alpha"] = `{"act_version":"0.2.0","id":"alpha","type":"doc","title":"A","summary":"x","etag":"ea","content":[],"tokens":{"summary":1}}`
	site.nodeETags["alpha"] = "ea"

	srv := httptest.NewServer(site.handler(t))
	defer srv.Close()

	w := NewWalker()
	if _, err := w.WalkSite(context.Background(), srv.URL); err != nil {
		t.Fatalf("first walk: %v", err)
	}
	res, err := w.WalkSite(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("second walk: %v", err)
	}
	if len(res.Nodes) != 1 {
		t.Fatalf("nodes: got %d want 1", len(res.Nodes))
	}
	if !res.Nodes[0].CacheHit {
		t.Errorf("expected cache hit on second walk; got %+v", res.Nodes[0])
	}
}

// Malformed JSON at the manifest endpoint must surface as a
// manifest-parse-error finding rather than a transport failure.
func TestWalkSite_ManifestMalformed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{not json`))
	}))
	defer srv.Close()

	w := NewWalker()
	res, err := w.WalkSite(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("WalkSite: %v", err)
	}
	if !findingPresent(res.Findings, "manifest-parse-error") {
		t.Errorf("expected manifest-parse-error, got %+v", res.Findings)
	}
}

// Cache TTL: a node entry expires after its TTL elapses; subsequent
// lookups miss and force a fresh fetch.
func TestCache_TTLExpiry(t *testing.T) {
	now := time.Now()
	c := NewCache()
	c.now = func() time.Time { return now }
	c.RememberNode("u", []byte("body"), "etag")
	if _, _, ok := c.LookupNode("u"); !ok {
		t.Fatal("expected fresh lookup to succeed")
	}
	now = now.Add(c.nodeTTL + time.Second)
	if _, _, ok := c.LookupNode("u"); ok {
		t.Error("expected expired lookup to miss")
	}
}

func TestRunInspect_HappyJSONOutput(t *testing.T) {
	site := newFakeSite()
	site.manifest = `{
		"act_version": "0.2.0",
		"site": {"name": "demo"},
		"index_url": "/act/index.json",
		"node_url_template": "/act/nodes/{id}.json",
		"conformance": {"level": "core"},
		"delivery": "static"
	}`
	site.index = `{"act_version":"0.2.0","nodes":[]}`
	srv := httptest.NewServer(site.handler(t))
	defer srv.Close()

	var buf bytes.Buffer
	code := RunInspect(context.Background(), &buf, srv.URL)
	if code != 0 {
		t.Fatalf("RunInspect exit: got %d want 0; output=%s", code, buf.String())
	}
	var decoded WalkResult
	if err := json.Unmarshal(buf.Bytes(), &decoded); err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if decoded.Manifest == nil {
		t.Errorf("expected manifest in output")
	}
}

func TestRunInspect_MissingURL(t *testing.T) {
	var buf bytes.Buffer
	if code := RunInspect(context.Background(), &buf, ""); code != 2 {
		t.Errorf("missing URL: exit %d want 2", code)
	}
}

func TestResolveManifestURL(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"https://example.com", "https://example.com/.well-known/act.json"},
		{"https://example.com/", "https://example.com/.well-known/act.json"},
		{"https://example.com/some/path", "https://example.com/.well-known/act.json"},
		{"https://example.com/.well-known/act.json", "https://example.com/.well-known/act.json"},
	}
	for _, c := range cases {
		got, err := resolveManifestURL(c.in)
		if err != nil {
			t.Errorf("%s: %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("%s: got %q want %q", c.in, got, c.want)
		}
	}
	if _, err := resolveManifestURL("not-a-url"); err == nil {
		t.Error("expected error for bare token")
	}
}

func countSeverity(findings []Finding, sev Severity) int {
	n := 0
	for _, f := range findings {
		if f.Severity == sev {
			n++
		}
	}
	return n
}

func findingPresent(findings []Finding, code string) bool {
	for _, f := range findings {
		if f.Code == code {
			return true
		}
	}
	return false
}

// suppress unused-import noise in the rare configuration where the
// stdlib fmt is not referenced by tests above.
var _ = fmt.Sprintf
