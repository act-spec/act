// SPDX-License-Identifier: Apache-2.0
/**
 * URL query-state encode/decode for deep-linkable site browsing.
 *
 * Reflects `?site=<urlencoded>&node=<id>`. Uses `history.replaceState` so
 * navigation between nodes does not flood the back/forward stack — refresh
 * still restores the same node.
 */

export interface UrlState {
  site?: string;
  node?: string;
}

export function readUrlState(): UrlState {
  if (typeof window === 'undefined' || !window.location) return {};
  const params = new URLSearchParams(window.location.search);
  const site = params.get('site');
  const node = params.get('node');
  const out: UrlState = {};
  if (site !== null && site.length > 0) out.site = site;
  if (node !== null && node.length > 0) out.node = node;
  return out;
}

export function writeUrlState(state: UrlState): void {
  if (typeof window === 'undefined' || !window.history) return;
  const params = new URLSearchParams();
  if (typeof state.site === 'string' && state.site.length > 0) {
    params.set('site', state.site);
  }
  if (typeof state.node === 'string' && state.node.length > 0) {
    params.set('node', state.node);
  }
  const qs = params.toString();
  const next = qs.length > 0
    ? `${window.location.pathname}?${qs}${window.location.hash}`
    : `${window.location.pathname}${window.location.hash}`;
  window.history.replaceState(null, '', next);
}
