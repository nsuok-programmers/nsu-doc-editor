/**
 * editor.ts
 * Orchestrator: defines renderEditor, wires up all UI modules, and boots the app.
 */

import { toExportJson } from './parser.ts';
import { tables, activeKey, setActiveKey, setTables, syncEditorToState, saveTablesToLocal } from './state.ts';
import { registerCallbacks } from './ui/callbacks.ts';
import { esc, autoResizeAll, bindGlobalInputListeners } from './ui/utils.ts';
import { showToast, showConfirm, initConfirmModal } from './ui/modals.ts';
import { refreshSidebar, selectTable } from './ui/sidebar.ts';
import { bindDropZone, bindPasteInfoModal } from './ui/file-handler.ts';
import { bindBrowseRepoModal } from './ui/browse-repo.ts';
import { tagChipHtml, handleTagInput, bindTags } from './ui/tags.ts';
import { columnRowHtml, addColumn } from './ui/column-editor.ts';
import { definitionSectionHtml, bindDefinitionSection, bindPasteDatModal } from './ui/definition-editor.ts';
import { queryRowHtml, addQuery, initSqlEditors } from './ui/query-editor.ts';
import { refreshJsonPreview, copyJson, bindJsonAutoRefresh } from './ui/json-export.ts';
import { bindToolbar, updateToolbarState, removeTable } from './ui/toolbar.ts';
import { renderGitHubForm } from './ui/github-panel.ts';
import { bindCustomSelect } from './ui/custom-select.ts';
import type { Table } from './types.ts';

/* ----------------------- CENTRAL RENDER FUNCTION -------------------------- */

function renderEditor(table: Table): void {
  const content = document.getElementById('editor-content')!;

  content.innerHTML =
  /*html*/`
    <div class="editor-toolbar">
      <h1>${esc(table.name)}</h1>
      <button class="btn btn-ghost" id="btn-add-col">+ Add Column</button>
      <button class="btn btn-ghost" id="btn-refresh-json">Refresh JSON</button>
      <button class="btn btn-danger-soft" id="btn-remove-table">Remove</button>
    </div>

    <!-- Metadata -->
    <div class="field-group" id="metadata-panel">
      <div class="field-group-header">📋 Table Metadata</div>
      <div class="field-group-body">
        <div class="field-row">
          <label class="field-label">Table Name</label>
          <input class="field-input mono" id="meta-name" value="${esc(table.name)}" placeholder="TABLE_NAME">
        </div>
        <div class="field-row">
          <label class="field-label">Description</label>
          <textarea class="field-input" id="meta-desc" rows="2"
            placeholder="Describe what this table stores...">${esc(table.description)}</textarea>
        </div>
        <div class="field-row">
          <label class="field-label">Type</label>
          <div class="custom-select" id="meta-type-wrap">
            <button type="button" class="custom-select-btn" id="meta-type-btn">
              <span id="meta-type-label">${table.type === 'data' ? 'data — application / business data' : 'definition — validation / lookup table'}</span>
              <span class="custom-select-arrow">▾</span>
            </button>
            <ul class="custom-select-menu" id="meta-type-menu">
              <li class="custom-select-opt ${table.type === 'data' ? 'selected' : ''}" data-value="data">data — application / business data</li>
              <li class="custom-select-opt ${table.type === 'definition' ? 'selected' : ''}" data-value="definition">definition — validation / lookup table</li>
            </ul>
            <input type="hidden" id="meta-type" value="${table.type}">
          </div>
        </div>
        <div class="field-row">
          <label class="field-label">Tags</label>
          <div class="tags-container" id="tags-container"
               onclick="document.getElementById('tag-input').focus()">
            ${table.tags.map(t => tagChipHtml(t)).join('')}
            <input class="tag-input" id="tag-input" placeholder="Add tag, press Enter…">
          </div>
        </div>
      </div>
    </div>

    <!-- Columns -->
    <div class="field-group" id="columns-panel">
      <div class="field-group-header">
        🧱 Columns
        <span class="header-meta">${table.columns.length} total</span>
      </div>
      <div class="schema-table-wrap">
        <table class="schema" id="schema-table">
          <thead>
            <tr>
              <th class="col-w-name">Column Name</th>
              <th class="col-w-type">Data Type</th>
              <th class="col-w-def">Definition Table</th>
              <th class="col-w-desc">Description</th>
              <th class="col-w-del"></th>
            </tr>
          </thead>
          <tbody id="schema-tbody">
            ${table.columns.map((col, i) => columnRowHtml(col, i)).join('')}
          </tbody>
        </table>
        <button class="add-row-btn" id="btn-add-row">+ Add column</button>
      </div>
    </div>

    ${ table.type === 'definition' ? definitionSectionHtml(table) : '' }

    <div class="field-group" id="fg-queries">
      <div class="field-group-header">
        🔍 Queries
        <span class="header-meta">${table.queries.length} total</span>
      </div>
      <div class="field-group-body" id="queries-body">
        ${table.queries.length
          ? table.queries.map((q, i) => queryRowHtml(q, i)).join('')
          : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px">No queries yet.</p>'
        }
      </div>
      <button class="add-row-btn" id="btn-add-query">+ Add query</button>
    </div>

    <!-- JSON preview -->
    <div class="json-output">
      <div class="json-toolbar">
        <span>JSON Preview</span>
        <button class="btn btn-ghost btn-sm" id="btn-copy-json-inline">Copy</button>
      </div>
      <pre class="json-pre" id="json-pre">${esc(JSON.stringify(toExportJson(table), null, 2))}</pre>
    </div>

    <!-- Submit to GitHub -->
    <div class="field-group" id="github-submit-panel">
      <div class="field-group-header">🚀 Submit to GitHub</div>
      <div class="field-group-body" id="github-panel-body">
        <!-- Populated by renderGitHubForm() -->
      </div>
    </div>
  `;

  document.getElementById('btn-add-col')!.addEventListener('click', addColumn);
  document.getElementById('btn-add-row')!.addEventListener('click', addColumn);
  document.getElementById('btn-remove-table')!.addEventListener('click', () => removeTable(table.name));
  document.getElementById('btn-refresh-json')!.addEventListener('click', refreshJsonPreview);
  document.getElementById('btn-copy-json-inline')!.addEventListener('click', copyJson);
  document.getElementById('tag-input')!.addEventListener('keydown', handleTagInput);
  document.getElementById('btn-add-query')!.addEventListener('click', addQuery);
  bindCustomSelect();
  bindDefinitionSection();

  autoResizeAll();
  renderGitHubForm();
  initSqlEditors();
}

