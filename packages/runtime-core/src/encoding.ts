/**
 * PRD-500-R13 URL encoding helpers.
 *
 * `encodeIdForUrl` performs per-segment percent-encoding per PRD-100-R12 +
 * PRD-106-R14: split the ID on `/`, encode each segment with the `pchar`
 * rules of RFC 3986 §3.3, and re-join with `/`. The slash is the segment
 * separator and is preserved verbatim.
 *
 * Decoding is the inverse: `decodeIdFromUrl` percent-decodes each segment
 * (per PRD-106-R15: two URLs that decode to the same canonical ID resolve
 * to the same resource).
 */

/**
 * RFC 3986 §3.3 `pchar = unreserved / pct-encoded / sub-delims / ":" / "@"`.
 * `encodeURIComponent` encodes everything except `unreserved` plus
 * `!*'()` (the legacy reserved-but-mark-set). For ACT IDs we want to be
 * conservative: keep unreserved + `:` + `@` literal (per `pchar`), encode
 * everything else. We start from `encodeURIComponent` and unescape `:` and
 * `@` manually.
 */
function encodeSegmentPchar(segment: string): string {
  // encodeURIComponent already encodes `/` (good — our caller splits first),
  // and produces uppercase percent triplets. We unescape `:` (%3A) and `@`
  // (%40) so they appear literally per `pchar`. We also keep `!`, `*`, `'`,
  // `(`, `)` as `sub-delims`.
  return encodeURIComponent(segment)
    .replace(/%3A/g, ':')
    .replace(/%40/g, '@')
    .replace(/%21/g, '!')
    .replace(/%2A/g, '*')
    .replace(/%27/g, "'")
    .replace(/%28/g, '(')
    .replace(/%29/g, ')');
}

/**
 * PRD-500-R13 — per-segment percent-encoding for a node ID. Preserves `/`.
 *
 * @example encodeIdForUrl('docs/intro') → 'docs/intro'
 * @example encodeIdForUrl('docs/hello world') → 'docs/hello%20world'
 * @example encodeIdForUrl('a/b@variant') → 'a/b@variant'  // `@` per `pchar`
 */
export function encodeIdForUrl(id: string): string {
  return id.split('/').map(encodeSegmentPchar).join('/');
}

/**
 * PRD-106-R15 — canonical decoder. Two URLs that decode to the same canonical
 * ID resolve to the same resource. The SDK's request matcher canonicalizes
 * the path using this helper before invoking the resolver.
 */
export function decodeIdFromUrl(encoded: string): string {
  return encoded.split('/').map((s) => decodeURIComponent(s)).join('/');
}
