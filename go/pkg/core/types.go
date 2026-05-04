// Package core carries the ACT v0.2 wire-format Go types. The structs in this
// package mirror the JSON Schemas under /schemas/ at the repo root and the
// hand-written TypeScript types under packages/core/src/. They are intended
// to be the canonical Go-side representation for marshal / unmarshal of ACT
// envelopes (manifest, index, node, subtree, error).
//
// Authoring rules:
//   - JSON tags use the wire-format casing (snake_case for ACT fields), so
//     callers should NOT rename tags without checking the matching schema.
//   - All fields are pointer/`omitempty` where the schema marks them optional,
//     so a zero-value struct round-trips cleanly.
//   - The structs carry `Extra map[string]any` for envelopes whose schemas
//     leave additionalProperties open per PRD-108-R7. Decoding into the typed
//     fields plus a separate generic decode is the caller's job; the typed
//     surface here aims at common code paths.
package core

// Version is the ACT spec version this Go package targets. Used by the CLI
// stub and by tooling that wants to identify the implementation flavour.
//
// The spec field `act_version` carried inside envelopes (e.g. manifest.act_version)
// is independent — it identifies the wire-format version, not this
// implementation. Fixtures under /fixtures/ currently carry `"0.1"` because
// they predate v0.2; the Go validator accepts whatever the schemas accept.
const Version = "0.2.0-rc.1"

// Tokens is the shared `tokens` sub-object carried by node and index-entry
// envelopes. Per PRD-100, only `summary` is required; `abstract` and `body`
// are optional.
type Tokens struct {
	Summary  int  `json:"summary"`
	Abstract *int `json:"abstract,omitempty"`
	Body     *int `json:"body,omitempty"`
}

// Source captures the optional `source` sub-object on a node — pointers back
// to the human-facing URL and the canonical edit URL, where applicable.
type Source struct {
	HumanURL string `json:"human_url,omitempty"`
	EditURL  string `json:"edit_url,omitempty"`
}

// RelatedRef is one entry in a node's `related` array per PRD-102-R18. Both
// fields are required by the schema; cycles in the related graph are
// permitted (consumer-side cycle detection required).
type RelatedRef struct {
	ID       string `json:"id"`
	Relation string `json:"relation"`
}
