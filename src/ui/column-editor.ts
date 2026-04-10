import { tables, activeKey, syncEditorToState } from '../state.ts';
import { renderEditor } from './callbacks.ts';
import { esc } from './utils.ts';
import type { Column } from '../types.ts';

export function columnRowHtml(col: Column, i: number): string {
  return /*html*/`
    <tr data-row="${i}">
      <td class="col-w-name">
        <input class="cell-input mono" data-col="${i}" data-field="name"
          value="${esc(col.name)}" placeholder="COLUMN_NAME">
      </td>
      <td class="col-w-type">
        <input class="cell-input mono" data-col="${i}" data-field="type"
          value="${esc(col.type)}" placeholder="VARCHAR2(...)">
      </td>
      <td class="col-w-def">
        <input class="cell-input mono" data-col="${i}" data-field="definition_table"
          value="${esc(col.definition_table || '')}" placeholder="TABLE_NAME">
      </td>
      <td class="col-w-desc">
        <textarea class="cell-input" data-col="${i}" data-field="description"
          placeholder="Describe this column…"
          >${esc(col.description)}</textarea>
      </td>
      <td class="col-w-del">
        <button class="row-del-btn" data-del-row="${i}" title="Delete column">✕</button>
      </td>
    </tr>`;
}

export function addColumn(): void {
  if (!activeKey) return;
  syncEditorToState();
  tables[activeKey].columns.push({
    name: '', type: '',
    description: '', definition_table: ''
  });
  renderEditor(tables[activeKey]);
  const inputs = document.querySelectorAll<HTMLElement>('[data-field="name"]');
  if (inputs.length) (inputs[inputs.length - 1] as HTMLElement).focus();
}
