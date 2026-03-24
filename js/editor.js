/**
 * editor.js
 * Renders and manages the table editor UI.
 * Imports parser.js for .info parsing and github.js for submission.
 */

import { parseInfo, toExportJson } from './parser.js';
import { submitTableDefinition } from './github.js';
import JSZip from 'https://esm.sh/jszip';
import { minimalSetup } from 'https://esm.sh/codemirror';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from 'https://esm.sh/@codemirror/view';
import { EditorState } from 'https://esm.sh/@codemirror/state';
import { sql } from 'https://esm.sh/@codemirror/lang-sql';
import { indentWithTab } from 'https://esm.sh/@codemirror/commands';
import { oneDark } from 'https://esm.sh/@codemirror/theme-one-dark';

const cmTheme = EditorView.theme({
  '&': { fontSize: '12px' },
  '.cm-editor': { background: '#0f1117' },
  '.cm-scroller': { fontFamily: "'IBM Plex Mono', monospace" },
  '.cm-content': { padding: '0.3rem 0.5rem', minHeight: '5rem', caretColor: '#4f8ef7' },
  '.cm-focused': { outline: 'none' },
  '.cm-gutters': { background: '#181c27', borderRight: '1px solid #2a3045', color: '#555f7a' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.5rem' },
  '.cm-activeLine': { background: 'rgba(79,142,247,0.05)' },
  '.cm-activeLineGutter': { background: 'rgba(79,142,247,0.08)', color: '#8b93a8' },
  '.cm-selectionBackground': { background: 'rgba(79,142,247,0.25) !important' },
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
    submit.addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) { showToast('Paste .info file content first', 'error'); return; }
      const parsed = parseInfo(text);
      if (!parsed.name) {
        showToast('Could not parse pasted info', 'error');
        return;
      }
      tables[parsed.name] = parsed;
      refreshSidebar();
      if (!activeKey) selectTable(parsed.name);
      updateToolbarState();
      showToast(`Loaded ${parsed.name} (${parsed.columns.length} cols)`, 'success');
      modal.style.display = 'none';
    });
    // Hide modal on Escape
    modal.addEventListener('keydown', e => {
      if (e.key === 'Escape') modal.style.display = 'none';
    });
  }

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
    reader.onload = e => {
      const parsed = parseInfo(e.target.result);
      if (!parsed.name) { showToast(`Could not parse: ${file.name}`, 'error'); return; }
      tables[parsed.name] = parsed;
      refreshSidebar();
      if (!activeKey) selectTable(parsed.name);
      updateToolbarState();
      showToast(`Loaded ${parsed.name} (${parsed.columns.length} cols)`, 'success');
    };
    reader.readAsText(file);
  });
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
              <th class="col-w-null">Nullable</th>
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
      <td class="col-w-null td-center">
        <button class="null-toggle ${col.nullable === 'Yes' ? 'null-yes' : 'null-no'}"
                data-col="${i}" data-field="nullable" data-value="${col.nullable}">
          ${col.nullable}
        </button>
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

// Nullable toggle
document.addEventListener('click', e => {
  const btn = e.target.closest('.null-toggle');
  if (!btn) return;
  const newVal = btn.dataset.value === 'Yes' ? 'No' : 'Yes';
  btn.dataset.value = newVal;
  btn.textContent   = newVal;
  btn.className     = 'null-toggle ' + (newVal === 'Yes' ? 'null-yes' : 'null-no');
  clearTimeout(_jsonRefreshTimer);
  _jsonRefreshTimer = setTimeout(refreshJsonPreview, 400);
});

/* ---------------------------- COLUMN OPERATIONS --------------------------- */

function addColumn() {
  if (!activeKey) return;
  syncEditorToState();
  tables[activeKey].columns.push({
    name: '', type: '', nullable: 'Yes',
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
      autosaveCheckbox.addEventListener('change', () => {
        if (autosaveCheckbox.checked) {
          localStorage.setItem('autosave_enabled', 'true');
          saveTablesToLocal();
          showToast('Autosave enabled', 'success');
        } else {
          if (confirm('Disable autosave and delete all locally saved tables?')) {
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

    const blob = await zip.generateAsync({ type: 'blob' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${activeKey}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${activeKey}.zip`, 'success');
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    if (!confirm('Clear all loaded tables?')) return;
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

function removeTable(name) {
  if (!confirm(`Remove ${name} from editor?`)) return;
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

  // Persist submitter info for convenience
  localStorage.setItem('gh_submitter', JSON.stringify({ name, team, desc }));

  setGhStatus('Creating branch…', '');
  const btn = document.getElementById('btn-gh-submit');
  btn.disabled = true;

  try {
    const { prUrl } = await submitTableDefinition({
      tableName:     activeKey,
      jsonContent:   getCleanJson(),
      queries:       tables[activeKey].queries,
      submitterName: name,
      submitterTeam: team,
      description:   desc
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
          style="width:200px;flex-shrink:0">
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
      menu.querySelectorAll('.custom-select-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      input.value = opt.dataset.value;
      label.textContent = opt.textContent;
      menu.classList.remove('open');
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
