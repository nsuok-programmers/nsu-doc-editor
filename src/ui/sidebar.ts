import { tables, activeKey, setActiveKey, syncEditorToState } from '../state.ts';
import { renderEditor, updateToolbarState } from './callbacks.ts';
import { esc } from './utils.ts';

export function refreshSidebar(): void {
  const list = document.getElementById('table-list');
  if (!list) return;
  list.innerHTML = '';

  Object.values(tables).forEach(t => {
    const item = document.createElement('div');
    item.className = 'table-list-item' + (t.name === activeKey ? ' active' : '');
    item.innerHTML = `
      <span class="tname">${esc(t.name)}</span>
      <span class="ttype-badge badge-${t.type}">${t.type}</span>
      <span class="col-count">${t.columns.length}c</span>
    `;
    item.addEventListener('click', () => {
      syncEditorToState();
      selectTable(t.name);
    });
    list.appendChild(item);
  });
}

export function selectTable(name: string): void {
  setActiveKey(name);
  refreshSidebar();
  renderEditor(tables[name]);
  (document.getElementById('empty-state') as HTMLElement).style.display    = 'none';
  (document.getElementById('editor-content') as HTMLElement).style.display = 'block';
  updateToolbarState();
}
