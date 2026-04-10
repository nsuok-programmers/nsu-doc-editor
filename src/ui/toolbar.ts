

import { tables, activeKey, setActiveKey, setTables, syncEditorToState, saveTablesToLocal } from '../state.ts';
import { refreshSidebar, selectTable } from './callbacks.ts';
import { showToast, showConfirm } from './modals.ts';
import { getCleanJson, copyJson } from './json-export.ts';
import { serializeDat } from '../parser.ts';
import JSZip from 'jszip';

export function bindToolbar(): void {
  const autosaveCheckbox = document.getElementById('autosave-checkbox') as HTMLInputElement | null;
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

  document.getElementById('btn-copy-json')!.addEventListener('click', () => {
    if (activeKey) copyJson();
  });

  document.getElementById('btn-download-json')!.addEventListener('click', async () => {
    if (!activeKey) return;
    syncEditorToState();

    const zip    = new JSZip();
    const folder = zip.folder(activeKey)!;

    folder.file(`${activeKey}.json`, getCleanJson());

    const sqlFolder = folder.folder('sql')!;
    for (const query of tables[activeKey].queries) {
      if (query.file && query.sql) {
        sqlFolder.file(query.file, query.sql);
      }
    }

    if (tables[activeKey].type === 'definition' && tables[activeKey]['definition_data']?.length) {
      folder.file(`${activeKey}.dat`, serializeDat(tables[activeKey]['definition_data']!));
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

  document.getElementById('btn-clear')!.addEventListener('click', async () => {
    if (!await showConfirm('Clear all loaded tables?', { title: 'Clear All', okLabel: 'Clear All', cancelLabel: 'Cancel' })) return;
    setTables({});
    setActiveKey(null);
    refreshSidebar();
    (document.getElementById('empty-state') as HTMLElement).style.display    = 'flex';
    (document.getElementById('editor-content') as HTMLElement).style.display = 'none';
    updateToolbarState();
    saveTablesToLocal();
  });
}

export function updateToolbarState(): void {
  const hasAny    = Object.keys(tables).length > 0;
  const hasActive = !!activeKey;
  (document.getElementById('btn-clear') as HTMLButtonElement).disabled         = !hasAny;
  (document.getElementById('btn-copy-json') as HTMLButtonElement).disabled     = !hasActive;
  (document.getElementById('btn-download-json') as HTMLButtonElement).disabled = !hasActive;
}

export async function removeTable(name: string): Promise<void> {
  if (!await showConfirm(`Remove "${name}" from the editor?`, { title: 'Remove Table', okLabel: 'Remove', cancelLabel: 'Cancel' })) return;
  delete tables[name];
  setActiveKey(null);
  refreshSidebar();
  const remaining = Object.keys(tables);
  if (remaining.length) {
    selectTable(remaining[0]);
  } else {
    (document.getElementById('empty-state') as HTMLElement).style.display    = 'flex';
    (document.getElementById('editor-content') as HTMLElement).style.display = 'none';
  }
  updateToolbarState();
  saveTablesToLocal();
}
