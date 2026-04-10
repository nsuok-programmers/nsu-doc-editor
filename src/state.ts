import type { TablesMap } from './types.ts';

/* ---------------------------------- STATE --------------------------------- */

export let tables: TablesMap = {};
export let activeKey: string | null = null;

// CodeMirror EditorView instances keyed by query index.
// Owned here (rather than in query-editor.ts) so syncEditorToState can read
// them without creating a circular import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sqlEditors = new Map<number, any>();

export function setActiveKey(key: string | null): void {
  activeKey = key;
}

export function setTables(map: TablesMap): void {
  tables = map;
}

/* -------------------- State Sync (DOM → state object) -------------------- */

export function syncEditorToState(): void {
  if (!activeKey || !tables[activeKey]) return;
  const t = tables[activeKey];

  const nameEl = document.getElementById('meta-name') as HTMLInputElement | null;
  const descEl = document.getElementById('meta-desc') as HTMLTextAreaElement | null;
  const typeEl = document.getElementById('meta-type') as HTMLInputElement | null;

  if (nameEl) {
    const newName = nameEl.value.trim().toUpperCase();
    if (newName && newName !== t.name) {
      tables[newName] = t;
      delete tables[t.name];
      t.name    = newName;
      activeKey = newName;
    }
  }
  if (descEl) t.description = descEl.value.trim();
  if (typeEl) t.type = typeEl.value as 'data' | 'definition';

  document.querySelectorAll<HTMLElement>('[data-col]').forEach(el => {
    const i     = parseInt((el as HTMLElement & { dataset: DOMStringMap }).dataset.col!);
    const field = (el as HTMLElement & { dataset: DOMStringMap }).dataset.field!;
    if (!isNaN(i) && field && t.columns[i] !== undefined) {
      const val = (el as HTMLElement & { dataset: DOMStringMap }).dataset.value;
      (t.columns[i] as unknown as Record<string, string>)[field] =
        val !== undefined ? val : (el as HTMLInputElement | HTMLTextAreaElement).value;
    }
  });

  // Query sync
  document.querySelectorAll<HTMLElement>('[data-qfield]').forEach(el => {
    const i     = parseInt((el as HTMLElement & { dataset: DOMStringMap }).dataset.query!);
    const field = (el as HTMLElement & { dataset: DOMStringMap }).dataset.qfield!;
    if (!isNaN(i) && field && tables[activeKey!].queries[i] !== undefined) {
      (tables[activeKey!].queries[i] as unknown as Record<string, string>)[field] =
        (el as HTMLInputElement | HTMLTextAreaElement).value;
    }
  });

  // SQL from CodeMirror instances
  sqlEditors.forEach((editor, i) => {
    if (tables[activeKey!].queries[i] !== undefined) {
      tables[activeKey!].queries[i].sql = editor.state.doc.toString();
    }
  });

  // Definition headers sync
  document.querySelectorAll<HTMLElement>('[data-def-header]').forEach(el => {
    const i = parseInt((el as HTMLElement & { dataset: DOMStringMap }).dataset.defHeader!);
    if (!isNaN(i) && t['definition_headers']?.[i] !== undefined)
      t['definition_headers']![i] = (el as HTMLInputElement).value;
  });

  // Definition data sync
  document.querySelectorAll<HTMLElement>('[data-def-row][data-def-col]').forEach(el => {
    const r = parseInt((el as HTMLElement & { dataset: DOMStringMap }).dataset.defRow!);
    const c = parseInt((el as HTMLElement & { dataset: DOMStringMap }).dataset.defCol!);
    if (!isNaN(r) && !isNaN(c) && t['definition_data']?.[r] !== undefined)
      t['definition_data']![r][c] = (el as HTMLInputElement).value;
  });

  saveTablesToLocal();
}

export function saveTablesToLocal(): void {
  if (localStorage.getItem('autosave_enabled') === 'true') {
    localStorage.setItem('editor_tables', JSON.stringify(tables));
    localStorage.setItem('editor_activeKey', activeKey || '');
  }
}
