// Package validator implements ACT (Agent Content Tree) envelope validation
// in Go, mirroring the conformance surface of the TypeScript reference at
// packages/validator. It loads the canonical JSON Schemas under /schemas/
// at the repo root and exposes one entry point per top-level envelope:
// ValidateManifest, ValidateIndex, ValidateNode.
//
// The schema bundle is the source of truth: this validator does not embed
// schema copies. Cross-schema $ref resolution
// happens via canonical $id after every schema in the bundle is registered.
//
// The Go validator targets parity with the TS validator on shared fixtures
// for the structural-validation surface only. Cross-cutting checks (etag
// shape, mount overlap, cycle detection, NDJSON line semantics) are owned
// by the TS validator for v0.2 and will be ported in later runbook items.
package validator

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v5"
)

// Envelope identifies which top-level schema a payload was validated against.
type Envelope string

const (
	EnvelopeManifest Envelope = "manifest"
	EnvelopeIndex    Envelope = "index"
	EnvelopeNode     Envelope = "node"
)

// ValidationError captures one failed assertion against a JSON Schema. The
// shape mirrors the TS validator's Gap surface for ease of cross-checking.
//
//   - Path is the JSON Pointer at which the violation was raised, in the
//     santhosh-tekuri/jsonschema dialect ("" for the root, "/site/name" for
//     nested fields). Matches the TS validator's instancePath convention.
//   - Keyword is the JSON-Schema keyword that fired (e.g. "required",
//     "pattern", "enum", "type").
//   - Message is a human-readable summary suitable for CLI output.
type ValidationError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
	Keyword string `json:"keyword"`
}

// ValidationReport is the result of a single ValidateXxx call. Valid is
// true iff Errors is empty.
type ValidationReport struct {
	Valid  bool              `json:"valid"`
	Errors []ValidationError `json:"errors"`
}

// Validator carries the compiled schema bundle. Construct with New. Safe
// for concurrent use after construction.
type Validator struct {
	manifest *jsonschema.Schema
	index    *jsonschema.Schema
	node     *jsonschema.Schema
}

// New compiles every schema under schemasDir/{NNN}/*.schema.json and returns
// a Validator. If schemasDir is empty, New uses DefaultSchemasDir() which
// walks up from the current working directory looking for a `schemas`
// sibling — matching the TS validator's findRepoRoot behaviour.
func New(schemasDir string) (*Validator, error) {
	if schemasDir == "" {
		var err error
		schemasDir, err = DefaultSchemasDir()
		if err != nil {
			return nil, fmt.Errorf("validator: locate schemas dir: %w", err)
		}
	}
	compiler := jsonschema.NewCompiler()
	compiler.Draft = jsonschema.Draft2020

	if err := registerAllSchemas(compiler, schemasDir); err != nil {
		return nil, err
	}

	pick := func(name string) (*jsonschema.Schema, error) {
		id := schemaID(name)
		s, err := compiler.Compile(id)
		if err != nil {
			return nil, fmt.Errorf("validator: compile %s (%s): %w", name, id, err)
		}
		return s, nil
	}

	v := &Validator{}
	var err error
	if v.manifest, err = pick("manifest"); err != nil {
		return nil, err
	}
	if v.index, err = pick("index"); err != nil {
		return nil, err
	}
	if v.node, err = pick("node"); err != nil {
		return nil, err
	}
	return v, nil
}

// DefaultSchemasDir walks upward from the current working directory looking
// for a directory containing a `schemas` subdirectory, then returns the
// absolute path of that subdirectory. Mirrors packages/validator/src/schemas.ts:findRepoRoot.
func DefaultSchemasDir() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	dir := wd
	for i := 0; i < 12; i++ {
		cand := filepath.Join(dir, "schemas")
		if info, err := os.Stat(cand); err == nil && info.IsDir() {
			return cand, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("validator: could not locate `schemas` directory walking up from %s", wd)
}

// schemaID returns the canonical $id for one of the top-level envelopes.
// Matches the TS validator's SCHEMA_ID helper.
func schemaID(name string) string {
	return fmt.Sprintf("https://act-spec.org/schemas/0.1/%s.schema.json", name)
}

// seriesDirRE matches schema-series subdirectories like `100`, `103`, `109`.
var seriesDirRE = regexp.MustCompile(`^\d{3}$`)

// registerAllSchemas walks `<schemasDir>/<NNN>/*.schema.json` and registers
// every document with the compiler under its declared $id, so cross-schema
// $ref resolution works.
func registerAllSchemas(compiler *jsonschema.Compiler, schemasDir string) error {
	walked := 0
	err := filepath.WalkDir(schemasDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			// Only descend into series dirs (NNN). Skip everything else.
			if path == schemasDir {
				return nil
			}
			rel, _ := filepath.Rel(schemasDir, path)
			if !seriesDirRE.MatchString(rel) {
				return fs.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".schema.json") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read %s: %w", path, err)
		}
		var probe struct {
			ID string `json:"$id"`
		}
		if err := json.Unmarshal(raw, &probe); err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}
		if probe.ID == "" {
			return nil // skip schemas without an $id (none currently)
		}
		if err := compiler.AddResource(probe.ID, bytes.NewReader(raw)); err != nil {
			return fmt.Errorf("add resource %s ($id=%s): %w", path, probe.ID, err)
		}
		walked++
		return nil
	})
	if err != nil {
		return err
	}
	if walked == 0 {
		return fmt.Errorf("validator: no schemas found under %s", schemasDir)
	}
	return nil
}

