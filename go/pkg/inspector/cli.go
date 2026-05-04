// CLI surface for the inspector. The actree binary's `inspect` subcommand
// dispatches to RunInspect; the function is exported so it can be unit-
// tested without spawning a subprocess.

package inspector

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

// RunInspect is the entry point for `actree inspect <url>`. It walks the
// site at url, then writes a JSON report to out. Returns a process exit code
// matching the @act-spec/inspector convention:
//
//	0  walk completed; no error-severity findings.
//	1  one or more error-severity findings (manifest missing, parse
//	   errors, 404s, etc.).
//	2  programmer misuse (bad URL).
//
// The shape of the JSON report is the WalkResult struct from inspector.go.
func RunInspect(ctx context.Context, out io.Writer, url string) int {
	if url == "" {
		fmt.Fprintln(out, "actree inspect: missing URL argument.")
		fmt.Fprintln(out, "usage: actree inspect <site-url>")
		return 2
	}
	w := NewWalker()
	// Bound the inspect call so a runaway walk does not hang the CLI.
	walkCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	res, err := w.WalkSite(walkCtx, url)
	if err != nil {
		fmt.Fprintf(out, "actree inspect: %v\n", err)
		return 2
	}
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	if err := enc.Encode(res); err != nil {
		fmt.Fprintf(out, "actree inspect: encode result: %v\n", err)
		return 1
	}
	for _, f := range res.Findings {
		if f.Severity == SeverityError {
			return 1
		}
	}
	return 0
}
