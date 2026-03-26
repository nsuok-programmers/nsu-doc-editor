/**
 * editor.js
 * Renders and manages the table editor UI.
 * Imports parser.js for .info parsing and github.js for submission.
 */

import { parseInfo, toExportJson, parseDat, serializeDat } from './parser.js';
import { submitTableDefinition, listRepoTables, fetchTableFromRepo } from './github.js';
import JSZip from 'https://esm.sh/jszip';
import { minimalSetup } from 'https://esm.sh/codemirror';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from 'https://esm.sh/@codemirror/view';
import { EditorState } from 'https://esm.sh/@codemirror/state';
import { sql } from 'https://esm.sh/@codemirror/lang-sql';
import { indentWithTab } from 'https://esm.sh/@codemirror/commands';
import { oneDark } from 'https://esm.sh/@codemirror/theme-one-dark';

const cmTheme = EditorView.theme({
  '&': { fontSize: '12px' },
  '.cm-editor': { background: '#0c1410' },
  '.cm-scroller': { fontFamily: "'IBM Plex Mono', monospace" },
  '.cm-content': { padding: '0.3rem 0.5rem', minHeight: '5rem', caretColor: '#00a882' },
  '.cm-focused': { outline: 'none' },
  '.cm-gutters': { background: '#141d1a', borderRight: '1px solid #243530', color: '#4a6b62' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.5rem' },
  '.cm-activeLine': { background: 'rgba(0,168,130,0.05)' },
  '.cm-activeLineGutter': { background: 'rgba(0,168,130,0.08)', color: '#7da898' },
  '.cm-selectionBackground': { background: 'rgba(0,168,130,0.25) !important' },
});

const sqlEditors = new Map(); // query index → EditorView

/* ---------------------------------- STATE --------------------------------- */

let tables    = {};      // { TABLE_NAME: tableObj }
let activeKey = null;    // currently displayed table name

/* ---------------------------------- BOOT ---------------------------------- */

export function init() {
  bindDropZone();
  bindToolbar();
  bindGitHubPanel();
  window.addEventListener('resize', autoResizeAll);

  // Paste Info modal logic
  const pasteBtn = document.getElementById('paste-info-btn');
  const modal    = document.getElementById('paste-info-modal');
  const ta       = document.getElementById('paste-info-textarea');
  const cancel   = document.getElementById('paste-info-cancel');
  const submit   = document.getElementById('paste-info-submit');
  if (pasteBtn && modal && ta && cancel && submit) {
    pasteBtn.addEventListener('click', () => {
      ta.value = '';
      modal.style.display = 'flex';
      ta.focus();
    });
    cancel.addEventListener('click', () => {
      modal.style.display = 'none';
    });
    submit.addEventListener('click', async () => {
      const text = ta.value.trim();
      if (!text) { showToast('Paste .info file content first', 'error'); return; }
      const parsed = parseInfo(text);
      if (!parsed.name) { showToast('Could not parse pasted info', 'error'); return; }
      modal.style.display = 'none';
      await loadInfoTable(parsed);
    });
    // Hide modal on Escape
    modal.addEventListener('keydown', e => {
      if (e.key === 'Escape') modal.style.display = 'none';
    });
  }

  // Paste .dat modal logic
  const datModal  = document.getElementById('paste-dat-modal');
  const datTa     = document.getElementById('paste-dat-textarea');
  const datCancel = document.getElementById('paste-dat-cancel');
  const datSubmit = document.getElementById('paste-dat-submit');
  if (datModal && datTa && datCancel && datSubmit) {
    datCancel.addEventListener('click', () => { datModal.style.display = 'none'; });
    datSubmit.addEventListener('click', () => {
      const text = datTa.value.trim();
      if (!text) { showToast('Paste .dat content first', 'error'); return; }
      applyDatData(parseDat(text));
      datModal.style.display = 'none';
    });
    datModal.addEventListener('keydown', e => {
      if (e.key === 'Escape') datModal.style.display = 'none';
    });
  }

  initConfirmModal();
  bindBrowseRepoModal();

  // Restore tables from localStorage if autosave is enabled
  const autosaveCheckbox = document.getElementById('autosave-checkbox');
  if (autosaveCheckbox) {
    const enabled = localStorage.getItem('autosave_enabled') === 'true';
    autosaveCheckbox.checked = enabled;
    if (enabled) {
      const saved = localStorage.getItem('editor_tables');
      const savedKey = localStorage.getItem('editor_activeKey');
      if (saved) {
        try {
          tables = JSON.parse(saved);
          if (savedKey && tables[savedKey]) {
            activeKey = savedKey;
          } else {
            // If savedKey is missing or not found, pick the first table if any
            const keys = Object.keys(tables);
            activeKey = keys.length ? keys[0] : null;
          }
          refreshSidebar();
          if (activeKey && tables[activeKey]) selectTable(activeKey);
          updateToolbarState();
        } catch (e) {
          tables = {};
          activeKey = null;
        }
      }
    }
  }
}

/* --------------------------- BROWSE REPO MODAL ---------------------------- */

function bindBrowseRepoModal() {
  const browseBtn   = document.getElementById('browse-repo-btn');
  const modal       = document.getElementById('browse-repo-modal');
  const cancelBtn   = document.getElementById('browse-repo-cancel');
  const importBtn   = document.getElementById('browse-repo-import');
  const listEl      = document.getElementById('browse-repo-list');
  if (!browseBtn || !modal) return;

  function closeModal() {
    modal.style.display = 'none';
    listEl.innerHTML = '';
    importBtn.disabled = true;
    importBtn.textContent = 'Import Selected';
  }

  browseBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
    loadRepoTableList();
  });
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.style.display === 'flex') closeModal(); });

  // Enable/disable Import button based on checkbox state (event delegation)
  listEl.addEventListener('change', () => {
    importBtn.disabled = !listEl.querySelector('.browse-repo-check:checked');
  });

  importBtn.addEventListener('click', async () => {
    const checked = [...listEl.querySelectorAll('.browse-repo-check:checked')].map(cb => ({ name: cb.value, type: cb.dataset.tableType }));
    if (!checked.length) return;

    importBtn.disabled = true;
    importBtn.textContent = 'Importing…';

    const results = await Promise.allSettled(checked.map(({ name, type }) => fetchTableFromRepo(name, type)));

    let successes = 0;
    let failures  = 0;
    let firstSuccessName = null;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        tables[r.value.name] = r.value;
        if (!firstSuccessName) firstSuccessName = r.value.name;
        successes++;
      } else {
        failures++;
        console.error(`Failed to import ${checked[i]}:`, r.reason);
      }
    });

    refreshSidebar();
    updateToolbarState();
    if (!activeKey && firstSuccessName) {
      selectTable(firstSuccessName);
    } else if (activeKey && tables[activeKey]) {
      renderEditor(tables[activeKey]);
    }
    closeModal();

    if (failures === 0) {
      showToast(`Imported ${successes} table${successes !== 1 ? 's' : ''}`, 'success');
    } else if (successes > 0) {
      showToast(`Imported ${successes}, failed ${failures} — see console`, 'error');
    } else {
      showToast('Import failed — see console', 'error');
    }
  });
}

