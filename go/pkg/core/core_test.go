package core

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// fixtureRoot returns the absolute path of the repo's fixtures/ directory by
// walking up from this test file. Relative path is `../../../fixtures/`.
func fixtureRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	// wd = .../go/pkg/core
	return filepath.Join(wd, "..", "..", "..", "fixtures")
}

// readFixture reads and JSON-decodes a fixture into a generic map for
// comparison.
func readFixture(t *testing.T, rel string) []byte {
	t.Helper()
	root := fixtureRoot(t)
	data, err := os.ReadFile(filepath.Join(root, rel))
	if err != nil {
		t.Fatalf("read fixture %s: %v", rel, err)
	}
	return data
}

// roundTripEqual marshals v back to JSON, decodes both sides into generic
// maps, and asserts deep equality. We compare structurally rather than
// byte-for-byte because field-ordering and whitespace are not part of the
// wire-format contract.
//
// We normalise two semantically-equivalent shapes before comparing:
//   - `parent: null` ≡ field absent (the schema allows either via oneOf)
//   - `children: []` ≡ field absent (the schema does not distinguish empty
//     from absent for round-trip purposes; PRD-100 carries no semantic
//     difference between the two).
//
// This keeps the typed Go surface ergonomic (omitempty on optional fields
// stays correct for emit) while still proving that no payload-bearing data
// is lost in round-trip.
func roundTripEqual(t *testing.T, original []byte, v any) {
	t.Helper()
	encoded, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var lhs, rhs any
	if err := json.Unmarshal(original, &lhs); err != nil {
		t.Fatalf("unmarshal original: %v", err)
	}
	if err := json.Unmarshal(encoded, &rhs); err != nil {
		t.Fatalf("unmarshal re-encoded: %v", err)
	}
	normalize(lhs)
	normalize(rhs)
	lb, _ := json.Marshal(lhs)
	rb, _ := json.Marshal(rhs)
	if !bytes.Equal(canonicalize(t, lb), canonicalize(t, rb)) {
		t.Fatalf("round-trip mismatch:\noriginal: %s\nre-encoded: %s", string(lb), string(rb))
	}
}

// normalize walks a decoded JSON value and drops fields that are
// semantically equivalent to "absent" per the round-trip rules above.
func normalize(v any) {
	switch x := v.(type) {
	case map[string]any:
		if p, ok := x["parent"]; ok && p == nil {
			delete(x, "parent")
		}
		if c, ok := x["children"]; ok {
			if arr, isArr := c.([]any); isArr && len(arr) == 0 {
				delete(x, "children")
			}
		}
		for _, vv := range x {
			normalize(vv)
		}
	case []any:
		for _, vv := range x {
			normalize(vv)
		}
	}
}

// canonicalize re-marshals via map sort to remove field-order noise.
func canonicalize(t *testing.T, b []byte) []byte {
	t.Helper()
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatalf("canonicalize: %v", err)
	}
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("canonicalize remarshal: %v", err)
	}
	return out
}

func TestVersionConstant(t *testing.T) {
	if Version == "" {
		t.Fatal("core.Version must be non-empty")
	}
	if Version != "0.2.0-rc.1" {
		t.Fatalf("core.Version = %q, want %q", Version, "0.2.0-rc.1")
	}
}

func TestConformanceLevelEnum(t *testing.T) {
	for _, lv := range []ConformanceLevel{ConformanceCore, ConformanceStandard, ConformanceStrict} {
		if !lv.Valid() {
			t.Errorf("level %q should be Valid()", lv)
		}
		if lv.String() != string(lv) {
			t.Errorf("String() mismatch: %q vs %q", lv.String(), string(lv))
		}
	}
	bad := ConformanceLevel("premium")
	if bad.Valid() {
		t.Errorf("level %q should NOT be Valid()", bad)
	}
}

func TestConformanceLevelUnmarshalRejectsBadEnum(t *testing.T) {
	var c ConformanceLevel
	if err := json.Unmarshal([]byte(`"premium"`), &c); err == nil {
		t.Fatal("expected error decoding bad conformance level")
	}
	if err := json.Unmarshal([]byte(`"strict"`), &c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c != ConformanceStrict {
		t.Fatalf("got %q want strict", c)
	}
}

func TestDeliveryModeUnmarshalRejectsBadEnum(t *testing.T) {
	var d DeliveryMode
	if err := json.Unmarshal([]byte(`"hybrid"`), &d); err == nil {
		t.Fatal("expected error decoding bad delivery mode")
	}
}

func TestManifestRoundTrip(t *testing.T) {
	data := readFixture(t, "100/positive/manifest-minimal-core.json")
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if m.ACTVersion != "0.1" {
		t.Errorf("ACTVersion = %q, want 0.1", m.ACTVersion)
	}
	if m.Site.Name != "Acme Tiny Docs" {
		t.Errorf("Site.Name = %q", m.Site.Name)
	}
	if m.Conformance.Level != ConformanceCore {
		t.Errorf("Conformance.Level = %q", m.Conformance.Level)
	}
	if m.Delivery != DeliveryStatic {
		t.Errorf("Delivery = %q", m.Delivery)
	}
	roundTripEqual(t, data, m)
}

func TestManifestFullRoundTrip(t *testing.T) {
	data := readFixture(t, "100/positive/manifest-full-strict-runtime.json")
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if m.Conformance.Level != ConformanceStrict {
		t.Errorf("Conformance.Level = %q", m.Conformance.Level)
	}
	if m.Delivery != DeliveryRuntime {
		t.Errorf("Delivery = %q", m.Delivery)
	}
	if m.Capabilities == nil || m.Capabilities.Etag == nil || !*m.Capabilities.Etag {
		t.Errorf("expected capabilities.etag=true")
	}
	roundTripEqual(t, data, m)
}

func TestIndexRoundTrip(t *testing.T) {
	data := readFixture(t, "100/positive/index-minimal.json")
	var idx Index
	if err := json.Unmarshal(data, &idx); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(idx.Nodes) != 2 {
		t.Fatalf("got %d nodes, want 2", len(idx.Nodes))
	}
	if idx.Nodes[0].ID != "intro" {
		t.Errorf("Nodes[0].ID = %q", idx.Nodes[0].ID)
	}
	roundTripEqual(t, data, idx)
}

func TestNodeMinimalRoundTrip(t *testing.T) {
	data := readFixture(t, "100/positive/node-minimal-core.json")
	var n Node
	if err := json.Unmarshal(data, &n); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if n.ID != "intro" {
		t.Errorf("ID = %q", n.ID)
	}
	if len(n.Content) != 1 {
		t.Fatalf("got %d content blocks", len(n.Content))
	}
	if n.Content[0].Type != "markdown" {
		t.Errorf("content[0].type = %q", n.Content[0].Type)
	}
	if got := n.Content[0].Extra["text"]; got == nil {
		t.Errorf("expected content[0].text to round-trip via Extra; got nil")
	}
	roundTripEqual(t, data, n)
}

func TestNodeFullRoundTrip(t *testing.T) {
	data := readFixture(t, "100/positive/node-full-strict.json")
	var n Node
	if err := json.Unmarshal(data, &n); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(n.Content) != 4 {
		t.Fatalf("got %d content blocks, want 4", len(n.Content))
	}
	if n.Content[3].Type != "marketing:cta" {
		t.Errorf("content[3].type = %q, want marketing:cta", n.Content[3].Type)
	}
	if len(n.Related) != 2 {
		t.Errorf("got %d related, want 2", len(n.Related))
	}
	roundTripEqual(t, data, n)
}
