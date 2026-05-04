// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readUrlState, writeUrlState } from './url-state.js';

interface FakeLocation {
  pathname: string;
  search: string;
  hash: string;
}

interface FakeHistory {
  replaceState: ReturnType<typeof vi.fn>;
}

function setLocation(search: string, pathname = '/browser/', hash = ''): void {
  const loc: FakeLocation = { pathname, search, hash };
  vi.stubGlobal('location', loc);
  vi.stubGlobal('window', { location: loc, history: { replaceState: vi.fn() } });
}

function extractSearch(url: string): string {
  const qIdx = url.indexOf('?');
  if (qIdx < 0) return '';
  const hashIdx = url.indexOf('#', qIdx);
  return hashIdx < 0 ? url.slice(qIdx) : url.slice(qIdx, hashIdx);
}

function getReplaceStateMock(): ReturnType<typeof vi.fn> {
  const w = (globalThis as unknown as { window?: { history?: FakeHistory } }).window;
  if (!w?.history?.replaceState) throw new Error('window.history not stubbed');
  return w.history.replaceState;
}

describe('readUrlState', () => {
  beforeEach(() => {
    setLocation('');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns {} when no params present', () => {
    setLocation('');
    expect(readUrlState()).toEqual({});
  });

  it('decodes site and node when present', () => {
    setLocation('?site=https%3A%2F%2Fexample.com%2F.well-known%2Fact.json&node=root');
    const state = readUrlState();
    expect(state.site).toBe('https://example.com/.well-known/act.json');
    expect(state.node).toBe('root');
  });

  it('decodes node ids that contain encoded slashes and locale paths', () => {
    setLocation(
      '?site=https%3A%2F%2Fx%2F.well-known%2Fact.json&node=cms%2Fen-US%2Flanding%2Fpricing',
    );
    const state = readUrlState();
    expect(state.node).toBe('cms/en-US/landing/pricing');
  });

  it('omits empty params from the result', () => {
    setLocation('?site=&node=');
    expect(readUrlState()).toEqual({});
  });
});

describe('writeUrlState', () => {
  beforeEach(() => {
    setLocation('?old=value', '/browser/', '#frag');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('roundtrips with both site and node set', () => {
    const site = 'https://example.com/.well-known/act.json';
    const node = 'root';
    writeUrlState({ site, node });
    const replace = getReplaceStateMock();
    expect(replace).toHaveBeenCalledTimes(1);
    const url = replace.mock.calls[0]?.[2] as string;
    const search = extractSearch(url);
    setLocation(search);
    const round = readUrlState();
    expect(round.site).toBe(site);
    expect(round.node).toBe(node);
  });

  it('preserves pathname and hash when writing', () => {
    writeUrlState({ site: 'https://x/', node: 'a' });
    const replace = getReplaceStateMock();
    const url = replace.mock.calls[0]?.[2] as string;
    expect(url.startsWith('/browser/?')).toBe(true);
    expect(url.endsWith('#frag')).toBe(true);
  });

  it('writes only pathname+hash when state is empty', () => {
    writeUrlState({});
    const replace = getReplaceStateMock();
    const url = replace.mock.calls[0]?.[2] as string;
    expect(url).toBe('/browser/#frag');
  });

  it('encodes node ids with reserved characters so readUrlState can recover them', () => {
    const node = 'cms/en-US/landing/pricing';
    writeUrlState({ site: 'https://x/', node });
    const replace = getReplaceStateMock();
    const url = replace.mock.calls[0]?.[2] as string;
    setLocation(extractSearch(url));
    expect(readUrlState().node).toBe(node);
  });
});