async function loadRepoTableList() {
  const listEl   = document.getElementById('browse-repo-list');
  const importBtn = document.getElementById('browse-repo-import');
  importBtn.disabled = true;

  listEl.innerHTML = '<div class="browse-repo-loading"><span class="browse-repo-spinner"></span>Fetching table list…</div>';

  try {
    const names = await listRepoTables();
    renderRepoTableList(names);
  } catch (err) {
    listEl.innerHTML = `<p style="padding:1.25rem;font-family:var(--mono);font-size:12px;color:var(--danger)">${err.message}</p>`;
  }
}

function renderRepoTableList(items) {
  const listEl = document.getElementById('browse-repo-list');

  if (!items.length) {
    listEl.innerHTML = '<p style="padding:1.25rem;font-family:var(--mono);font-size:12px;color:var(--text3)">No tables found in table-definitions/</p>';
    return;
  }

  const byType = { data: [], definition: [] };
  items.forEach(item => { (byType[item.type] ??= []).push(item); });

  // Search bar
  const searchWrap  = document.createElement('div');
  searchWrap.className = 'browse-repo-search';
  const searchInput = document.createElement('input');
  searchInput.type        = 'text';
  searchInput.className   = 'field-input';
  searchInput.placeholder = 'Search tables…';
  searchWrap.appendChild(searchInput);

  const tabBar  = document.createElement('div');
  tabBar.className = 'browse-repo-tabs';

  const panels = document.createElement('div');

  ['data', 'definition'].forEach((type, i) => {
    const typeItems = byType[type] || [];

    const tab = document.createElement('button');
    tab.type          = 'button';
    tab.className     = 'browse-tab' + (i === 0 ? ' active' : '');
    tab.dataset.tab   = type;
    tab.textContent   = `${type.charAt(0).toUpperCase() + type.slice(1)} (${typeItems.length})`;
    tabBar.appendChild(tab);

    const panel = document.createElement('div');
    panel.className      = 'browse-repo-panel' + (i === 0 ? ' active' : '');
    panel.dataset.panel  = type;

    if (!typeItems.length) {
      const empty = document.createElement('p');
      empty.style.cssText = 'padding:1.25rem;font-family:var(--mono);font-size:12px;color:var(--text3)';
      empty.textContent   = `No ${type} tables found.`;
      panel.appendChild(empty);
    } else {
      const grid = document.createElement('div');
      grid.className = 'browse-repo-grid';

      typeItems.forEach(({ name, type: t }) => {
        const card = document.createElement('label');
        card.className = 'browse-repo-card';

        const cb = document.createElement('input');
        cb.type              = 'checkbox';
        cb.value             = name;
        cb.className         = 'browse-repo-check';
        cb.dataset.tableType = t;

        const nameSpan = document.createElement('span');
        nameSpan.className   = 'browse-card-name';
        nameSpan.textContent = name;

        card.appendChild(cb);
        card.appendChild(nameSpan);

        if (tables[name]) {
          const badge = document.createElement('span');
          badge.className   = 'browse-repo-loaded-badge';
          badge.textContent = 'loaded';
          card.appendChild(badge);
        }

        grid.appendChild(card);
      });

      panel.appendChild(grid);
    }

    panels.appendChild(panel);
  });

  tabBar.addEventListener('click', e => {
    const btn = e.target.closest('.browse-tab');
    if (!btn) return;
    tabBar.querySelectorAll('.browse-tab').forEach(t => t.classList.remove('active'));
    panels.querySelectorAll('.browse-repo-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    panels.querySelector(`.browse-repo-panel[data-panel="${btn.dataset.tab}"]`).classList.add('active');
  });

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    panels.querySelectorAll('.browse-repo-card').forEach(card => {
      const name = card.querySelector('.browse-card-name').textContent.toLowerCase();
      card.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
    tabBar.querySelectorAll('.browse-tab').forEach(tab => {
      const type  = tab.dataset.tab;
      const panel = panels.querySelector(`.browse-repo-panel[data-panel="${type}"]`);
      const total   = (byType[type] || []).length;
      const visible = panel ? [...panel.querySelectorAll('.browse-repo-card')].filter(c => c.style.display !== 'none').length : 0;
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      tab.textContent = q ? `${label} (${visible}/${total})` : `${label} (${total})`;
    });
  });

  listEl.innerHTML = '';
  listEl.appendChild(searchWrap);
  listEl.appendChild(tabBar);
  listEl.appendChild(panels);
}

/* ------------------------------ FILE HANDLING ----------------------------- */

function bindDropZone() {
  const zone  = document.getElementById('drop-zone');
  const input = document.getElementById('file-input');

  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    handleFiles([...e.dataTransfer.files]);
  });
  input.addEventListener('change', () => handleFiles([...input.files]));
}

