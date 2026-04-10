import { tables, activeKey } from '../state.ts';
import { refreshSidebar, selectTable, updateToolbarState } from './callbacks.ts';
import { showToast, showConfirm } from './modals.ts';
import { parseInfo } from '../parser.ts';
import { listRepoTables, fetchTableFromRepo } from '../github.ts';
import type { Table } from '../types.ts';

export function bindDropZone(): void {
  const zone  = document.getElementById('drop-zone')!;
  const input = document.getElementById('file-input') as HTMLInputElement;

  zone.addEventListener('dragover',  (e: DragEvent) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    handleFiles(Array.from(e.dataTransfer!.files));
  });
  input.addEventListener('change', () => handleFiles(Array.from(input.files!)));
}

function handleFiles(files: File[]): void {
  const infoFiles = files.filter(f => f.name.endsWith('.info'));
  if (!infoFiles.length) { showToast('No .info files found', 'error'); return; }

  infoFiles.forEach(file => {
    const reader = new FileReader();
    reader.onload = async (e: ProgressEvent<FileReader>) => {
      const parsed = parseInfo(e.target!.result as string);
      if (!parsed.name) { showToast(`Could not parse: ${file.name}`, 'error'); return; }
      await loadInfoTable(parsed);
    };
    reader.readAsText(file);
  });
}

async function loadInfoTable(parsed: Table): Promise<void> {
  let repoMatch: { name: string; type: string } | null = null;
  try {
    const repoTables = await listRepoTables();
    repoMatch = repoTables.find((t: { name: string }) => t.name === parsed.name) || null;
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
        showToast(`Repo import failed: ${(err as Error).message} — loading local .info`, 'error');
      }
    }
  }

  tables[parsed.name] = parsed;
  refreshSidebar();
  if (!activeKey) selectTable(parsed.name);
  updateToolbarState();
  showToast(`Loaded ${parsed.name} (${parsed.columns.length} cols)`, 'success');
}

/** Binds the paste-.info modal (open button, cancel, submit, Escape). Called once from init(). */
export function bindPasteInfoModal(): void {
  const pasteBtn = document.getElementById('paste-info-btn');
  const modal    = document.getElementById('paste-info-modal');
  const ta       = document.getElementById('paste-info-textarea') as HTMLTextAreaElement | null;
  const cancel   = document.getElementById('paste-info-cancel');
  const submit   = document.getElementById('paste-info-submit');
  if (!pasteBtn || !modal || !ta || !cancel || !submit) return;

  pasteBtn.addEventListener('click', () => {
    ta.value = '';
    modal.style.display = 'flex';
    ta.focus();
  });
  cancel.addEventListener('click', () => { modal.style.display = 'none'; });
  submit.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) { showToast('Paste .info file content first', 'error'); return; }
    const parsed = parseInfo(text);
    if (!parsed.name) { showToast('Could not parse pasted info', 'error'); return; }
    modal.style.display = 'none';
    await loadInfoTable(parsed);
  });
  modal.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') modal.style.display = 'none';
  });
}
