import { tables, activeKey } from '../state.ts';
import { refreshSidebar, selectTable, renderEditor, updateToolbarState } from './callbacks.ts';
import { showToast } from './modals.ts';
import { listRepoTables, fetchTableFromRepo } from '../github.ts';

export function bindBrowseRepoModal(): void {
  const browseBtn = document.getElementById('browse-repo-btn');
  const modal     = document.getElementById('browse-repo-modal');
  const cancelBtn = document.getElementById('browse-repo-cancel');
  const importBtn = document.getElementById('browse-repo-import') as HTMLButtonElement | null;
  const listEl    = document.getElementById('browse-repo-list');
  if (!browseBtn || !modal || !listEl || !importBtn) return;

  function closeModal() {
    (modal as HTMLElement).style.display = 'none';
    listEl!.innerHTML = '';
    importBtn!.disabled = true;
    importBtn!.textContent = 'Import Selected';
  }

  browseBtn.addEventListener('click', () => {
    (modal as HTMLElement).style.display = 'flex';
    loadRepoTableList();
  });
  cancelBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e: MouseEvent) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && (modal as HTMLElement).style.display === 'flex') closeModal();
  });

  listEl.addEventListener('change', () => {
    importBtn.disabled = !listEl.querySelector('.browse-repo-check:checked');
  });

  importBtn.addEventListener('click', async () => {
    const checked = Array.from(listEl.querySelectorAll<HTMLInputElement>('.browse-repo-check:checked'))
      .map(cb => ({ name: cb.value, type: cb.dataset.tableType! }));
    if (!checked.length) return;

    importBtn.disabled = true;
    importBtn.textContent = 'Importing…';

    const results = await Promise.allSettled(
      checked.map(({ name, type }) => fetchTableFromRepo(name, type))
    );

    let successes = 0;
    let failures  = 0;
    let firstSuccessName: string | null = null;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        tables[r.value.name] = r.value;
        if (!firstSuccessName) firstSuccessName = r.value.name;
        successes++;
      } else {
        failures++;
        console.error(`Failed to import ${checked[i].name}:`, r.reason);
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

async function loadRepoTableList(): Promise<void> {
  const listEl    = document.getElementById('browse-repo-list')!;
  const importBtn = document.getElementById('browse-repo-import') as HTMLButtonElement;
  importBtn.disabled = true;

  listEl.innerHTML = '<div class="browse-repo-loading"><span class="browse-repo-spinner"></span>Fetching table list…</div>';

  try {
    const names = await listRepoTables();
    renderRepoTableList(names);
  } catch (err) {
    listEl.innerHTML = `<p style="padding:1.25rem;font-family:var(--mono);font-size:12px;color:var(--danger)">${(err as Error).message}</p>`;
  }
}

function renderRepoTableList(items: { name: string; type: string }[]): void {
  const listEl = document.getElementById('browse-repo-list')!;

  if (!items.length) {
    listEl.innerHTML = '<p style="padding:1.25rem;font-family:var(--mono);font-size:12px;color:var(--text3)">No tables found in table-definitions/</p>';
    return;
  }

  const byType: Record<string, { name: string; type: string }[]> = { data: [], definition: [] };
  items.forEach(item => { (byType[item.type] ??= []).push(item); });

  const searchWrap  = document.createElement('div');
  searchWrap.className = 'browse-repo-search';
  const searchInput = document.createElement('input');
  searchInput.type        = 'text';
  searchInput.className   = 'field-input';
  searchInput.placeholder = 'Search tables…';
  searchWrap.appendChild(searchInput);

  const tabBar = document.createElement('div');
  tabBar.className = 'browse-repo-tabs';

  const panels = document.createElement('div');

  (['data', 'definition'] as const).forEach((type, i) => {
    const typeItems = byType[type] || [];

    const tab = document.createElement('button');
    tab.type        = 'button';
    tab.className   = 'browse-tab' + (i === 0 ? ' active' : '');
    tab.dataset.tab = type;
    tab.textContent = `${type.charAt(0).toUpperCase() + type.slice(1)} (${typeItems.length})`;
    tabBar.appendChild(tab);

    const panel = document.createElement('div');
    panel.className     = 'browse-repo-panel' + (i === 0 ? ' active' : '');
    panel.dataset.panel = type;

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

  tabBar.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.browse-tab');
    if (!btn) return;
    tabBar.querySelectorAll('.browse-tab').forEach(t => t.classList.remove('active'));
    panels.querySelectorAll('.browse-repo-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    panels.querySelector<HTMLElement>(`.browse-repo-panel[data-panel="${btn.dataset.tab}"]`)?.classList.add('active');
  });

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    panels.querySelectorAll<HTMLElement>('.browse-repo-card').forEach(card => {
      const name = card.querySelector('.browse-card-name')!.textContent!.toLowerCase();
      card.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
    tabBar.querySelectorAll<HTMLElement>('.browse-tab').forEach(tab => {
      const type    = tab.dataset.tab!;
      const panel   = panels.querySelector<HTMLElement>(`.browse-repo-panel[data-panel="${type}"]`);
      const total   = (byType[type] || []).length;
      const visible = panel ? panel.querySelectorAll('.browse-repo-card:not([style*="display: none"])').length : 0;
      const label   = type.charAt(0).toUpperCase() + type.slice(1);
      tab.textContent = q ? `${label} (${visible}/${total})` : `${label} (${total})`;
    });
  });

  listEl.innerHTML = '';
  listEl.appendChild(searchWrap);
  listEl.appendChild(tabBar);
  listEl.appendChild(panels);
}