function handleFiles(files) {
  const infoFiles = files.filter(f => f.name.endsWith('.info'));
  if (!infoFiles.length) { showToast('No .info files found', 'error'); return; }

  infoFiles.forEach(file => {
    const reader = new FileReader();
    reader.onload = async e => {
      const parsed = parseInfo(e.target.result);
      if (!parsed.name) { showToast(`Could not parse: ${file.name}`, 'error'); return; }
      await loadInfoTable(parsed);
    };
    reader.readAsText(file);
  });
}

async function loadInfoTable(parsed) {
  // Check if the table already exists in the repo
  let repoMatch = null;
  try {
    const repoTables = await listRepoTables();
    repoMatch = repoTables.find(t => t.name === parsed.name) || null;
  } catch { /* repo unavailable — proceed with local */ }

  if (repoMatch) {
    const useRepo = await showConfirm(
      `"${parsed.name}" already exists in the repo.\n\nImport from repo to get existing queries, definition data, and other metadata — or continue with the local .info file.`,
      { title: 'Table Exists in Repo', okLabel: 'Import from Repo', cancelLabel: 'Use Local File' }
    );
    if (useRepo) {
      try {
        const table = await fetchTableFromRepo(repoMatch.name, repoMatch.type);
        tables[table.name] = table;
        refreshSidebar();
        if (!activeKey) selectTable(table.name);
        updateToolbarState();
        showToast(`Imported ${table.name} from repo`, 'success');
        return;
      } catch (err) {
        showToast(`Repo import failed: ${err.message} — loading local .info`, 'error');
      }
    }
  }

  tables[parsed.name] = parsed;
  refreshSidebar();
  if (!activeKey) selectTable(parsed.name);
  updateToolbarState();
  showToast(`Loaded ${parsed.name} (${parsed.columns.length} cols)`, 'success');
}

