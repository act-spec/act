package core

import "encoding/json"

// ContentBlock is one entry in a node's `content` array. The schema requires
// only the `type` discriminator and leaves the rest open
// (additionalProperties: true). The Type field carries the discriminator;
// Extra carries every remaining property so callers can introspect /
// re-marshal without losing data.
type ContentBlock struct {
	Type  string         `json:"-"`
	Extra map[string]any `json:"-"`
}

// MarshalJSON re-emits the content block as a single flat object with
// `type` plus whatever additional properties were carried.
func (b ContentBlock) MarshalJSON() ([]byte, error) {
	out := make(map[string]any, len(b.Extra)+1)
	for k, v := range b.Extra {
		out[k] = v
	}
	out["type"] = b.Type
	return json.Marshal(out)
}

// UnmarshalJSON pulls `type` into the typed field and stashes the rest
// under Extra. Unknown keys are tolerated (forward-compatible extensibility).
func (b *ContentBlock) UnmarshalJSON(data []byte) error {
	raw := map[string]any{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if t, ok := raw["type"].(string); ok {
		b.Type = t
	}
	delete(raw, "type")
	b.Extra = raw
	return nil
}

// Node mirrors /schemas/100/node.schema.json. Required fields: act_version,
// id, type, title, etag, summary, content, tokens.
//
// Parent is modelled as a *string so the JSON `null` form (allowed by the
// schema's oneOf) round-trips, matching IndexEntry.Parent.
type Node struct {
	ACTVersion    string         `json:"act_version"`
	ID            string         `json:"id"`
	Type          string         `json:"type"`
	Title         string         `json:"title"`
	Etag          string         `json:"etag"`
	UpdatedAt     string         `json:"updated_at,omitempty"`
	Summary       string         `json:"summary"`
	SummarySource string         `json:"summary_source,omitempty"`
	Abstract      string         `json:"abstract,omitempty"`
	Content       []ContentBlock `json:"content"`
	Tokens        Tokens         `json:"tokens"`
	Parent        *string        `json:"parent,omitempty"`
	Children      []string       `json:"children,omitempty"`
	Related       []RelatedRef   `json:"related,omitempty"`
	Source        *Source        `json:"source,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
}
