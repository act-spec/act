package core

// Conformance is the closed sub-object carrying the conformance level.
// additionalProperties: false at the schema layer.
type Conformance struct {
	Level ConformanceLevel `json:"level"`
}

// Site carries identifying metadata about the publishing site.
type Site struct {
	Name         string `json:"name"`
	Description  string `json:"description,omitempty"`
	CanonicalURL string `json:"canonical_url,omitempty"`
	Locale       string `json:"locale,omitempty"`
	License      string `json:"license,omitempty"`
}

// MountConformance is the optional per-mount conformance sub-object.
type MountConformance struct {
	Level ConformanceLevel `json:"level"`
}

// Mount is one entry in the manifest's `mounts` array.
type Mount struct {
	Prefix      string            `json:"prefix"`
	Delivery    DeliveryMode      `json:"delivery"`
	ManifestURL string            `json:"manifest_url"`
	Conformance *MountConformance `json:"conformance,omitempty"`
}

// Manifest mirrors /schemas/100/manifest.schema.json. Required fields:
// act_version, site, index_url, node_url_template, conformance, delivery.
// additionalProperties is left open at the schema layer; callers that need
// to round-trip unknown top-level fields can decode twice (once into
// Manifest, once into a generic map).
type Manifest struct {
	ACTVersion         string        `json:"act_version"`
	Site               Site          `json:"site"`
	GeneratedAt        string        `json:"generated_at,omitempty"`
	Generator          string        `json:"generator,omitempty"`
	IndexURL           string        `json:"index_url"`
	IndexNDJSONURL     string        `json:"index_ndjson_url,omitempty"`
	NodeURLTemplate    string        `json:"node_url_template"`
	SubtreeURLTemplate string        `json:"subtree_url_template,omitempty"`
	SearchURLTemplate  string        `json:"search_url_template,omitempty"`
	RootID             string        `json:"root_id,omitempty"`
	Stats              *Stats        `json:"stats,omitempty"`
	Capabilities       *Capabilities `json:"capabilities,omitempty"`
	Conformance        Conformance   `json:"conformance"`
	Delivery           DeliveryMode  `json:"delivery"`
	Mounts             []Mount       `json:"mounts,omitempty"`
	Policy             *Policy       `json:"policy,omitempty"`
}