/* --------------------------------- SIDEBAR -------------------------------- */

function refreshSidebar() {
  const list = document.getElementById('table-list');
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

/* ----------------------- TABLE SELECTION & RENDERING ---------------------- */

function selectTable(name) {
  activeKey = name;
  refreshSidebar();
  renderEditor(tables[name]);
  document.getElementById('empty-state').style.display    = 'none';
  document.getElementById('editor-content').style.display = 'block';
  updateToolbarState();
}

function renderEditor(table) {
  const content = document.getElementById('editor-content');

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
        <!-- Populated by bindGitHubPanel() -->
      </div>
    </div>
  `;

  // Bind events that are scoped to the rendered editor
  document.getElementById('btn-add-col').addEventListener('click', addColumn);
  document.getElementById('btn-add-row').addEventListener('click', addColumn);
  document.getElementById('btn-remove-table').addEventListener('click', () => removeTable(table.name));
  document.getElementById('btn-refresh-json').addEventListener('click', refreshJsonPreview);
  document.getElementById('btn-copy-json-inline').addEventListener('click', copyJson);
  document.getElementById('tag-input').addEventListener('keydown', handleTagInput);
  document.getElementById('btn-add-query').addEventListener('click', addQuery);
  bindCustomSelect();
  bindDefinitionSection();

  autoResizeAll();
  renderGitHubForm();
  initSqlEditors();
}

/* -------------------------- COLUMN ROW RENDERING -------------------------- */

function columnRowHtml(col, i) {
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

/* ----------------------- DEFINITION DATA RENDERING ----------------------- */

function definitionSectionHtml(table) {
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

function defHeaderInputHtml(header, i) {
  return `<span class="def-header-chip">
    <input class="cell-input def-header-input" data-def-header="${i}"
      value="${esc(header)}" placeholder="Header name">
    <button class="tag-remove" data-del-def-header="${i}">×</button>
  </span>`;
}

function defDataRowHtml(row, rowIdx, colCount) {
  let cells = '';
  for (let c = 0; c < colCount; c++) {
    cells += `<td><input class="cell-input mono" data-def-row="${rowIdx}" data-def-col="${c}" value="${esc(row[c] || '')}"></td>`;
  }
  return `<tr>${cells}<td class="col-w-del"><button class="row-del-btn" data-del-def-row="${rowIdx}" title="Delete row">✕</button></td></tr>`;
}

function bindDefinitionSection() {
  document.getElementById('btn-paste-dat')?.addEventListener('click', () => {
    document.getElementById('paste-dat-textarea').value = '';
    document.getElementById('paste-dat-modal').style.display = 'flex';
    document.getElementById('paste-dat-textarea').focus();
  });
  document.getElementById('dat-file-input')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => applyDatData(parseDat(ev.target.result));
    reader.readAsText(file);
  });
  document.getElementById('btn-add-def-header')?.addEventListener('click', () => {
    syncEditorToState();
    const idx = tables[activeKey]['definition_headers'].length;
    tables[activeKey]['definition_headers'].push('');
    const list = document.getElementById('def-headers-list');
    if (list) {
      list.querySelector('.def-no-headers')?.remove();
      list.insertAdjacentHTML('beforeend', defHeaderInputHtml('', idx));
      list.querySelectorAll('.def-header-input').item(idx)?.focus({ preventScroll: true });
    }
  });
  document.getElementById('btn-add-def-row')?.addEventListener('click', () => {
    syncEditorToState();
    const colCount = (tables[activeKey]['definition_headers'] || []).length;
    if (!colCount) { showToast('No headers defined', 'error'); return; }
    tables[activeKey]['definition_data'].push(Array(colCount).fill(''));
    renderEditor(tables[activeKey]);
  });

  // Update table header cells on blur without full re-render
  document.getElementById('def-headers-list')?.addEventListener('focusout', e => {
    if (!e.target.matches('.def-header-input') || !activeKey) return;
    syncEditorToState();
    const headers = tables[activeKey]['definition_headers'] || [];
    const data    = tables[activeKey]['definition_data']    || [];
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

function applyDatData(rows) {
  if (!activeKey) return;
  syncEditorToState();
  tables[activeKey]['definition_data'] = rows;
  renderEditor(tables[activeKey]);
  showToast(`Loaded ${rows.length} rows`, 'success');
}

// Use event delegation on tbody for PK toggle and row delete
document.addEventListener('click', e => {
  // Row delete
  const delBtn = e.target.closest('[data-del-row]');
  if (delBtn && activeKey) {
    const i = parseInt(delBtn.dataset.delRow);
    syncEditorToState();
    tables[activeKey].columns.splice(i, 1);
    renderEditor(tables[activeKey]);
  }

  // Delete query
  const delQuery = e.target.closest('[data-del-query]');
  if (delQuery && activeKey) {
    const i = parseInt(delQuery.dataset.delQuery);
    syncEditorToState();
    tables[activeKey].queries.splice(i, 1);
    renderEditor(tables[activeKey]);
  }

  // Delete definition header
  const delDefHeader = e.target.closest('[data-del-def-header]');
  if (delDefHeader && activeKey) {
    const i = parseInt(delDefHeader.dataset.delDefHeader);
    syncEditorToState();
    tables[activeKey]['definition_headers'].splice(i, 1);
    tables[activeKey]['definition_data'].forEach(row => row.splice(i, 1));
    renderEditor(tables[activeKey]);
  }

  // Delete definition data row
  const delDefRow = e.target.closest('[data-del-def-row]');
  if (delDefRow && activeKey) {
    const i = parseInt(delDefRow.dataset.delDefRow);
    syncEditorToState();
    tables[activeKey]['definition_data'].splice(i, 1);
    renderEditor(tables[activeKey]);
  }
});

// Auto-resize textareas on input
document.addEventListener('input', e => {
  if (e.target.matches('textarea.cell-input')) {
    e.target.style.height = '0';
    e.target.style.height = e.target.scrollHeight + 'px';
  }
});

// Auto-refresh JSON preview on any field change
let _jsonRefreshTimer;
document.addEventListener('input', e => {
  if (!activeKey || !e.target.closest('#editor-content')) return;
  clearTimeout(_jsonRefreshTimer);
  _jsonRefreshTimer = setTimeout(refreshJsonPreview, 400);
});

// Auto-append .sql extension on query file inputs
document.addEventListener('blur', e => {
  if (!e.target.matches('[data-qfield="file"]')) return;
  const val = e.target.value.trim();
  if (val && !val.endsWith('.sql')) {
    e.target.value = val + '.sql';
  }
}, true);


/* ---------------------------- COLUMN OPERATIONS --------------------------- */

function addColumn() {
  if (!activeKey) return;
  syncEditorToState();
  tables[activeKey].columns.push({
    name: '', type: '',
    description: '', definition_table: ''
  });
  renderEditor(tables[activeKey]);
  const inputs = document.querySelectorAll('[data-field="name"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

/* ---------------------------------- TAGS ---------------------------------- */

function handleTagInput(e) {
  if (e.key !== 'Enter' && e.key !== ',') {
    if (e.key === 'Backspace' && !e.target.value && activeKey) {
      const tags = tables[activeKey].tags;
      if (tags.length) removeTag(tags[tags.length - 1]);
    }
    return;
  }
  e.preventDefault();
  const val = e.target.value.trim().replace(/,/g, '');
  if (!val || !activeKey) return;
  if (!tables[activeKey].tags.includes(val)) {
    tables[activeKey].tags.push(val);
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.dataset.tag = val;
    chip.innerHTML = `${esc(val)}<button class="tag-remove" data-tag="${esc(val)}">×</button>`;
    e.target.parentNode.insertBefore(chip, e.target);
  }
  e.target.value = '';
}

document.addEventListener('click', e => {
  if (e.target.matches('.tag-remove')) {
    removeTag(e.target.dataset.tag);
  }
});

function removeTag(tag) {
  if (!activeKey) return;
  tables[activeKey].tags = tables[activeKey].tags.filter(t => t !== tag);
  const chip = document.querySelector(`.tag-chip[data-tag="${tag}"]`);
  if (chip) chip.remove();
}

function tagChipHtml(tag) {
  return `<span class="tag-chip" data-tag="${esc(tag)}">${esc(tag)}<button class="tag-remove" data-tag="${esc(tag)}">×</button></span>`;
}

/* -------------------- State SYNC  (DOM → STATE OBJECT) -------------------- */

export function syncEditorToState() {
  if (!activeKey || !tables[activeKey]) return;
  const t = tables[activeKey];

  const nameEl = document.getElementById('meta-name');
  const descEl = document.getElementById('meta-desc');
  const typeEl = document.getElementById('meta-type');

  if (nameEl) {
    const newName = nameEl.value.trim().toUpperCase();
    if (newName && newName !== t.name) {
      tables[newName] = t;
      delete tables[t.name];
      t.name  = newName;
      activeKey = newName;
    }
  }
  if (descEl) t.description = descEl.value.trim();
  if (typeEl) t.type = typeEl.value;

  document.querySelectorAll('[data-col]').forEach(el => {
    const i     = parseInt(el.dataset.col);
    const field = el.dataset.field;
    if (!isNaN(i) && field && t.columns[i] !== undefined) {
      t.columns[i][field] = el.dataset.value !== undefined ? el.dataset.value : el.value;
    }
  });

  // Query Sync
  document.querySelectorAll('[data-qfield]').forEach(el => {
    const i     = parseInt(el.dataset.query);
    const field = el.dataset.qfield;
    if (!isNaN(i) && field && tables[activeKey].queries[i] !== undefined) {
      tables[activeKey].queries[i][field] = el.value;
    }
  });

  // SQL from CodeMirror instances
  sqlEditors.forEach((editor, i) => {
    if (tables[activeKey].queries[i] !== undefined) {
      tables[activeKey].queries[i].sql = editor.state.doc.toString();
    }
  });

  // Definition headers sync
  document.querySelectorAll('[data-def-header]').forEach(el => {
    const i = parseInt(el.dataset.defHeader);
    if (!isNaN(i) && t['definition_headers']?.[i] !== undefined)
      t['definition_headers'][i] = el.value;
  });

  // Definition data sync
  document.querySelectorAll('[data-def-row][data-def-col]').forEach(el => {
    const r = parseInt(el.dataset.defRow);
    const c = parseInt(el.dataset.defCol);
    if (!isNaN(r) && !isNaN(c) && t['definition_data']?.[r] !== undefined)
      t['definition_data'][r][c] = el.value;
  });

  // Save to localStorage if autosave is enabled
  saveTablesToLocal();
}

function saveTablesToLocal() {
  if (localStorage.getItem('autosave_enabled') === 'true') {
    localStorage.setItem('editor_tables', JSON.stringify(tables));
    localStorage.setItem('editor_activeKey', activeKey || '');
  }
}

/* --------------------------- JSON PREVIEW & COPY -------------------------- */

function getCleanJson() {
  syncEditorToState();
  return JSON.stringify(toExportJson(tables[activeKey]), null, 2);
}

function refreshJsonPreview() {
  const pre = document.getElementById('json-pre');
  if (pre) pre.textContent = getCleanJson();
}

function copyJson() {
  navigator.clipboard.writeText(getCleanJson())
    .then(() => showToast('JSON copied', 'success'));
}

/* --------------------------------- TOOLBAR -------------------------------- */

function bindToolbar() {
    // Robust autosave checkbox event handler
    const autosaveCheckbox = document.getElementById('autosave-checkbox');
    if (autosaveCheckbox) {
      autosaveCheckbox.addEventListener('change', async () => {
        if (autosaveCheckbox.checked) {
          localStorage.setItem('autosave_enabled', 'true');
          saveTablesToLocal();
          showToast('Autosave enabled', 'success');
        } else {
          if (await showConfirm('Disable autosave and delete all locally saved tables?', { title: 'Disable Autosave', okLabel: 'Disable & Clear', cancelLabel: 'Keep Enabled' })) {
            localStorage.removeItem('autosave_enabled');
            localStorage.removeItem('editor_tables');
            localStorage.removeItem('editor_activeKey');
            showToast('Autosave disabled and local data cleared', 'success');
          } else {
            autosaveCheckbox.checked = true;
          }
        }
      });
    }
  document.getElementById('btn-copy-json').addEventListener('click', () => {
    if (activeKey) copyJson();
  });

  document.getElementById('btn-download-json').addEventListener('click', async () => {
    if (!activeKey) return;
    syncEditorToState();

    const zip = new JSZip();
    const folder = zip.folder(activeKey);

    folder.file(`${activeKey}.json`, getCleanJson());

    const sqlFolder = folder.folder('sql');
    for (const query of tables[activeKey].queries) {
      if (query.file && query.sql) {
        sqlFolder.file(query.file, query.sql);
      }
    }

    if (tables[activeKey].type === 'definition' && tables[activeKey]['definition_data']?.length) {
      folder.file(`${activeKey}.dat`, serializeDat(tables[activeKey]['definition_data']));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${activeKey}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${activeKey}.zip`, 'success');
  });

  document.getElementById('btn-clear').addEventListener('click', async () => {
    if (!await showConfirm('Clear all loaded tables?', { title: 'Clear All', okLabel: 'Clear All', cancelLabel: 'Cancel' })) return;
    tables    = {};
    activeKey = null;
    refreshSidebar();
    document.getElementById('empty-state').style.display    = 'flex';
    document.getElementById('editor-content').style.display = 'none';
    updateToolbarState();
    saveTablesToLocal();
  });
}

