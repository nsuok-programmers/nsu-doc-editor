import { tables, activeKey, syncEditorToState } from '../state.ts';
import { renderEditor } from './callbacks.ts';
import { showToast } from './modals.ts';
import { parseDat } from '../parser.ts';
import { esc } from './utils.ts';
import type { Table } from '../types.ts';

export function definitionSectionHtml(table: Table): string {
  const headers  = table['definition_headers'] || [];
  const data     = table['definition_data']    || [];
  const colCount = data.length > 0
    ? Math.max(headers.length, ...data.map(r => r.length))
    : headers.length;

  const theadCells = Array.from({ length: colCount }, (_, i) => {
    const h = headers[i];
    return (h && h.trim())
      ? `<th>${esc(h)}</th>`
      : `<th class="def-header-unnamed">header_not_named</th>`;
  }).join('');

  return /*html*/`
    <div class="field-group" id="def-data-panel">
      <div class="field-group-header">
        📖 Definition Data
        <span class="header-meta">${data.length} rows</span>
        <span style="flex:1"></span>
        <button class="btn btn-ghost btn-sm" id="btn-paste-dat">Paste .dat</button>
        <label class="btn btn-ghost btn-sm" style="margin:0">
          Import .dat
          <input type="file" id="dat-file-input" accept=".dat,.txt,.tsv" style="display:none">
        </label>
      </div>
      <div class="field-group-body">
        <div class="def-headers-section">
          <div class="def-headers-top">
            <span class="field-label">Headers</span>
            <button class="btn btn-ghost btn-sm" id="btn-add-def-header">+ Header</button>
          </div>
          <div class="def-headers-list" id="def-headers-list">
            ${headers.map((h, i) => defHeaderInputHtml(h, i)).join('')}
            ${headers.length === 0 ? '<span class="def-no-headers">No headers defined</span>' : ''}
          </div>
        </div>
      </div>
      <div class="schema-table-wrap def-data-outer">
        <table class="schema" id="def-data-table">
          <thead>
            <tr>${theadCells}<th class="col-w-del"></th></tr>
          </thead>
          <tbody id="def-data-tbody" class="def-data-scroll">
            ${data.map((row, i) => defDataRowHtml(row, i, colCount)).join('')}
          </tbody>
        </table>
        <button class="add-row-btn" id="btn-add-def-row">+ Add row</button>
      </div>
    </div>`;
}

export function defHeaderInputHtml(header: string, i: number): string {
  return `<span class="def-header-chip">
    <input class="cell-input def-header-input" data-def-header="${i}"
      value="${esc(header)}" placeholder="Header name">
    <button class="tag-remove" data-del-def-header="${i}">×</button>
  </span>`;
}

export function defDataRowHtml(row: string[], rowIdx: number, colCount: number): string {
  let cells = '';
  for (let c = 0; c < colCount; c++) {
    cells += `<td><input class="cell-input mono" data-def-row="${rowIdx}" data-def-col="${c}" value="${esc(row[c] || '')}"></td>`;
  }
  return `<tr>${cells}<td class="col-w-del"><button class="row-del-btn" data-del-def-row="${rowIdx}" title="Delete row">✕</button></td></tr>`;
}

export function applyDatData(rows: string[][]): void {
  if (!activeKey) return;
  syncEditorToState();
  tables[activeKey]['definition_data'] = rows;
  renderEditor(tables[activeKey]);
  showToast(`Loaded ${rows.length} rows`, 'success');
}

export function bindDefinitionSection(): void {
  document.getElementById('btn-paste-dat')?.addEventListener('click', () => {
    (document.getElementById('paste-dat-textarea') as HTMLTextAreaElement).value = '';
    (document.getElementById('paste-dat-modal') as HTMLElement).style.display = 'flex';
    (document.getElementById('paste-dat-textarea') as HTMLElement).focus();
  });

  document.getElementById('dat-file-input')?.addEventListener('change', (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => applyDatData(parseDat(ev.target!.result as string));
    reader.readAsText(file);
  });

  document.getElementById('btn-add-def-header')?.addEventListener('click', () => {
    if (!activeKey) return;
    syncEditorToState();
    const idx = tables[activeKey]['definition_headers']!.length;
    tables[activeKey]['definition_headers']!.push('');
    const list = document.getElementById('def-headers-list');
    if (list) {
      list.querySelector('.def-no-headers')?.remove();
      list.insertAdjacentHTML('beforeend', defHeaderInputHtml('', idx));
      (list.querySelectorAll('.def-header-input').item(idx) as HTMLElement)?.focus({ preventScroll: true });
    }
  });

  document.getElementById('btn-add-def-row')?.addEventListener('click', () => {
    if (!activeKey) return;
    syncEditorToState();
    const colCount = (tables[activeKey]['definition_headers'] || []).length;
    if (!colCount) { showToast('No headers defined', 'error'); return; }
    tables[activeKey]['definition_data']!.push(Array(colCount).fill(''));
    renderEditor(tables[activeKey]);
  });

  // Update table header cells on blur without full re-render
  document.getElementById('def-headers-list')?.addEventListener('focusout', (e: FocusEvent) => {
    if (!(e.target as HTMLElement).matches('.def-header-input') || !activeKey) return;
    syncEditorToState();
    const headers  = tables[activeKey]['definition_headers'] || [];
    const data     = tables[activeKey]['definition_data']    || [];
    const colCount = data.length > 0
      ? Math.max(headers.length, ...data.map(r => r.length))
      : headers.length;
    const headerRow = document.querySelector('#def-data-table thead tr');
    if (headerRow) {
      const cells = Array.from({ length: colCount }, (_, i) => {
        const h = headers[i];
        return (h && h.trim())
          ? `<th>${esc(h)}</th>`
          : `<th class="def-header-unnamed">header_not_named</th>`;
      });
      cells.push(`<th class="col-w-del"></th>`);
      headerRow.innerHTML = cells.join('');
    }
  });
}

/** Binds the paste-.dat modal (cancel / submit / Escape). Called once from init(). */
export function bindPasteDatModal(): void {
  const datModal  = document.getElementById('paste-dat-modal');
  const datTa     = document.getElementById('paste-dat-textarea') as HTMLTextAreaElement | null;
  const datCancel = document.getElementById('paste-dat-cancel');
  const datSubmit = document.getElementById('paste-dat-submit');
  if (!datModal || !datTa || !datCancel || !datSubmit) return;

  datCancel.addEventListener('click', () => { datModal.style.display = 'none'; });
  datSubmit.addEventListener('click', () => {
    const text = datTa.value.trim();
    if (!text) { showToast('Paste .dat content first', 'error'); return; }
    applyDatData(parseDat(text));
    datModal.style.display = 'none';
  });
  datModal.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') datModal.style.display = 'none';
  });
}
