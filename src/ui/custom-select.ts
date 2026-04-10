import { tables, activeKey, syncEditorToState } from '../state.ts';
import { renderEditor } from './callbacks.ts';

export function bindCustomSelect(): void {
  const btn   = document.getElementById('meta-type-btn');
  const menu  = document.getElementById('meta-type-menu');
  const input = document.getElementById('meta-type') as HTMLInputElement | null;
  const label = document.getElementById('meta-type-label');
  if (!btn || !menu || !input || !label) return;

  btn.addEventListener('click', () => {
    const isOpen = menu.classList.contains('open');
    document.querySelectorAll('.custom-select-menu.open').forEach(m => m.classList.remove('open'));
    if (!isOpen) {
      const rect = btn.getBoundingClientRect();
      (menu as HTMLElement).style.top   = (rect.bottom + 4) + 'px';
      (menu as HTMLElement).style.left  = rect.left + 'px';
      (menu as HTMLElement).style.width = rect.width + 'px';
      menu.classList.add('open');
    }
  });

  menu.querySelectorAll('.custom-select-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const newVal = (opt as HTMLElement).dataset.value!;
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
document.addEventListener('click', (e: MouseEvent) => {
  if (!(e.target as HTMLElement).closest('.custom-select')) {
    document.querySelectorAll('.custom-select-menu.open').forEach(m => m.classList.remove('open'));
  }
});