function updateToolbarState() {
  const hasAny    = Object.keys(tables).length > 0;
  const hasActive = !!activeKey;
  document.getElementById('btn-clear').disabled         = !hasAny;
  document.getElementById('btn-copy-json').disabled     = !hasActive;
  document.getElementById('btn-download-json').disabled = !hasActive;
}

async function removeTable(name) {
  if (!await showConfirm(`Remove "${name}" from the editor?`, { title: 'Remove Table', okLabel: 'Remove', cancelLabel: 'Cancel' })) return;
  delete tables[name];
  activeKey = null;
  refreshSidebar();
  const remaining = Object.keys(tables);
  if (remaining.length) {
    selectTable(remaining[0]);
  } else {
    document.getElementById('empty-state').style.display    = 'flex';
    document.getElementById('editor-content').style.display = 'none';
  }
  updateToolbarState();
  saveTablesToLocal();
}

/* --------------------------- GITHUB SUBMIT PANEL -------------------------- */

function bindGitHubPanel() {
  // Nothing to bind at boot — the panel is rendered per-table by renderGitHubForm()
}

function renderGitHubForm() {
  const body = document.getElementById('github-panel-body');
  if (!body) return;

  const saved = JSON.parse(localStorage.getItem('gh_submitter') || '{}');

  body.innerHTML = /*html*/`
    <div class="gh-info">
      Opens a Pull Request to the docs repo for review. Fill in your details below.
    </div>
    <div class="field-row">
      <label class="field-label">Your Name</label>
      <input class="field-input" id="gh-name" value="${esc(saved.name || '')}" placeholder="Jane Smith">
    </div>
    <div class="field-row">
      <label class="field-label">Team</label>
      <input class="field-input" id="gh-team" value="${esc(saved.team || '')}" placeholder="Enterprise, Programmers, Sys Admin, etc.">
    </div>
    <div class="field-row">
      <label class="field-label">Notes</label>
      <textarea class="field-input" id="gh-desc" rows="2"
        placeholder="Any context for the reviewer…">${esc(saved.desc || '')}</textarea>
    </div>
    <div style="display:flex;gap:0.75rem;margin-top:0.75rem;align-items:center">
      <button class="btn btn-primary" id="btn-gh-submit">Open Pull Request</button>
      <span id="gh-status" style="font-family:var(--mono);font-size:12px;color:var(--text3)"></span>
    </div>
  `;

  document.getElementById('btn-gh-submit').addEventListener('click', submitToGitHub);
}

