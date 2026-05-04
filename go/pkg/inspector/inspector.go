// Package inspector is the Go port of the @act-spec/inspector TypeScript
// package. It provides a single Walker entry point that fetches the
// well-known manifest at /.well-known/act.json, follows the advertised
// index URL, and walks per-node JSONs under the node URL template.
//
// The Walker honours the wire-format ETag contract (spec/v0.2/wire-format/etag.md):
// when a previous response carried an ETag, it is replayed as If-None-Match
// on the next request and a 304 response is treated as a cache hit (the
// previously-decoded body is returned without re-parsing).
//
// This file owns the Walker struct and its Run-once API. Cache shape
// lives in cache.go; the CLI wiring (subcommand surface) lives in cli.go.
package inspector

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Severity levels for Findings. Mirrors the TS Finding.severity union.
type Severity string

const (
	SeverityInfo  Severity = "info"
	SeverityWarn  Severity = "warn"
	SeverityError Severity = "error"
)

// Finding mirrors the @act-spec/inspector Finding shape: a stable
// kebab-case code, a human-readable message, and a severity. The Go
// surface omits the optional pointer field for v0.2 (no diff/changeset
// emission yet); add it when the diff subcommand is ported.
type Finding struct {
	Code     string   `json:"code"`
	Message  string   `json:"message"`
	Severity Severity `json:"severity"`
}

// NodeWalk is the per-node record emitted by Walker.WalkSite. Status is
// "ok" when the node JSON parsed cleanly (or was served fresh from the
// cache via 304); "error" otherwise. Findings carries any per-node
// diagnostics; the parent WalkResult.Findings aggregates everything.
type NodeWalk struct {
	ID       string    `json:"id"`
	Type     string    `json:"type"`
	Title    string    `json:"title,omitempty"`
	Etag     string    `json:"etag,omitempty"`
	URL      string    `json:"url"`
	Status   string    `json:"status"`
	CacheHit bool      `json:"cache_hit"`
	Findings []Finding `json:"findings,omitempty"`
}

// WalkSummary mirrors the TS walk_summary sub-object: a count of HTTP
// requests issued and elapsed milliseconds for the whole invocation.
type WalkSummary struct {
	RequestsMade int   `json:"requests_made"`
	ElapsedMs    int64 `json:"elapsed_ms"`
}

// WalkResult is the top-level return shape of Walker.WalkSite.
//
// Manifest is the decoded /.well-known/act.json body as a generic map so
// callers can introspect spec-version-spanning fields without the Go
// validator's strict-typed surface getting in the way. IndexEntries is
// the decoded /act/index.json `nodes` array. Nodes is the per-node walk
// outcome, in index order. Findings aggregates every diagnostic; Summary
// reports request count and elapsed time.
type WalkResult struct {
	URL          string           `json:"url"`
	ManifestURL  string           `json:"manifest_url"`
	Manifest     map[string]any   `json:"manifest"`
	IndexURL     string           `json:"index_url,omitempty"`
	IndexEntries []map[string]any `json:"index_entries"`
	Nodes        []NodeWalk       `json:"nodes"`
	Findings     []Finding        `json:"findings"`
	Summary      WalkSummary      `json:"walk_summary"`
}

// Walker performs a single discovery walk against an ACT site.
//
// Construct via NewWalker; the zero value is not safe to use because the
// HTTP client and cache must be wired. Walker is goroutine-safe for
// concurrent WalkSite calls only when each call uses a distinct context
// and the underlying HTTPClient is goroutine-safe (the default
// http.Client is).
type Walker struct {
	HTTPClient *http.Client
	Cache      *Cache

	// MaxNodes caps how many index entries are walked in a single
	// invocation. Zero means no cap (walk every entry).
	MaxNodes int

	// UserAgent is sent on every request. Defaults to "actree-inspector/0.2".
	UserAgent string
}

// NewWalker returns a Walker with a sensible default HTTP client (10s
// per-request timeout) and a fresh in-memory cache. Override fields on
// the returned struct for non-default behaviour.
func NewWalker() *Walker {
	return &Walker{
		HTTPClient: &http.Client{Timeout: 10 * time.Second},
		Cache:      NewCache(),
		UserAgent:  "actree-inspector/0.2",
	}
}

