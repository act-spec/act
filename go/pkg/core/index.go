package core

// IndexEntry mirrors the IndexEntry $defs sub-schema in
// /schemas/100/index.schema.json. Each entry summarises one node; the full
// content array is forbidden here (PRD-100-R18).
//
// Parent is modelled as a *string so the JSON `null` form (allowed by the
// schema's oneOf) round-trips: nil pointer means the field was absent or
// explicitly null, distinct from the empty-string degenerate. Most call
// sites should use the helper accessors; raw access is provided for cases
// that need to distinguish nil-vs-empty.
type IndexEntry struct {
	ID        string   `json:"id"`
	Type      string   `json:"type"`
	Title     string   `json:"title"`
	Path      []string `json:"path,omitempty"`
	Summary   string   `json:"summary"`
	Tokens    Tokens   `json:"tokens"`
	Etag      string   `json:"etag"`
	UpdatedAt string   `json:"updated_at,omitempty"`
	Parent    *string  `json:"parent,omitempty"`
	Children  []string `json:"children,omitempty"`
	Tags      []string `json:"tags,omitempty"`
}

// Index mirrors the top-level shape in /schemas/100/index.schema.json.
// Required fields per PRD-100-R17: act_version, nodes.
type Index struct {
	ACTVersion  string       `json:"act_version"`
	GeneratedAt string       `json:"generated_at,omitempty"`
	Etag        string       `json:"etag,omitempty"`
	Nodes       []IndexEntry `json:"nodes"`
}