async function submitToGitHub() {
  if (!activeKey) return;
  syncEditorToState();

  const name = document.getElementById('gh-name')?.value?.trim();
  const team = document.getElementById('gh-team')?.value?.trim();
  const desc = document.getElementById('gh-desc')?.value?.trim();

  if (!name || !team) {
    setGhStatus('Please enter your name and team.', 'error');
    return;
  }

  const t = tables[activeKey];
  if (t.type === 'definition' && t.definition_data?.length && !t.definition_headers?.length) {
    setGhStatus('Definition data has no headers. Add headers before submitting.', 'error');
    return;
  }

  // Persist submitter info for convenience
  localStorage.setItem('gh_submitter', JSON.stringify({ name, team, desc }));

  setGhStatus('Creating branch…', '');
  const btn = document.getElementById('btn-gh-submit');
  btn.disabled = true;

  try {
    const { prUrl } = await submitTableDefinition({
      tableName:      activeKey,
      tableType:      tables[activeKey].type || 'data',
      jsonContent:    getCleanJson(),
      queries:        tables[activeKey].queries,
      definitionData: tables[activeKey]['definition_data'],
      submitterName:  name,
      submitterTeam:  team,
      description:    desc
    });

    setGhStatus(
      `✓ PR opened! <a href="${prUrl}" target="_blank" style="color:var(--accent)">View →</a>`,
      'success'
    );
    showToast('Pull Request opened', 'success');
  } catch (e) {
    setGhStatus(`✕ ${e.message}`, 'error');
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function setGhStatus(html, type) {
  const el = document.getElementById('gh-status');
  if (!el) return;
  el.innerHTML = html;
  el.style.color = type === 'success' ? 'var(--success)'
                 : type === 'error'   ? 'var(--danger)'
                 : 'var(--text3)';
}

/* ---------------------------------- TOAST --------------------------------- */

/* ----------------------------- CONFIRM MODAL ------------------------------ */

let _confirmResolve = null;

export function showConfirm(message, { title = 'Confirm', okLabel = 'OK', cancelLabel = 'Cancel' } = {}) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirm-title').textContent   = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-ok').textContent      = okLabel;
    document.getElementById('confirm-cancel').textContent  = cancelLabel;
    document.getElementById('confirm-modal').style.display = 'flex';
  });
}

