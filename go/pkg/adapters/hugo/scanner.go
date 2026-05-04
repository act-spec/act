// Content-tree scanner.
//
// Walks Hugo's content/ directory and emits one hugoPage per `.md` file
// (and per `.html`, which Hugo also accepts as a content format). Per
// the spec mapping:
//
//   - `_index.md` files are SECTION nodes (branches). Sibling pages
//     attach to them.
//   - Plain `*.md` files are LEAF nodes.
//   - `index.md` (no underscore) inside a directory is a leaf-bundle
//     page; sibling files in the same directory are bundled assets.
//   - In multilingual mode the locale comes from one of two
//     conventions:
//       1) per-language `contentDir`: content/<lang>/...
//       2) filename suffix: foo.<lang>.md
//
// The scanner returns pages already tagged with their derived ID, body
// text, parsed front matter, and locale.

package hugo

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// hugoPage carries everything the node builder needs about one source
// file. Public fields stay lowercase since the type is an internal
// detail of the adapter.
type hugoPage struct {
	id          string
	relPath     string // relative to content/, slash-separated
	absPath     string
	locale      string
	isSection   bool
	body        string
	frontMatter *frontMatter
}

// scanContent walks contentDir and returns the pages belonging to the
// given locale. The cfg argument lets the scanner consult the
// `[languages]` table to decide which top-level directories belong to
// which locale.
//
// The scanner emits at most one synthetic "index" section per call when
// content/_index.md is missing — the spec mapping treats `index` as the
// synthetic root.
func scanContent(contentDir, locale string, cfg *hugoConfig) ([]*hugoPage, []string) {
	var (
		pages    []*hugoPage
		warnings []string
	)
	rootForLocale := localeRoot(contentDir, locale, cfg)
	if rootForLocale == "" {
		// Locale not present as a per-language contentDir; we still
		// scan the shared content/ tree and rely on filename suffixes
		// to match.
		rootForLocale = contentDir
	}

	seenSyntheticRoot := false
	walkErr := filepath.WalkDir(rootForLocale, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("walk %s: %v", path, err))
			return nil
		}
		if d.IsDir() {
			// In multilingual mode skip sibling locale roots so we
			// don't re-walk them under the wrong locale.
			if rootForLocale == contentDir && cfg != nil {
				if rel, _ := filepath.Rel(contentDir, path); rel != "." {
					top := strings.SplitN(rel, string(filepath.Separator), 2)[0]
					if _, isLocaleDir := cfg.Languages[top]; isLocaleDir && top != locale {
						return filepath.SkipDir
					}
				}
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if ext != ".md" && ext != ".markdown" && ext != ".html" {
			return nil
		}

		raw, err := os.ReadFile(path)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("read %s: %v", path, err))
			return nil
		}
		fm, body, ferr := parseFrontMatter(string(raw))
		if ferr != nil {
			warnings = append(warnings, fmt.Sprintf("frontmatter %s: %v", path, ferr))
			// continue with empty front matter
			fm = &frontMatter{data: map[string]any{}, format: "none"}
			body = string(raw)
		}

		// Resolve effective locale via filename suffix (intro.es.md).
		effectiveLocale, idBase := splitLocaleSuffix(d.Name(), cfg)
		// When the filename declares a different locale than the
		// caller wanted, skip — the right locale's pass will pick
		// it up. Falls back to the caller's locale otherwise.
		if effectiveLocale != "" && effectiveLocale != locale {
			return nil
		}
		if effectiveLocale == "" {
			effectiveLocale = locale
		}

		// Compute path relative to the locale root, then drop the
		// extension and apply Hugo's `_index` collapse rule.
		rel, _ := filepath.Rel(rootForLocale, filepath.Dir(path))
		rel = filepath.ToSlash(rel)
		if rel == "." {
			rel = ""
		}
		nameNoExt := strings.TrimSuffix(idBase, filepath.Ext(idBase))

		isSection := nameNoExt == "_index"
		idPath := nameNoExt
		if isSection {
			idPath = "" // collapse `_index` into its parent dir
		}
		// Spec: `index.md` (no underscore) is a page bundle; the leaf
		// adopts its directory's name.
		if nameNoExt == "index" && !isSection {
			idPath = ""
		}

		joined := joinSlash(rel, idPath)
		id := strings.ToLower(joined)
		if id == "" {
			id = "index"
			seenSyntheticRoot = true
		}
		// Front-matter `id:` overrides path derivation per spec.
		if fmID, ok := fm.data["id"].(string); ok && fmID != "" {
			id = fmID
		}

		// Multilingual Pattern 1 (locale-prefixed IDs) is opt-in via
		// `[params.act].i18n.pattern = "1"`. We don't decode params
		// here; the default (Pattern 2) leaves IDs locale-agnostic
		// and stamps `metadata.locale` on every node, which is what
		// the buildNode caller already does.

		pages = append(pages, &hugoPage{
			id:          id,
			relPath:     filepath.ToSlash(strings.TrimPrefix(path, contentDir+string(filepath.Separator))),
			absPath:     path,
			locale:      effectiveLocale,
			isSection:   isSection,
			body:        body,
			frontMatter: fm,
		})
		return nil
	})
	if walkErr != nil {
		warnings = append(warnings, fmt.Sprintf("scan: %v", walkErr))
	}

	// If the walk did not include a synthetic `index` section, synthesise
	// one so the manifest's root is non-empty.
	if !seenSyntheticRoot {
		pages = append(pages, &hugoPage{
			id:          "index",
			relPath:     "",
			absPath:     contentDir,
			locale:      locale,
			isSection:   true,
			body:        "",
			frontMatter: &frontMatter{data: map[string]any{"title": "Site root"}, format: "none"},
		})
	}

	// Stable order — caller expects deterministic output.
	sort.Slice(pages, func(i, j int) bool { return pages[i].id < pages[j].id })
	return pages, warnings
}

// localeRoot returns the directory that holds the given locale's
// content. For Hugo's per-language contentDir convention this is
// `<contentDir>/<locale>/`; for filename-suffix mode it is the shared
// contentDir.
func localeRoot(contentDir, locale string, cfg *hugoConfig) string {
	if cfg == nil {
		return contentDir
	}
	if _, ok := cfg.Languages[locale]; !ok {
		return contentDir
	}
	candidate := filepath.Join(contentDir, locale)
	if info, err := os.Stat(candidate); err == nil && info.IsDir() {
		return candidate
	}
	return ""
}

// localeSuffixRE matches a `.{lang}.{ext}` tail like `intro.es.md`. The
// language token is conservative — two to five lowercase letters,
// optional region.
var localeSuffixRE = regexp.MustCompile(`^(.+)\.([a-z]{2,3}(?:-[a-z]{2})?)\.(md|markdown|html)$`)

// splitLocaleSuffix returns (locale, name-without-locale-suffix). When
// the filename does not carry a locale suffix, locale is "" and the
// returned name is unchanged.
func splitLocaleSuffix(name string, cfg *hugoConfig) (string, string) {
	m := localeSuffixRE.FindStringSubmatch(strings.ToLower(name))
	if m == nil {
		return "", name
	}
	candidate := m[2]
	if cfg != nil && len(cfg.Languages) > 0 {
		if _, ok := cfg.Languages[candidate]; !ok {
			return "", name
		}
	}
	return candidate, m[1] + "." + m[3]
}

// joinSlash joins a and b with a single forward slash, omitting empty
// segments.
func joinSlash(a, b string) string {
	switch {
	case a == "" && b == "":
		return ""
	case a == "":
		return b
	case b == "":
		return a
	}
	return a + "/" + b
}
