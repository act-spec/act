// SPDX-License-Identifier: Apache-2.0
/**
 * Drag-and-drop offline path. Accepts a single dropped JSON file; if the
 * file looks like a manifest envelope we surface it for the SPA to render.
 *
 * The index/node fetches still need a real origin — the dispatcher will
 * surface those as scoped errors so the user understands what's missing.
 */

export interface DroppedManifest {
  kind: 'manifest';
  manifest: unknown;
  syntheticUrl: string;
  filename: string;
}

export type DropOutcome =
  | DroppedManifest
  | { kind: 'unsupported'; message: string };

export type DropHandler = (outcome: DropOutcome) => void;

export function wireDragAndDrop(target: HTMLElement, onDrop: DropHandler): void {
  // Prevent the browser from navigating to the dropped file by default.
  const prevent = (ev: DragEvent): void => {
    ev.preventDefault();
    ev.stopPropagation();
  };

  document.addEventListener('dragover', prevent);
  document.addEventListener('drop', (ev) => {
    prevent(ev);
    void handleDrop(ev, onDrop);
  });
  // TODO(subagent-3 or later): folder drops via DataTransferItemList -> webkitGetAsEntry.
  // Mark the drop target visually when dragging over it.
  target.addEventListener('dragenter', () => target.classList.add('drop-active'));
  target.addEventListener('dragleave', () => target.classList.remove('drop-active'));
  target.addEventListener('drop', () => target.classList.remove('drop-active'));
}

async function handleDrop(ev: DragEvent, onDrop: DropHandler): Promise<void> {
  const dt = ev.dataTransfer;
  if (!dt) {
    onDrop({ kind: 'unsupported', message: 'No data on drop event.' });
    return;
  }
  const files = Array.from(dt.files ?? []);
  if (files.length === 0) {
    onDrop({ kind: 'unsupported', message: 'Drop a JSON manifest file.' });
    return;
  }
  if (files.length > 1) {
    onDrop({ kind: 'unsupported', message: 'Drop one file at a time.' });
    return;
  }
  const file = files[0];
  if (!file) {
    onDrop({ kind: 'unsupported', message: 'No file received.' });
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onDrop({ kind: 'unsupported', message: `Could not read ${file.name}: ${msg}` });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onDrop({ kind: 'unsupported', message: `${file.name} is not valid JSON: ${msg}` });
    return;
  }
  if (!parsed || typeof parsed !== 'object') {
    onDrop({ kind: 'unsupported', message: `${file.name} is not a JSON object.` });
    return;
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['index_url'] !== 'string' || typeof obj['node_url_template'] !== 'string') {
    onDrop({
      kind: 'unsupported',
      message: `${file.name} does not look like a manifest (missing index_url / node_url_template).`,
    });
    return;
  }
  onDrop({
    kind: 'manifest',
    manifest: parsed,
    syntheticUrl: `file:///${encodeURIComponent(file.name)}`,
    filename: file.name,
  });
}
