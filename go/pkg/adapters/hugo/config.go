// Hugo configuration discovery.
//
// Hugo accepts hugo.toml, hugo.yaml, hugo.json, and the legacy
// config.toml/.yaml/.json. We probe each in order and decode the
// fields the ACT mapping cares about: baseURL, defaultContentLanguage,
// title, and the `languages` table.

package hugo

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/BurntSushi/toml"
	"gopkg.in/yaml.v3"
)

// hugoConfig captures the slice of Hugo's configuration the adapter
// reads. The unparsed remainder is intentionally discarded — Hugo's
// settings space is enormous and the adapter only cares about the
// structural fields the ACT spec mentions.
type hugoConfig struct {
	BaseURL                string                    `json:"baseURL" toml:"baseURL" yaml:"baseURL"`
	DefaultContentLanguage string                    `json:"defaultContentLanguage" toml:"defaultContentLanguage" yaml:"defaultContentLanguage"`
	Title                  string                    `json:"title" toml:"title" yaml:"title"`
	Languages              map[string]map[string]any `json:"languages" toml:"languages" yaml:"languages"`
}

// Locales returns the configured locales sorted alphabetically. An
// empty slice means the site is single-language; the caller falls back
// to DefaultContentLanguage.
func (c *hugoConfig) Locales() []string {
	if len(c.Languages) == 0 {
		return nil
	}
	out := make([]string, 0, len(c.Languages))
	for k := range c.Languages {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// loadConfig probes for a Hugo config file under root and returns the
// decoded subset. Missing config returns a zero-value config with
// DefaultContentLanguage="en" so single-language sites without an
// explicit declaration still walk cleanly.
func loadConfig(root string) (*hugoConfig, error) {
	candidates := []struct {
		name    string
		decoder func([]byte, any) error
	}{
		{"hugo.toml", tomlUnmarshal},
		{"config.toml", tomlUnmarshal},
		{"hugo.yaml", yamlUnmarshal},
		{"hugo.yml", yamlUnmarshal},
		{"config.yaml", yamlUnmarshal},
		{"config.yml", yamlUnmarshal},
		{"hugo.json", json.Unmarshal},
		{"config.json", json.Unmarshal},
	}
	cfg := &hugoConfig{DefaultContentLanguage: "en"}
	for _, c := range candidates {
		path := filepath.Join(root, c.name)
		raw, err := os.ReadFile(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("read %s: %w", c.name, err)
		}
		if err := c.decoder(raw, cfg); err != nil {
			return nil, fmt.Errorf("parse %s: %w", c.name, err)
		}
		if cfg.DefaultContentLanguage == "" {
			cfg.DefaultContentLanguage = "en"
		}
		return cfg, nil
	}
	return cfg, nil
}

func tomlUnmarshal(data []byte, v any) error {
	return toml.Unmarshal(data, v)
}

func yamlUnmarshal(data []byte, v any) error {
	return yaml.Unmarshal(data, v)
}
