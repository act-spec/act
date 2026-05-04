/**
 * PRD-300-R9 / R10 / R11 / R12 / R13 / R24 / R25 — page-level aggregation.
 *
 * Bindings (PRD-301/302/303) collect descendant component- and block-level
 * contracts during a render walk; this module performs the deterministic
 * combination into a single `NodeDraft`. Render order is preserved
 * (depth-first, top-to-bottom per PRD-102-R24); page-level `id` is
 * validated; collisions across the build are detected; nested page-level
 * contracts in a single subtree are rejected; `children` cycles are
 * detected before emission.
 */
import type {
  ActContract,
  ContractOutput,
  ExtractionContext,
  ExtractionMethod,
  NodeDraft,
  PageContract,
} from './types.js';
import { BuildError } from './errors.js';
import { validateContractId } from './id.js';
import { safeExtract } from './extract.js';

/**
 * Per PRD-300-R9 — descendant contributions are flattened to render-order
 * tuples by the binding before calling `aggregatePage`. Each tuple carries
 * the (already-desugared) contract and the props it was instantiated with.
 */
export interface DescendantContribution<P = unknown> {
  contract: ActContract<P>;
  props: P;
  /** Optional binding-supplied (component name, source location) for placeholder metadata. */
  component?: string;
  location?: string;
}

export interface AggregatePageInput {
  page: PageContract;
  pageProps: unknown;
  ctx: ExtractionContext;
  /** Already in render order per PRD-300-R9. */
  descendants: ReadonlyArray<DescendantContribution>;
  /** PRD-300-R29 — extraction method the binding selected; stamped on every block. */
  method?: ExtractionMethod;
  /**
   * PRD-300-R13 — descendants flagged by the binding as themselves declaring
   * a page-level contract (e.g., another `defineActSection` with a
   * page-shaped declaration). Triggers a build error.
   */
  nestedPageDescendantIds?: ReadonlyArray<string>;
  /**
   * PRD-300-R24 — `children` ids the binding pre-collected from the page's
   * subtree (e.g., from sub-route declarations the SSR walk encountered).
   * Used by the cycle check before the draft is yielded.
   */
  children?: ReadonlyArray<string>;
}

/**
 * PRD-300-R9 / R10 / R12 / R13 / R24 — produce a single `NodeDraft` for
 * the page by walking descendants in render order, stamping every emitted
 * block per PRD-300-R21 / R29, and validating the page-level invariants.
 *
 * The page-level `extract` (typically a stub returning `{ type }`) supplies
 * `title` when the contract did not (R9 + R10 fallback). `summary` falls
 * back to the contract's own `summary` when the extract did not produce one.
 */
export function aggregatePage(input: AggregatePageInput): NodeDraft {
  const { page, pageProps, ctx, descendants, method, children } = input;

  // PRD-300-R10 — page-level id MUST validate before emission.
  const pageIdError = validateContractId(page.id);
  if (pageIdError !== null) {
    throw new BuildError('PRD-300-R10', pageIdError);
  }

  // PRD-300-R13 — nested page-level contract under the page's subtree.
  if (input.nestedPageDescendantIds !== undefined && input.nestedPageDescendantIds.length > 0) {
    const list = input.nestedPageDescendantIds.join(', ');
    throw new BuildError(
      'PRD-300-R13',
      `page "${page.id}" subtree contains nested page-level contracts: ${list}`,
    );
  }

  // Page-level extract: bindings typically return `{ type: page.type }` so
  // the framework treats the result as the canonical "page block" but does
  // NOT push it into `content` — it sources `title`/`summary` clues from it.
  const pageOpts: { method?: ExtractionMethod } = {};
  if (method !== undefined) pageOpts.method = method;
  const pageBlocks = safeExtract(page, pageProps, { ...ctx, parentId: page.id }, pageOpts);

  // Aggregate descendant contributions in render order per PRD-300-R9.
  const content: ContractOutput[] = [];
  for (const child of descendants) {
    const opts: { method?: ExtractionMethod; component?: string; location?: string } = {};
    if (method !== undefined) opts.method = method;
    if (child.component !== undefined) opts.component = child.component;
    if (child.location !== undefined) opts.location = child.location;
    const blocks = safeExtract(
      child.contract,
      child.props,
      { ...ctx, parentId: page.id },
      opts,
    );
    for (const b of blocks) content.push(b);
  }

  // PRD-300-R24 — children-cycle detection pre-emit.
  if (children !== undefined && children.includes(page.id)) {
    throw new BuildError('PRD-300-R24', `page "${page.id}" lists itself in children (PRD-100-R25)`);
  }

  // Build the draft. `summary` per R10 fallback chain: contract.summary
  // wins; otherwise the page-level extract's first block may carry a
  // `summary` field (typical for `{ type: page.type, summary: "..." }`).
  const summaryFromExtract = pickStringField(pageBlocks, 'summary');
  const titleFromExtract = pickStringField(pageBlocks, 'title');
  const draft: NodeDraft = {
    id: page.id,
    type: page.type,
    title: titleFromExtract ?? page.id,
    summary: page.summary ?? summaryFromExtract ?? '',
    content,
  };
  if (page.related !== undefined) draft.related = page.related;
  if (children !== undefined && children.length > 0) {
    // PRD-100-R25 — also reject cycle-via-children when the binding pre-
    // populated child ids; we kept the explicit `===` check above for
    // documented test coverage on the trivial self-cycle case.
    const dedup: string[] = [];
    for (const c of children) {
      if (c === page.id) {
        throw new BuildError('PRD-300-R24', `page "${page.id}" cycles via children`);
      }
      dedup.push(c);
    }
    (draft as NodeDraft & { children: string[] }).children = dedup;
  }
  return draft;
}

function pickStringField(blocks: ReadonlyArray<ContractOutput>, key: string): string | undefined {
  for (const b of blocks) {
    const v = (b as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * PRD-300-R11 — multi-page-collision detector. Bindings call this once
 * after collecting every page-level draft for the build (typically inside
 * the generator's "all routes processed" hook). Throws on any collision.
 */
export function detectIdCollisions(
  drafts: ReadonlyArray<{ id: string; routeId?: string }>,
): void {
  const seen = new Map<string, string>();
  for (const d of drafts) {
    const prior = seen.get(d.id);
    const where = d.routeId ?? d.id;
    if (prior !== undefined) {
      throw new BuildError(
        'PRD-300-R11',
        `page id "${d.id}" emitted by both "${prior}" and "${where}"`,
      );
    }
    seen.set(d.id, where);
  }
}