function initConfirmModal() {
  const modal  = document.getElementById('confirm-modal');
  const okBtn  = document.getElementById('confirm-ok');
  const canBtn = document.getElementById('confirm-cancel');
  const settle = val => {
    modal.style.display = 'none';
    if (_confirmResolve) { _confirmResolve(val); _confirmResolve = null; }
  };
  okBtn.addEventListener('click',  () => settle(true));
  canBtn.addEventListener('click', () => settle(false));
  modal.addEventListener('keydown', e => { if (e.key === 'Escape') settle(false); });
}

export function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  const icons = { success: '✓', error: '✕', '': 'ℹ' };
  t.innerHTML  = `<span>${icons[type] || 'ℹ'}</span> ${msg}`;
  t.className  = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* --------------------------------- QUERIES -------------------------------- */

function queryRowHtml(query, i) {
  return /*html*/`
    <div class="query-card" data-query="${i}">
      <div class="query-card-header">
        <input class="field-input mono" data-qfield="file" data-query="${i}"
          value="${esc(query.file)}" placeholder="filename.sql"
          style="max-width:400px;flex-shrink:0">
        <input
          class="field-input"
          id="query-name-${i}"
          data-qfield="name"
          data-query="${i}"
          value="${esc(query.name)}"
          placeholder="Query display name"
          style="flex:1"
        >
        <button class="query-del-btn" data-del-query="${i}" title="Remove query">✕ Remove</button>
      </div>
      <textarea class="field-input" data-qfield="description" data-query="${i}"
        rows="2" placeholder="Describe what this query does..."
        style="margin-top:0.5rem">${esc(query.description)}</textarea>
      <div class="sql-editor-wrap" data-sql-editor="${i}"></div>
    </div>
  `;
}