// resolveManifestURL mirrors @act-spec/inspector http.resolveManifestUrl:
// if input already ends in /.well-known/act.json (or is the manifest URL
// itself), it is returned unchanged; otherwise the well-known suffix is
// appended to the origin.
func resolveManifestURL(input string) (string, error) {
	u, err := url.Parse(input)
	if err != nil {
		return "", fmt.Errorf("inspector: parse url %q: %w", input, err)
	}
	if u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("inspector: url %q must include scheme and host", input)
	}
	if strings.HasSuffix(u.Path, "/.well-known/act.json") {
		return u.String(), nil
	}
	// Strip any path; manifest lives at the origin's well-known.
	u.Path = "/.well-known/act.json"
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

// resolveAgainst joins href against base. Absolute hrefs win; relative
// hrefs resolve against the base URL per RFC 3986. Mirrors the TS
// resolveUrlAgainst helper.
func resolveAgainst(base, href string) (string, error) {
	if href == "" {
		return "", fmt.Errorf("inspector: empty href")
	}
	bu, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	hu, err := url.Parse(href)
	if err != nil {
		return "", err
	}
	return bu.ResolveReference(hu).String(), nil
}

// substituteID mirrors the TS substituteId: replaces the literal token
// `{id}` in the template (the node_url_template / subtree_url_template
// placeholder syntax defined in spec/v0.2/wire-format/manifest.md).
func substituteID(template, id string) string {
	return strings.ReplaceAll(template, "{id}", id)
}

