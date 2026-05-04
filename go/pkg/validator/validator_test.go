package validator

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// fixturesDir returns the absolute path of the repo's fixtures/ directory.
func fixturesDir(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	// wd = .../go/pkg/validator
	return filepath.Join(wd, "..", "..", "..", "fixtures")
}

// schemasDir returns the absolute path of the repo's schemas/ directory.
func schemasDir(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	return filepath.Join(wd, "..", "..", "..", "schemas")
}

// integrationOnly is the Go-side mirror of the TS validator's INTEGRATION_ONLY
// set in packages/validator/conformance.ts. These fixtures either:
//   - are HTTP/transport transcripts rather than envelope JSON, or
//   - exercise rules (children-cycle detection, etag derivation) that are not
//     expressible at the JSON Schema layer and live in the cross-cutting
//     validator surface (not yet ported to Go for v0.2-rc.1).
//
// Skipping these here keeps the Go validator's structural-parity surface
// honest: every non-skipped fixture must agree with its declared polarity.
var integrationOnly = map[string]struct{}{
	"100/negative/node-children-cycle.json": {},
	// 102 block-* fixtures are content-block fragments, not full envelopes.
	"102/positive/block-callout.json":                      {},
	"102/positive/block-code.json":                         {},
	"102/positive/block-data.json":                         {},
	"102/positive/block-markdown.json":                     {},
	"102/positive/block-marketing-faq.json":                {},
	"102/positive/block-marketing-feature-grid.json":       {},
	"102/positive/block-marketing-hero.json":               {},
	"102/positive/block-marketing-placeholder-failed.json": {},
	"102/positive/block-marketing-pricing-table.json":      {},
	"102/positive/block-marketing-testimonial.json":        {},
	"102/positive/block-prose.json":                        {},
	"102/negative/block-callout-bad-level.json":            {},
	"102/negative/block-code-missing-language.json":        {},
	"102/negative/block-data-html-as-content.json":         {},
	"102/negative/block-data-missing-text.json":            {},
	"102/negative/block-marketing-bad-namespace.json":      {},
	"102/negative/block-summary-source-bad-shape.json":     {},
	// 102 node-level fixtures whose etag values predate the strict s256
	// admit-list (PRD-103-R3); the structural shape DOES validate against
	// the node schema (the schema does not enforce the s256 admit-list),
	// but since the TS conformance harness treats them as integration-only
	// we mirror that here to avoid divergence.
	"102/positive/node-variant-base.json":               {},
	"102/positive/node-variant.json":                    {},
	"102/positive/node-with-related-cycle.json":         {},
	"102/positive/node-with-summary-source-author.json": {},
	"102/positive/node-with-summary-source-llm.json":    {},
	"102/negative/node-variant-bad-key.json":            {},
	// PRD-102 second copy of the cycle case — same integration-only treatment.
	"102/negative/node-children-cycle.json": {},
	// PRD-103 negative fixture wraps the node payload under `envelope` and
	// declares `expected_finding` at the wrapper layer; not a top-level
	// envelope itself. Cross-cutting probe surface, not structural.
	"103/negative/node-missing-etag.json": {},
	// PRD-105 fixture is an HTTP-state transcript (manifest_excerpt + index_excerpt
	// + filesystem_state). Probed by the static-profile suite, not by the
	// envelope sweep.
	"105/negative/index-references-missing-node-file.json": {},
}

// dispatchEnvelope picks an envelope from a fixture filename. Returns the
// empty Envelope when the file does not match one of manifest/index/node.
func dispatchEnvelope(name string) Envelope {
	switch {
	case strings.HasPrefix(name, "manifest-"):
		return EnvelopeManifest
	case strings.HasPrefix(name, "index-"):
		return EnvelopeIndex
	case strings.HasPrefix(name, "node-"):
		return EnvelopeNode
	}
	return ""
}

// stripFixtureMeta removes `_*` and `expected_*` top-level keys before
// re-serialising for validation. The TS harness does the same; the schemas
// do not declare these keys, but most envelopes leave additionalProperties
// open so they would pass anyway. Stripping keeps the Go-side error
// inventory minimal and identical to what the TS validator sees.
func stripFixtureMeta(raw []byte) ([]byte, error) {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, err
	}
	for k := range obj {
		if strings.HasPrefix(k, "_") || strings.HasPrefix(k, "expected_") {
			delete(obj, k)
		}
	}
	return json.Marshal(obj)
}

// fixtureCase is one positive- or negative-polarity envelope fixture.
type fixtureCase struct {
	rel      string // path relative to fixtures/
	polarity string // "positive" or "negative"
	envelope Envelope
}