function addQuery() {
  if (!activeKey) return;
  syncEditorToState();
  tables[activeKey].queries.push({ name: '', description: '', file: '', sql: '' });
  renderEditor(tables[activeKey]);
  const inputs = document.querySelectorAll('[data-qfield="name"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

/* -------------------------------- UTILITIES ------------------------------- */

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function initSqlEditors() {
  sqlEditors.forEach(ed => ed.destroy());
  sqlEditors.clear();

  if (!activeKey) return;
  document.querySelectorAll('[data-sql-editor]').forEach(wrap => {
    const i = parseInt(wrap.dataset.sqlEditor);
    const query = tables[activeKey]?.queries[i];
    if (!query) return;

    const editor = new EditorView({
      state: EditorState.create({
        doc: query.sql || '',
        extensions: [
          minimalSetup, lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(),
          sql(), oneDark, cmTheme, keymap.of([indentWithTab]),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              clearTimeout(_jsonRefreshTimer);
              _jsonRefreshTimer = setTimeout(refreshJsonPreview, 400);
            }
          })
        ]
      }),
      parent: wrap
    });
    sqlEditors.set(i, editor);
  });
}

function bindCustomSelect() {
  const btn   = document.getElementById('meta-type-btn');
  const menu  = document.getElementById('meta-type-menu');
  const input = document.getElementById('meta-type');
  const label = document.getElementById('meta-type-label');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const isOpen = menu.classList.contains('open');
    document.querySelectorAll('.custom-select-menu.open').forEach(m => m.classList.remove('open'));
    if (!isOpen) {
      const rect = btn.getBoundingClientRect();
      menu.style.top   = (rect.bottom + 4) + 'px';
      menu.style.left  = rect.left + 'px';
      menu.style.width = rect.width + 'px';
      menu.classList.add('open');
    }
  });

  menu.querySelectorAll('.custom-select-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const newVal = opt.dataset.value;
      const oldVal = activeKey ? tables[activeKey]?.type : null;
      menu.querySelectorAll('.custom-select-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      input.value = newVal;
      label.textContent = opt.textContent;
      menu.classList.remove('open');
      if (activeKey && newVal !== oldVal) {
        syncEditorToState();
        if (newVal === 'definition') {
          const t = tables[activeKey];
          if (!t['definition_headers']) t['definition_headers'] = [];
          if (!t['definition_data'])    t['definition_data']    = [];
        }
        renderEditor(tables[activeKey]);
      }
    });
  });
}

// Close custom selects when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.custom-select')) {
    document.querySelectorAll('.custom-select-menu.open').forEach(m => m.classList.remove('open'));
  }
});

function autoResizeAll() {
  requestAnimationFrame(() => {
    document.querySelectorAll('textarea.cell-input').forEach(el => {
      el.style.height = '0';
      el.style.height = el.scrollHeight + 'px';
    });
  });
}
