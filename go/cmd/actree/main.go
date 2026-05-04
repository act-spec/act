// Command actree is the CLI entrypoint for the Go reference implementation
// of ACT (Agent Content Tree).
//
// Subcommands:
//
//	actree --version             Print the bundled spec/impl version.
//	actree validate <file>       Validate a single envelope JSON file.
//	actree inspect <url>         Walk a deployed ACT site and print a JSON
//	                             report (manifest + index + per-node walk).
//
// `validate` is intentionally minimal — it dispatches by filename heuristic
// (manifest-*.json → manifest, index-*.json → index, node-*.json → node) or
// by an explicit --kind flag, then prints a JSON {valid, errors} report. The
// schema bundle is located via the validator package's DefaultSchemasDir
// walk; pass --schemas to pin it explicitly.
//
// `inspect` mirrors the TS @act-spec/inspector walk surface: it fetches
// /.well-known/act.json, follows index_url, and visits every node under
// node_url_template, honouring the ETag conditional-request contract
// per PRD-103. Findings are aggregated into a JSON report and an
// error-severity finding maps to a non-zero exit code.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/act-spec/act/go/pkg/core"
	"github.com/act-spec/act/go/pkg/inspector"
	"github.com/act-spec/act/go/pkg/validator"
)

func main() {
	if len(os.Args) <= 1 {
		printBanner()
		return
	}
	switch os.Args[1] {
	case "-v", "--version", "version":
		fmt.Printf("actree v%s\n", core.Version)
	case "validate":
		os.Exit(runValidate(os.Args[2:]))
	case "inspect":
		os.Exit(runInspect(os.Args[2:]))
	case "-h", "--help", "help":
		printHelp()
	default:
		fmt.Fprintf(os.Stderr, "actree: unknown command %q (try --help)\n", os.Args[1])
		os.Exit(2)
	}
}

// runInspect is the `actree inspect <url>` subcommand entry point. The
// real walk logic lives in pkg/inspector so it can be unit-tested
// without spawning a subprocess; this wrapper exists only to do the
// CLI-level argument unpacking.
func runInspect(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "actree inspect: missing <url> argument")
		return 2
	}
	if len(args) > 1 {
		fmt.Fprintln(os.Stderr, "actree inspect: only one <url> argument is supported")
		return 2
	}
	return inspector.RunInspect(context.Background(), os.Stdout, args[0])
}

func printBanner() {
	fmt.Printf("actree v%s\n", core.Version)
	fmt.Println("Go reference implementation of ACT (Agent Content Tree).")
	fmt.Println("Try `actree --help`.")
}

func printHelp() {
	fmt.Printf(`actree v%s

USAGE
  actree --version
  actree validate <file> [--kind manifest|index|node] [--schemas <dir>]
  actree inspect  <url>

EXIT CODES
  0  valid / inspect completed cleanly
  1  invalid (schema violations found) / inspect error finding
  2  CLI / IO error
`, core.Version)
}

// runValidate is the `actree validate` subcommand. Returns the exit code.
func runValidate(args []string) int {
	var (
		file       string
		kind       string
		schemasDir string
	)
	i := 0
	for i < len(args) {
		a := args[i]
		switch {
		case a == "--kind":
			i++
			if i >= len(args) {
				fmt.Fprintln(os.Stderr, "actree validate: --kind requires a value")
				return 2
			}
			kind = args[i]
		case strings.HasPrefix(a, "--kind="):
			kind = strings.TrimPrefix(a, "--kind=")
		case a == "--schemas":
			i++
			if i >= len(args) {
				fmt.Fprintln(os.Stderr, "actree validate: --schemas requires a value")
				return 2
			}
			schemasDir = args[i]
		case strings.HasPrefix(a, "--schemas="):
			schemasDir = strings.TrimPrefix(a, "--schemas=")
		case strings.HasPrefix(a, "-"):
			fmt.Fprintf(os.Stderr, "actree validate: unknown flag %q\n", a)
			return 2
		default:
			if file != "" {
				fmt.Fprintln(os.Stderr, "actree validate: only one file argument is supported")
				return 2
			}
			file = a
		}
		i++
	}
	if file == "" {
		fmt.Fprintln(os.Stderr, "actree validate: missing <file> argument")
		return 2
	}
	if kind == "" {
		kind = guessKind(file)
		if kind == "" {
			fmt.Fprintf(os.Stderr,
				"actree validate: cannot infer envelope kind from %q; pass --kind manifest|index|node\n", file)
			return 2
		}
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		fmt.Fprintf(os.Stderr, "actree validate: cannot read %s: %v\n", file, err)
		return 2
	}
	body, err := stripFixtureMeta(raw)
	if err != nil {
		fmt.Fprintf(os.Stderr, "actree validate: cannot parse %s as JSON: %v\n", file, err)
		return 2
	}
	v, err := validator.New(schemasDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "actree validate: %v\n", err)
		return 2
	}
	var report *validator.ValidationReport
	switch kind {
	case "manifest":
		report, err = v.ValidateManifest(body)
	case "index":
		report, err = v.ValidateIndex(body)
	case "node":
		report, err = v.ValidateNode(body)
	default:
		fmt.Fprintf(os.Stderr, "actree validate: unknown --kind %q (manifest|index|node)\n", kind)
		return 2
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "actree validate: %v\n", err)
		return 2
	}
	out, _ := json.MarshalIndent(report, "", "  ")
	fmt.Println(string(out))
	if report.Valid {
		return 0
	}
	return 1
}

// guessKind mirrors the TS CLI's filename heuristic so callers get the same
// envelope dispatch from `actree validate <path>` and `act-validate --file <path>`.
func guessKind(file string) string {
	base := file
	if i := strings.LastIndexAny(file, "/\\"); i >= 0 {
		base = file[i+1:]
	}
	switch {
	case strings.HasPrefix(base, "manifest-"), base == "act.json", strings.HasSuffix(base, "/act.json"):
		return "manifest"
	case strings.HasPrefix(base, "index-"):
		return "index"
	case strings.HasPrefix(base, "node-"):
		return "node"
	}
	return ""
}

// stripFixtureMeta drops `_*` and `expected_*` top-level keys before
// validation, matching the test harness in pkg/validator. Fixtures carry
// these annotation keys; they are not part of the wire format.
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