// WalkSite performs the full walk. Steps:
//
//  1. Resolve baseURL → manifest URL (well-known suffix).
//  2. GET the manifest. On 401/403/4xx/5xx record a finding and return
//     a WalkResult whose Manifest is nil. Honour cached ETag with
//     If-None-Match; 304 hits short-circuit body decode.
//  3. Read index_url + node_url_template from the decoded manifest.
//  4. GET the index; decode the `nodes` array.
//  5. For each entry (capped at MaxNodes), GET the per-node JSON, again
//     honouring ETag. Record the per-node outcome.
//
// Returns a non-nil error only on context cancellation or programmer
// misuse (malformed input URL); transport, decode, and HTTP status
// failures are recorded as findings on the returned WalkResult.
func (w *Walker) WalkSite(ctx context.Context, baseURL string) (*WalkResult, error) {
	start := time.Now()
	requests := 0

	manifestURL, err := resolveManifestURL(baseURL)
	if err != nil {
		return nil, err
	}

	res := &WalkResult{
		URL:          baseURL,
		ManifestURL:  manifestURL,
		IndexEntries: []map[string]any{},
		Nodes:        []NodeWalk{},
		Findings:     []Finding{},
	}

	manifestBody, manifestHit, err := w.fetchJSON(ctx, manifestURL, w.Cache.LookupManifest, func(url string, body []byte, etag string) {
		w.Cache.RememberManifest(url, body, etag)
	})
	requests++
	if err != nil {
		// Distinguish HTTP-status errors from transport/parse so the
		// finding code matches the TS surface (manifest-fetch-failed,
		// endpoint-404, manifest-parse-error).
		res.Findings = append(res.Findings, classifyManifestError(manifestURL, err))
		res.Summary = WalkSummary{RequestsMade: requests, ElapsedMs: time.Since(start).Milliseconds()}
		return res, nil
	}
	res.Manifest = manifestBody
	_ = manifestHit

	indexURL, _ := manifestBody["index_url"].(string)
	nodeTemplate, _ := manifestBody["node_url_template"].(string)
	if indexURL == "" {
		res.Findings = append(res.Findings, Finding{
			Code:     "endpoint-404",
			Message:  "manifest does not advertise index_url.",
			Severity: SeverityError,
		})
		res.Summary = WalkSummary{RequestsMade: requests, ElapsedMs: time.Since(start).Milliseconds()}
		return res, nil
	}
	resolvedIndex, err := resolveAgainst(manifestURL, indexURL)
	if err != nil {
		res.Findings = append(res.Findings, Finding{
			Code:     "index-fetch-failed",
			Message:  fmt.Sprintf("resolve index_url %q against %q: %v", indexURL, manifestURL, err),
			Severity: SeverityError,
		})
		res.Summary = WalkSummary{RequestsMade: requests, ElapsedMs: time.Since(start).Milliseconds()}
		return res, nil
	}
	res.IndexURL = resolvedIndex

	indexBody, _, err := w.fetchJSON(ctx, resolvedIndex, w.Cache.LookupNode, func(url string, body []byte, etag string) {
		w.Cache.RememberNode(url, body, etag)
	})
	requests++
	if err != nil {
		res.Findings = append(res.Findings, Finding{
			Code:     classifyEndpointCode(err),
			Message:  fmt.Sprintf("index unreachable: %s: %v", resolvedIndex, err),
			Severity: SeverityError,
		})
		res.Summary = WalkSummary{RequestsMade: requests, ElapsedMs: time.Since(start).Milliseconds()}
		return res, nil
	}

	entries, ok := indexBody["nodes"].([]any)
	if !ok {
		res.Findings = append(res.Findings, Finding{
			Code:     "index-parse-error",
			Message:  fmt.Sprintf("index at %s missing nodes[] array.", resolvedIndex),
			Severity: SeverityError,
		})
		res.Summary = WalkSummary{RequestsMade: requests, ElapsedMs: time.Since(start).Milliseconds()}
		return res, nil
	}

	for i, raw := range entries {
		if w.MaxNodes > 0 && i >= w.MaxNodes {
			break
		}
		entry, ok := raw.(map[string]any)
		if !ok {
			res.Findings = append(res.Findings, Finding{
				Code:     "index-parse-error",
				Message:  fmt.Sprintf("index entry %d not an object.", i),
				Severity: SeverityError,
			})
			continue
		}
		res.IndexEntries = append(res.IndexEntries, entry)

		id, _ := entry["id"].(string)
		etype, _ := entry["type"].(string)
		title, _ := entry["title"].(string)

		if nodeTemplate == "" {
			// No template → degrade to index-derived metadata.
			etag, _ := entry["etag"].(string)
			res.Nodes = append(res.Nodes, NodeWalk{
				ID:     id,
				Type:   etype,
				Title:  title,
				Etag:   etag,
				URL:    "",
				Status: "ok",
			})
			continue
		}

		nodeURL, err := resolveAgainst(manifestURL, substituteID(nodeTemplate, id))
		if err != nil {
			res.Nodes = append(res.Nodes, NodeWalk{
				ID:     id,
				Type:   etype,
				Title:  title,
				Status: "error",
				Findings: []Finding{{
					Code:     "node-fetch-failed",
					Message:  fmt.Sprintf("resolve node url for %q: %v", id, err),
					Severity: SeverityError,
				}},
			})
			continue
		}

		nodeBody, hit, err := w.fetchJSON(ctx, nodeURL, w.Cache.LookupNode, func(url string, body []byte, etag string) {
			w.Cache.RememberNode(url, body, etag)
		})
		requests++
		if err != nil {
			f := Finding{
				Code:     classifyEndpointCode(err),
				Message:  fmt.Sprintf("node %s: %v", id, err),
				Severity: SeverityError,
			}
			res.Nodes = append(res.Nodes, NodeWalk{
				ID:       id,
				Type:     etype,
				Title:    title,
				URL:      nodeURL,
				Status:   "error",
				Findings: []Finding{f},
			})
			res.Findings = append(res.Findings, f)
			continue
		}
		etag, _ := nodeBody["etag"].(string)
		nTitle, _ := nodeBody["title"].(string)
		if nTitle == "" {
			nTitle = title
		}
		nType, _ := nodeBody["type"].(string)
		if nType == "" {
			nType = etype
		}
		res.Nodes = append(res.Nodes, NodeWalk{
			ID:       id,
			Type:     nType,
			Title:    nTitle,
			Etag:     etag,
			URL:      nodeURL,
			Status:   "ok",
			CacheHit: hit,
		})
	}

	res.Summary = WalkSummary{RequestsMade: requests, ElapsedMs: time.Since(start).Milliseconds()}
	return res, nil
}

// httpStatusError is returned by fetchJSON when the server responds with
// a non-2xx (and non-304) status. The numeric Status lets callers map to
// finding codes (404 → endpoint-404, 401 → auth-required, etc.).
type httpStatusError struct {
	Status int
	URL    string
}

func (e *httpStatusError) Error() string {
	return fmt.Sprintf("HTTP %d from %s", e.Status, e.URL)
}

