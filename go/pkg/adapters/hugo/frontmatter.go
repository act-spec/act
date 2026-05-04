// Front-matter detection + parsing for Hugo files.
//
// Hugo accepts TOML (`+++`), YAML (`---`), or JSON (`{...}` at the file
// head). The adapter MUST recognise all three (spec §"Source content
// model"). After splitting the front-matter block from the body, the
// fenced bytes are decoded with the dialect-appropriate parser.

package hugo

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/BurntSushi/toml"
	"gopkg.in/yaml.v3"
)

// frontMatter wraps a decoded front-matter map with type-safe accessors.
// Recognised keys (per the Hugo adapter mapping) are pulled out by the
// node builder; everything else flows into metadata via extras().
type frontMatter struct {
	data   map[string]any
	format string // "yaml", "toml", "json", or "none"
}

// recognised carries the front-matter keys the adapter consumes
// directly. Anything else lands under metadata.
var recognised = map[string]struct{}{
	"id":             {},
	"type":           {},
	"title":          {},
	"summary":        {},
	"summary_source": {},
	"tags":           {},
	"date":           {},
	"weight":         {},
	"slug":           {},
	"translationKey": {},
}

// stringOr returns the string at key, or fallback when missing or non-string.
func (f *frontMatter) stringOr(key, fallback string) string {
	if f == nil || f.data == nil {
		return fallback
	}
	v, ok := f.data[key].(string)
	if !ok || v == "" {
		return fallback
	}
	return v
}

// extras returns every front-matter key that is NOT in `recognised`,
// preserving original types. Returned map is fresh; callers may mutate.
func (f *frontMatter) extras() map[string]any {
	out := map[string]any{}
	if f == nil {
		return out
	}
	for k, v := range f.data {
		if _, ok := recognised[k]; ok {
			continue
		}
		out[k] = v
	}
	return out
}

// parseFrontMatter splits source into (front-matter, body) and decodes
// the front matter. Returns a *frontMatter whose data is empty when
// source has no front matter.
func parseFrontMatter(source string) (*frontMatter, string, error) {
	source = strings.TrimPrefix(source, "\ufeff") // strip BOM
	switch {
	case strings.HasPrefix(source, "---\n"), strings.HasPrefix(source, "---\r\n"):
		fm, body, err := splitFenced(source, "---")
		if err != nil {
			return nil, source, err
		}
		data := map[string]any{}
		if err := yaml.Unmarshal([]byte(fm), &data); err != nil {
			return nil, body, fmt.Errorf("yaml frontmatter: %w", err)
		}
		return &frontMatter{data: stringifyMapKeys(data), format: "yaml"}, body, nil
	case strings.HasPrefix(source, "+++\n"), strings.HasPrefix(source, "+++\r\n"):
		fm, body, err := splitFenced(source, "+++")
		if err != nil {
			return nil, source, err
		}
		data := map[string]any{}
		if _, err := toml.Decode(fm, &data); err != nil {
			return nil, body, fmt.Errorf("toml frontmatter: %w", err)
		}
		return &frontMatter{data: data, format: "toml"}, body, nil
	case strings.HasPrefix(source, "{"):
		// JSON front matter — terminated by a balanced top-level `}`.
		fm, body, err := splitJSON(source)
		if err != nil {
			return nil, source, err
		}
		data := map[string]any{}
		if err := json.Unmarshal([]byte(fm), &data); err != nil {
			return nil, body, fmt.Errorf("json frontmatter: %w", err)
		}
		return &frontMatter{data: data, format: "json"}, body, nil
	}
	return &frontMatter{data: map[string]any{}, format: "none"}, source, nil
}

// splitFenced splits a `<fence>\n...\n<fence>\n` block off the head of
// source. Returns the inner front-matter text and the remaining body.
func splitFenced(source, fence string) (string, string, error) {
	// Skip the opening fence + its trailing newline.
	openLen := len(fence)
	if strings.HasPrefix(source, fence+"\r\n") {
		openLen += 2
	} else {
		openLen += 1
	}
	rest := source[openLen:]
	end := strings.Index(rest, "\n"+fence)
	if end < 0 {
		return "", source, fmt.Errorf("frontmatter: missing closing fence %q", fence)
	}
	fm := rest[:end]
	tail := rest[end+1+len(fence):]
	tail = strings.TrimPrefix(tail, "\r")
	tail = strings.TrimPrefix(tail, "\n")
	return fm, tail, nil
}

// splitJSON returns the head JSON object and the remaining body. Naive
// brace counter; sufficient for hand-authored front matter.
func splitJSON(source string) (string, string, error) {
	depth := 0
	inStr := false
	escape := false
	for i := 0; i < len(source); i++ {
		c := source[i]
		if escape {
			escape = false
			continue
		}
		if c == '\\' {
			escape = true
			continue
		}
		if c == '"' {
			inStr = !inStr
			continue
		}
		if inStr {
			continue
		}
		if c == '{' {
			depth++
		}
		if c == '}' {
			depth--
			if depth == 0 {
				head := source[:i+1]
				tail := source[i+1:]
				tail = strings.TrimPrefix(tail, "\r")
				tail = strings.TrimPrefix(tail, "\n")
				return head, tail, nil
			}
		}
	}
	return "", source, fmt.Errorf("frontmatter: unbalanced JSON head")
}

// stringifyMapKeys converts yaml.v3's map[interface{}]interface{} values
// (a holdover from YAML 1.1 anchors) into map[string]any so downstream
// JSON encoders don't choke. yaml.v3 already returns map[string]any at
// the top level, but nested maps may still surface as map[any]any when
// merge keys are involved.
func stringifyMapKeys(in map[string]any) map[string]any {
	for k, v := range in {
		in[k] = stringifyValue(v)
	}
	return in
}

func stringifyValue(v any) any {
	switch m := v.(type) {
	case map[any]any:
		out := map[string]any{}
		for k, vv := range m {
			out[fmt.Sprint(k)] = stringifyValue(vv)
		}
		return out
	case map[string]any:
		return stringifyMapKeys(m)
	case []any:
		for i := range m {
			m[i] = stringifyValue(m[i])
		}
		return m
	}
	return v
}
