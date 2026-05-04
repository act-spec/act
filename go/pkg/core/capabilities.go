package core

// Capabilities is the closed structured-flag object on a manifest. The
// v0.1-draft array form is rejected; unknown keys are tolerated for
// forward-compatible extensibility (see Manifest.Extra for the round-trip
// channel).
type Capabilities struct {
	Etag        *bool             `json:"etag,omitempty"`
	Subtree     *bool             `json:"subtree,omitempty"`
	NDJSONIndex *bool             `json:"ndjson_index,omitempty"`
	Search      *SearchCapability `json:"search,omitempty"`
	ChangeFeed  *bool             `json:"change_feed,omitempty"`
}

// SearchCapability declares the optional search-related flags.
type SearchCapability struct {
	TemplateAdvertised *bool `json:"template_advertised,omitempty"`
}

// Policy is the optional manifest sub-object. All fields are optional and
// informational.
type Policy struct {
	RobotsRespected *bool  `json:"robots_respected,omitempty"`
	RateLimitPerMin *int   `json:"rate_limit_per_minute,omitempty"`
	Contact         string `json:"contact,omitempty"`
}

// Stats carries optional manifest-level counts.
type Stats struct {
	NodeCount          *int `json:"node_count,omitempty"`
	TotalTokensFull    *int `json:"total_tokens_full,omitempty"`
	TotalTokensSummary *int `json:"total_tokens_summary,omitempty"`
}