/* --------- Global delegated click handler for structural mutations --------- */

function bindGlobalDelegation(): void {
  document.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    const delBtn = target.closest<HTMLElement>('[data-del-row]');
    if (delBtn && activeKey) {
      const i = parseInt(delBtn.dataset.delRow!);
      syncEditorToState();
      tables[activeKey].columns.splice(i, 1);
      renderEditor(tables[activeKey]);
    }

    const delQuery = target.closest<HTMLElement>('[data-del-query]');
    if (delQuery && activeKey) {
      const i = parseInt(delQuery.dataset.delQuery!);
      syncEditorToState();
      tables[activeKey].queries.splice(i, 1);
      renderEditor(tables[activeKey]);
    }

    const delDefHeader = target.closest<HTMLElement>('[data-del-def-header]');
    if (delDefHeader && activeKey) {
      const i = parseInt(delDefHeader.dataset.delDefHeader!);
      syncEditorToState();
      tables[activeKey]['definition_headers']!.splice(i, 1);
      tables[activeKey]['definition_data']!.forEach(row => row.splice(i, 1));
      renderEditor(tables[activeKey]);
    }

    const delDefRow = target.closest<HTMLElement>('[data-del-def-row]');
    if (delDefRow && activeKey) {
      const i = parseInt(delDefRow.dataset.delDefRow!);
      syncEditorToState();
      tables[activeKey]['definition_data']!.splice(i, 1);
      renderEditor(tables[activeKey]);
    }
  });
}

/* ---------------------------------- BOOT ---------------------------------- */

export function init(): void {
  // Register cross-cutting callbacks FIRST so sub-modules can call them
  registerCallbacks({ renderEditor, refreshSidebar, selectTable, updateToolbarState });

  // Bind all UI sections
  bindDropZone();
  bindPasteInfoModal();
  bindPasteDatModal();
  bindToolbar();
  bindBrowseRepoModal();
  bindTags();
  initConfirmModal();
  bindGlobalDelegation();
  bindGlobalInputListeners();
  bindJsonAutoRefresh();
  window.addEventListener('resize', autoResizeAll);

  // Restore tables from localStorage if autosave is enabled
  const autosaveCheckbox = document.getElementById('autosave-checkbox') as HTMLInputElement | null;
  if (autosaveCheckbox) {
    const enabled = localStorage.getItem('autosave_enabled') === 'true';
    autosaveCheckbox.checked = enabled;
    if (enabled) {
      const saved    = localStorage.getItem('editor_tables');
      const savedKey = localStorage.getItem('editor_activeKey');
      if (saved) {
        try {
          setTables(JSON.parse(saved));
          if (savedKey && tables[savedKey]) {
            setActiveKey(savedKey);
          } else {
            const keys = Object.keys(tables);
            setActiveKey(keys.length ? keys[0] : null);
          }
          refreshSidebar();
          if (activeKey && tables[activeKey]) selectTable(activeKey);
          updateToolbarState();
        } catch {
          setTables({});
          setActiveKey(null);
        }
      }
    }
  }
}

// Re-export for any external callers (e.g. index.html inline scripts)
export { syncEditorToState, showConfirm, showToast, saveTablesToLocal };