// ValidateManifest validates raw JSON bytes against the manifest schema.
// Returns a ValidationReport with Valid=false plus Errors when the payload
// does not conform. Non-nil error indicates a JSON parse failure or other
// validator-internal issue, NOT a schema violation.
func (v *Validator) ValidateManifest(data []byte) (*ValidationReport, error) {
	return v.validate(EnvelopeManifest, data)
}

// ValidateIndex validates raw JSON bytes against the index schema.
func (v *Validator) ValidateIndex(data []byte) (*ValidationReport, error) {
	return v.validate(EnvelopeIndex, data)
}

// ValidateNode validates raw JSON bytes against the node schema.
func (v *Validator) ValidateNode(data []byte) (*ValidationReport, error) {
	return v.validate(EnvelopeNode, data)
}

func (v *Validator) validate(env Envelope, data []byte) (*ValidationReport, error) {
	var instance any
	if err := json.Unmarshal(data, &instance); err != nil {
		return nil, fmt.Errorf("validator: parse %s payload: %w", env, err)
	}
	var schema *jsonschema.Schema
	switch env {
	case EnvelopeManifest:
		schema = v.manifest
	case EnvelopeIndex:
		schema = v.index
	case EnvelopeNode:
		schema = v.node
	default:
		return nil, fmt.Errorf("validator: unknown envelope %q", env)
	}
	if err := schema.Validate(instance); err != nil {
		return &ValidationReport{
			Valid:  false,
			Errors: collectErrors(err),
		}, nil
	}
	return &ValidationReport{Valid: true, Errors: nil}, nil
}

// collectErrors flattens the nested *jsonschema.ValidationError tree into a
// flat slice of ValidationError, taking only the leaf failures (those with
// no Causes) so callers see one entry per atomic violation rather than the
// internal aggregate scaffolding.
func collectErrors(err error) []ValidationError {
	var ve *jsonschema.ValidationError
	if !errors.As(err, &ve) {
		return []ValidationError{{Path: "", Keyword: "internal", Message: err.Error()}}
	}
	var out []ValidationError
	walkValidationError(ve, &out)
	if len(out) == 0 {
		// No leaves — the top-level error is itself the violation.
		out = append(out, validationErrorFromNode(ve))
	}
	return out
}

func walkValidationError(ve *jsonschema.ValidationError, out *[]ValidationError) {
	if len(ve.Causes) == 0 {
		*out = append(*out, validationErrorFromNode(ve))
		return
	}
	for _, c := range ve.Causes {
		walkValidationError(c, out)
	}
}

func validationErrorFromNode(ve *jsonschema.ValidationError) ValidationError {
	return ValidationError{
		Path:    ve.InstanceLocation,
		Keyword: keywordFromMessage(ve.Message),
		Message: ve.Message,
	}
}

// keywordFromMessage extracts the JSON-Schema keyword from the leading word
// of a santhosh-tekuri/jsonschema error message. The library does not
// expose the keyword as a struct field on ValidationError, so we infer it
// from the well-known message prefixes. Falls back to "schema" when the
// message does not match a known prefix.
func keywordFromMessage(msg string) string {
	switch {
	case strings.HasPrefix(msg, "missing properties"):
		return "required"
	case strings.HasPrefix(msg, "additionalProperties"):
		return "additionalProperties"
	case strings.HasPrefix(msg, "expected "):
		return "type"
	case strings.HasPrefix(msg, "value must be "):
		return "enum"
	case strings.HasPrefix(msg, "does not match pattern"):
		return "pattern"
	case strings.HasPrefix(msg, "minimum"), strings.HasPrefix(msg, "must be >= "):
		return "minimum"
	case strings.HasPrefix(msg, "maximum"), strings.HasPrefix(msg, "must be <= "):
		return "maximum"
	case strings.HasPrefix(msg, "minLength"), strings.HasPrefix(msg, "length must be >= "):
		return "minLength"
	case strings.HasPrefix(msg, "maxLength"), strings.HasPrefix(msg, "length must be <= "):
		return "maxLength"
	case strings.HasPrefix(msg, "oneOf"):
		return "oneOf"
	case strings.HasPrefix(msg, "anyOf"):
		return "anyOf"
	case strings.HasPrefix(msg, "allOf"):
		return "allOf"
	}
	return "schema"
}