// gatherFixtures walks fixtures/{NNN}/{positive,negative}/*.json and returns
// the ones that map to a top-level envelope (manifest/index/node) and are
// not in the integration-only skip set.
func gatherFixtures(t *testing.T) []fixtureCase {
	t.Helper()
	root := fixturesDir(t)
	var out []fixtureCase
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".json") {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		// Use forward slashes for stable cross-platform keys.
		rel = filepath.ToSlash(rel)
		if _, skip := integrationOnly[rel]; skip {
			return nil
		}
		parts := strings.Split(rel, "/")
		if len(parts) != 3 {
			return nil
		}
		polarity := parts[1]
		if polarity != "positive" && polarity != "negative" {
			return nil
		}
		env := dispatchEnvelope(parts[2])
		if env == "" {
			return nil
		}
		out = append(out, fixtureCase{rel: rel, polarity: polarity, envelope: env})
		return nil
	})
	if err != nil {
		t.Fatalf("walk fixtures: %v", err)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].rel < out[j].rel })
	return out
}

func TestNew_DefaultSchemasDir(t *testing.T) {
	v, err := New("")
	if err != nil {
		t.Fatalf("New(\"\"): %v", err)
	}
	if v.manifest == nil || v.index == nil || v.node == nil {
		t.Fatal("expected all three top-level schemas to compile")
	}
}

func TestNew_ExplicitSchemasDir(t *testing.T) {
	v, err := New(schemasDir(t))
	if err != nil {
		t.Fatalf("New(schemasDir): %v", err)
	}
	if v == nil {
		t.Fatal("nil validator")
	}
}

func TestNew_BadSchemasDir(t *testing.T) {
	_, err := New(filepath.Join(t.TempDir(), "does-not-exist"))
	if err == nil {
		t.Fatal("expected error for missing schemas dir")
	}
}

func TestValidate_ParseError(t *testing.T) {
	v, err := New(schemasDir(t))
	if err != nil {
		t.Fatal(err)
	}
	_, vErr := v.ValidateManifest([]byte(`{not json`))
	if vErr == nil {
		t.Fatal("expected parse error")
	}
}

func TestValidate_AllFixtures(t *testing.T) {
	v, err := New(schemasDir(t))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	cases := gatherFixtures(t)
	if len(cases) == 0 {
		t.Fatal("no fixtures gathered — wiring problem")
	}
	t.Logf("validating %d fixtures", len(cases))

	var positives, negatives, failures int
	var failed []string

	for _, c := range cases {
		c := c
		t.Run(c.rel, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(fixturesDir(t), c.rel))
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			body, err := stripFixtureMeta(raw)
			if err != nil {
				t.Fatalf("strip meta: %v", err)
			}
			var report *ValidationReport
			switch c.envelope {
			case EnvelopeManifest:
				report, err = v.ValidateManifest(body)
			case EnvelopeIndex:
				report, err = v.ValidateIndex(body)
			case EnvelopeNode:
				report, err = v.ValidateNode(body)
			}
			if err != nil {
				t.Fatalf("validate: %v", err)
			}
			switch c.polarity {
			case "positive":
				positives++
				if !report.Valid {
					failures++
					failed = append(failed, c.rel)
					t.Errorf("expected positive fixture to validate; errors:\n%s",
						formatErrors(report.Errors))
				}
			case "negative":
				negatives++
				if report.Valid {
					failures++
					failed = append(failed, c.rel)
					t.Errorf("expected negative fixture to fail validation, but it passed")
				}
			}
		})
	}
	t.Logf("validated %d positive + %d negative fixtures (%d failures)", positives, negatives, failures)
}

// TestNegativeFixtureMeta_Sanity confirms every negative fixture we DO
// validate carries a `_fixture_meta.expected_error` block; if the corpus
// drifts and a negative loses its declared expectation, this test surfaces
// it before silently passing on a wrong-reason failure.
func TestNegativeFixtureMeta_Sanity(t *testing.T) {
	cases := gatherFixtures(t)
	missing := []string{}
	for _, c := range cases {
		if c.polarity != "negative" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(fixturesDir(t), c.rel))
		if err != nil {
			t.Fatalf("read %s: %v", c.rel, err)
		}
		var obj map[string]any
		if err := json.Unmarshal(raw, &obj); err != nil {
			t.Fatalf("parse %s: %v", c.rel, err)
		}
		fm, ok := obj["_fixture_meta"].(map[string]any)
		if !ok {
			missing = append(missing, c.rel+" (no _fixture_meta)")
			continue
		}
		if _, ok := fm["expected_error"]; !ok {
			missing = append(missing, c.rel+" (no expected_error)")
		}
	}
	if len(missing) > 0 {
		t.Errorf("negative fixtures missing _fixture_meta.expected_error:\n  %s",
			strings.Join(missing, "\n  "))
	}
}

func formatErrors(errs []ValidationError) string {
	if len(errs) == 0 {
		return "  (none)"
	}
	out := make([]string, 0, len(errs))
	for _, e := range errs {
		out = append(out, fmt.Sprintf("  %s [%s]: %s", e.Path, e.Keyword, e.Message))
	}
	return strings.Join(out, "\n")
}

// silence unused-import linter if we end up not using errors.New
var _ = errors.New