// classifyManifestError maps a fetchJSON error to a kebab-case finding
// code that mirrors the TS inspector's discovery codes.
func classifyManifestError(manifestURL string, err error) Finding {
	if hse, ok := err.(*httpStatusError); ok {
		switch hse.Status {
		case http.StatusUnauthorized:
			return Finding{
				Code:     "auth-required",
				Message:  fmt.Sprintf("manifest at %s returned 401.", manifestURL),
				Severity: SeverityError,
			}
		case http.StatusNotFound:
			return Finding{
				Code:     "endpoint-404",
				Message:  fmt.Sprintf("manifest unreachable: %s returned HTTP 404.", manifestURL),
				Severity: SeverityError,
			}
		default:
			return Finding{
				Code:     "endpoint-404",
				Message:  fmt.Sprintf("manifest unreachable: %s returned HTTP %d.", manifestURL, hse.Status),
				Severity: SeverityError,
			}
		}
	}
	if _, ok := err.(*jsonDecodeError); ok {
		return Finding{
			Code:     "manifest-parse-error",
			Message:  fmt.Sprintf("manifest at %s is not valid JSON: %v", manifestURL, err),
			Severity: SeverityError,
		}
	}
	return Finding{
		Code:     "manifest-fetch-failed",
		Message:  fmt.Sprintf("manifest fetch failed for %s: %v", manifestURL, err),
		Severity: SeverityError,
	}
}

// classifyEndpointCode picks a finding code for index/node fetch failures.
func classifyEndpointCode(err error) string {
	if hse, ok := err.(*httpStatusError); ok {
		_ = hse
		return "endpoint-404"
	}
	if _, ok := err.(*jsonDecodeError); ok {
		return "node-parse-error"
	}
	return "node-fetch-failed"
}

// jsonDecodeError wraps a JSON parse failure so the classifier can tell
// transport problems apart from body-format problems.
type jsonDecodeError struct {
	Err error
}

func (e *jsonDecodeError) Error() string { return e.Err.Error() }
func (e *jsonDecodeError) Unwrap() error { return e.Err }

// fetchJSON GETs url, honouring an If-None-Match round-trip via the
// supplied lookup function. On a 304 response, the cached body bytes are
// re-decoded and returned; cacheHit is true. On a 200 response, the new
// body is decoded, the cache is refreshed via remember, and cacheHit is
// false.
//
// lookup returns (cachedBody, etag, present). remember is invoked on
// every 200 response with the freshly-fetched bytes.
func (w *Walker) fetchJSON(
	ctx context.Context,
	url string,
	lookup func(string) ([]byte, string, bool),
	remember func(string, []byte, string),
) (map[string]any, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, false, err
	}
	if w.UserAgent != "" {
		req.Header.Set("User-Agent", w.UserAgent)
	}
	req.Header.Set("Accept", "application/json")

	var cachedBody []byte
	if lookup != nil {
		body, etag, ok := lookup(url)
		if ok && etag != "" {
			cachedBody = body
			req.Header.Set("If-None-Match", quoteETag(etag))
		}
	}

	resp, err := w.HTTPClient.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		if cachedBody == nil {
			// Cache miss but server said 304 — treat as a fetch failure
			// so callers don't silently see an empty body.
			return nil, false, &httpStatusError{Status: resp.StatusCode, URL: url}
		}
		decoded, err := decodeJSONObject(cachedBody)
		if err != nil {
			return nil, false, &jsonDecodeError{Err: err}
		}
		return decoded, true, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, false, &httpStatusError{Status: resp.StatusCode, URL: url}
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, false, err
	}
	decoded, err := decodeJSONObject(body)
	if err != nil {
		return nil, false, &jsonDecodeError{Err: err}
	}
	if remember != nil {
		etag := unquoteETag(resp.Header.Get("ETag"))
		if etag == "" {
			if e, ok := decoded["etag"].(string); ok {
				etag = e
			}
		}
		remember(url, body, etag)
	}
	return decoded, false, nil
}

// decodeJSONObject decodes JSON bytes into a generic map. Returns an
// error when the body is not a JSON object (manifest / index / node
// envelopes are always objects).
func decodeJSONObject(body []byte) (map[string]any, error) {
	var raw any
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	obj, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected JSON object at top level")
	}
	return obj, nil
}

// quoteETag returns the wire form of an ETag, ensuring exactly one pair
// of surrounding quotes (the schema-validated etag values omit them).
func quoteETag(etag string) string {
	if strings.HasPrefix(etag, "\"") && strings.HasSuffix(etag, "\"") {
		return etag
	}
	return "\"" + etag + "\""
}

// unquoteETag strips the wire-form double quotes from an ETag header
// value, leaving the bare token as it appears inside an ACT envelope.
func unquoteETag(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "W/")
	s = strings.TrimSpace(s)
	if len(s) >= 2 && strings.HasPrefix(s, "\"") && strings.HasSuffix(s, "\"") {
		return s[1 : len(s)-1]
	}
	return s
}
