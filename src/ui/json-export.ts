import { tables, activeKey, syncEditorToState } from '../state.ts';
import { showToast } from './modals.ts';
import { toExportJson } from '../parser.ts';

let _jsonRefreshTimer: ReturnType<typeof setTimeout> | undefined;

export function getCleanJson(): string {
  syncEditorToState();
  return JSON.stringify(toExportJson(tables[activeKey!]), null, 2);
}

export function refreshJsonPreview(): void {
  const pre = document.getElementById('json-pre');
  if (pre) pre.textContent = getCleanJson();
}

export function copyJson(): void {
  navigator.clipboard.writeText(getCleanJson())
    .then(() => showToast('JSON copied', 'success'));
}

/** Schedule a debounced JSON preview refresh. Called by query-editor's SQL updateListener. */
export function scheduleJsonRefresh(): void {
  clearTimeout(_jsonRefreshTimer);
  _jsonRefreshTimer = setTimeout(refreshJsonPreview, 400);
}

/** Registers the debounced input listener that auto-refreshes the JSON preview. */
export function bindJsonAutoRefresh(): void {
  document.addEventListener('input', (e: Event) => {
    if (!activeKey || !(e.target as HTMLElement).closest('#editor-content')) return;
    clearTimeout(_jsonRefreshTimer);
    _jsonRefreshTimer = setTimeout(refreshJsonPreview, 400);
  });
}
