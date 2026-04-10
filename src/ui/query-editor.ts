import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { sql } from '@codemirror/lang-sql';
import { indentWithTab } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { minimalSetup } from '../utils/minimalSetup';

import { tables, activeKey, syncEditorToState, sqlEditors } from '../state.ts';
import { renderEditor } from './callbacks.ts';
import { scheduleJsonRefresh } from './json-export.ts';
import { esc } from './utils.ts';
import type { Query } from '../types.ts';

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

export function queryRowHtml(query: Query, i: number): string {
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

export function addQuery(): void {
  if (!activeKey) return;
  syncEditorToState();
  tables[activeKey].queries.push({ name: '', description: '', file: '', sql: '' });
  renderEditor(tables[activeKey]);
  const inputs = document.querySelectorAll<HTMLElement>('[data-qfield="name"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

export function initSqlEditors(): void {
  sqlEditors.forEach(ed => ed.destroy());
  sqlEditors.clear();

  if (!activeKey) return;
  document.querySelectorAll<HTMLElement>('[data-sql-editor]').forEach(wrap => {
    const i = parseInt((wrap as HTMLElement & { dataset: DOMStringMap }).dataset.sqlEditor!);
    const query = tables[activeKey!]?.queries[i];
    if (!query) return;

    const editor = new EditorView({
      state: EditorState.create({
        doc: query.sql || '',
        extensions: [
          minimalSetup, lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(),
          sql(), oneDark, cmTheme, keymap.of([indentWithTab]),
          EditorView.updateListener.of(update => {
            if (update.docChanged) scheduleJsonRefresh();
          })
        ]
      }),
      parent: wrap
    });
    sqlEditors.set(i, editor);
  });
}

// Auto-append .sql extension on query file inputs
document.addEventListener('blur', (e: FocusEvent) => {
  const target = e.target as HTMLInputElement;
  if (!target.matches('[data-qfield="file"]')) return;
  const val = target.value.trim();
  if (val && !val.endsWith('.sql')) {
    target.value = val + '.sql';
  }
}, true);
