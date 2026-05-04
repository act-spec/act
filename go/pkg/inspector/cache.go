// Cache is the inspector's per-invocation HTTP cache. It mirrors the
// shape of the mcp-server's InvocationCache (TTL-bound, in-memory) so
// the Go inspector and TS inspector can share operator mental models
// when both are wired into a fleet.
//
// Two TTL bands:
//   - Manifest entries: 60s. The well-known manifest changes rarely;
//     a short TTL is enough to keep multi-call workflows from hammering
//     the origin while still surfacing a fresh deploy quickly.
//   - Node entries: 5min. Per-node JSON is keyed by ETag (ETag-aware
//     producers will short-circuit re-validation via 304); the TTL is
//     a backstop for producers that omit ETags.

package inspector

import (
	"sync"
	"time"
)

// Cache holds the inspector's in-memory response cache. Safe for
// concurrent use; lookups and stores take a single mutex.
type Cache struct {
	mu          sync.Mutex
	manifest    map[string]cacheEntry
	nodes       map[string]cacheEntry
	manifestTTL time.Duration
	nodeTTL     time.Duration
	now         func() time.Time
}

type cacheEntry struct {
	body     []byte
	etag     string
	storedAt time.Time
}

// NewCache returns a Cache with the standard TTLs (60s manifest, 5min
// nodes). Pass a custom now() to drive deterministic tests; the default
// uses time.Now.
func NewCache() *Cache {
	return &Cache{
		manifest:    map[string]cacheEntry{},
		nodes:       map[string]cacheEntry{},
		manifestTTL: 60 * time.Second,
		nodeTTL:     5 * time.Minute,
		now:         time.Now,
	}
}

// RememberManifest stores a fresh manifest body + ETag for url.
func (c *Cache) RememberManifest(url string, body []byte, etag string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.manifest[url] = cacheEntry{body: body, etag: etag, storedAt: c.now()}
}

// LookupManifest returns the cached body + ETag for url when fresh;
// returns ok=false if the entry is missing or past its TTL.
func (c *Cache) LookupManifest(url string) ([]byte, string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.manifest[url]
	if !ok {
		return nil, "", false
	}
	if c.now().Sub(entry.storedAt) > c.manifestTTL {
		delete(c.manifest, url)
		return nil, "", false
	}
	return entry.body, entry.etag, true
}

// RememberNode stores a fresh node body + ETag for url.
func (c *Cache) RememberNode(url string, body []byte, etag string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.nodes[url] = cacheEntry{body: body, etag: etag, storedAt: c.now()}
}

// LookupNode returns the cached body + ETag for url when fresh.
func (c *Cache) LookupNode(url string) ([]byte, string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.nodes[url]
	if !ok {
		return nil, "", false
	}
	if c.now().Sub(entry.storedAt) > c.nodeTTL {
		delete(c.nodes, url)
		return nil, "", false
	}
	return entry.body, entry.etag, true
}

// Reset clears every cached entry. Useful in tests that want to assert
// post-reset cache misses.
func (c *Cache) Reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.manifest = map[string]cacheEntry{}
	c.nodes = map[string]cacheEntry{}
}
