export function esc(str: unknown): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function autoResizeAll(): void {
  requestAnimationFrame(() => {
    document.querySelectorAll<HTMLTextAreaElement>('textarea.cell-input').forEach(el => {
      el.style.height = '0';
      el.style.height = el.scrollHeight + 'px';
    });
  });
}

export function bindGlobalInputListeners(): void {
  // Auto-resize textareas on input
  document.addEventListener('input', (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.matches('textarea.cell-input')) {
      const ta = target as HTMLTextAreaElement;
      ta.style.height = '0';
      ta.style.height = ta.scrollHeight + 'px';
    }
  });
}
