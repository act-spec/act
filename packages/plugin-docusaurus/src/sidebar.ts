/**
 * PRD-404-R6 — sidebar-to-parent/children derivation.
 *
 * The plugin walks `sidebars.js` and produces:
 *   1. Synthesized parent (`section`) nodes for each `category` containing
 *      docs;
 *   2. A doc-id → parent-id map the merge stage joins onto the markdown
 *      adapter's emitted nodes;
 *   3. A flat orphan list (docs present on disk but not referenced anywhere
 *      in the sidebar).
 *
 * ID grammar (PRD-100-R10) is enforced via {@link sanitizeCategoryId}; a
 * category whose label sanitizes to an empty string is a hard error per the
 * Security section of PRD-404.
 */
import type { ResolvedSidebars, SidebarItem } from './types.js';

/** PRD-404-R6 — synthesized parent node skeleton (pre-emit). */
export interface SyntheticCategoryNode {
  id: string;
  type: 'section';
  title: string;
  summary: string;
  /** Optional ID of an enclosing category. */
  parent?: string;
  /** Doc IDs (and nested category IDs) that nest under this category. */
  children: string[];
}

export interface SidebarMapping {
  syntheticNodes: SyntheticCategoryNode[];
  /** doc-id → immediate-parent-category-id. */
  parentMap: Map<string, string>;
  /** Docs encountered more than once (warning per PRD-404-R6 second bullet). */
  duplicateDocs: string[];
  /** Sidebar `link` items skipped per PRD-404-R6 fourth bullet. */
  skippedLinks: string[];
  /** Every doc-id reached during sidebar traversal (top-level + nested). */
  visitedDocIds: ReadonlySet<string>;
}

const ID_GRAMMAR = /^[a-z0-9](?:[a-z0-9._\-/])*[a-z0-9](?:@[a-z0-9-]+)?$|^[a-z0-9](?:@[a-z0-9-]+)?$/;

/**
 * Lowercase + non-grammar-char → hyphen + collapse-runs. Rejects empty
 * inputs (Security: empty IDs → hard error). Mirrors PRD-100-R10.
 */
export function sanitizeCategoryId(label: string): string {
  if (typeof label !== 'string') {
    throw new Error('PRD-404-R6: category label MUST be a string');
  }
  const lowered = label.toLowerCase();
  // Replace anything outside [a-z0-9._\-/] with `-`.
  let out = '';
  for (const ch of lowered) {
    if (/[a-z0-9._\-/]/.test(ch)) {
      out += ch;
    } else {
      out += '-';
    }
  }
  // Collapse hyphen runs and trim leading/trailing hyphens.
  out = out.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (out.length === 0) {
    throw new Error(
      `PRD-404-R6: category label "${label}" sanitizes to an empty ID; rename the category`,
    );
  }
  if (!ID_GRAMMAR.test(out)) {
    throw new Error(
      `PRD-404-R6: synthesized category ID "${out}" violates PRD-100-R10 grammar`,
    );
  }
  return out;
}

/**
 * PRD-404-R6 — derive parent / children relations from a sidebars.js
 * structure. `sidebarKey` selects which sidebar to walk (`docs` is the
 * Docusaurus default).
 */
export function deriveParentChildren(
  sidebars: ResolvedSidebars,
  sidebarKey = 'docs',
): SidebarMapping {
  const syntheticNodes: SyntheticCategoryNode[] = [];
  const parentMap = new Map<string, string>();
  const duplicateDocs: string[] = [];
  const skippedLinks: string[] = [];
  const visitedDocs = new Set<string>();

  function visit(item: SidebarItem, parentId: string | undefined): string | undefined {
    if (typeof item === 'string') {
      // Shorthand for `{ type: "doc", id: item }`.
      return visitDoc(item, parentId);
    }
    if (item.type === 'doc') {
      return visitDoc(item.id, parentId);
    }
    if (item.type === 'link') {
      skippedLinks.push(item.label);
      return undefined;
    }
    if (item.type === 'category') {
      const catId = sanitizeCategoryId(item.label);
      const node: SyntheticCategoryNode = {
        id: catId,
        type: 'section',
        title: item.label,
        summary: item.description ?? '',
        children: [],
        ...(parentId !== undefined ? { parent: parentId } : {}),
      };
      syntheticNodes.push(node);
      for (const child of item.items) {
        const childId = visit(child, catId);
        if (childId !== undefined) node.children.push(childId);
      }
      return catId;
    }
    return undefined;
  }

  function visitDoc(id: string, parentId: string | undefined): string {
    if (visitedDocs.has(id)) {
      duplicateDocs.push(id);
    } else {
      visitedDocs.add(id);
    }
    if (parentId !== undefined && !parentMap.has(id)) {
      parentMap.set(id, parentId);
    }
    return id;
  }

  const root = sidebars[sidebarKey];
  if (root === undefined) {
    return { syntheticNodes, parentMap, duplicateDocs, skippedLinks, visitedDocIds: visitedDocs };
  }

  for (const item of root) visit(item, undefined);
  return { syntheticNodes, parentMap, duplicateDocs, skippedLinks, visitedDocIds: visitedDocs };
}

/**
 * PRD-404-R6 — collision check between a synthesized category-node ID and a
 * real doc ID. Real-doc IDs are supplied as a set so the caller can build it
 * from the markdown adapter's emitted nodes.
 */
export function ensureNoCategoryDocCollision(
  syntheticNodes: SyntheticCategoryNode[],
  realDocIds: ReadonlySet<string>,
): void {
  for (const node of syntheticNodes) {
    if (realDocIds.has(node.id)) {
      throw new Error(
        `PRD-404-R6 / PRD-200-R10: synthesized category-node ID "${node.id}" collides with a real doc ID`,
      );
    }
  }
}

/**
 * PRD-404-R6 third bullet — orphan detection. Returns doc IDs present in
 * `realDocIds` but absent from the sidebar's traversal — i.e., the doc
 * was not referenced anywhere in `sidebars.js`. The returned IDs are
 * emitted as top-level nodes per PRD-404-R6 third bullet AND surfaced as
 * warnings in the build report.
 */
export function findOrphanDocs(
  realDocIds: ReadonlySet<string>,
  mapping: SidebarMapping,
): string[] {
  const out: string[] = [];
  for (const id of realDocIds) {
    if (!mapping.visitedDocIds.has(id)) out.push(id);
  }
  return out;
}
