/* ----------------------------- CONFIRM MODAL ------------------------------ */

let _confirmResolve: ((val: boolean) => void) | null = null;

export function showConfirm(
  message: string,
  { title = 'Confirm', okLabel = 'OK', cancelLabel = 'Cancel' } = {}
): Promise<boolean> {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    (document.getElementById('confirm-title') as HTMLElement).textContent   = title;
    (document.getElementById('confirm-message') as HTMLElement).textContent = message;
    (document.getElementById('confirm-ok') as HTMLElement).textContent      = okLabel;
    (document.getElementById('confirm-cancel') as HTMLElement).textContent  = cancelLabel;
    (document.getElementById('confirm-modal') as HTMLElement).style.display = 'flex';
  });
}

export function initConfirmModal(): void {
  const modal  = document.getElementById('confirm-modal') as HTMLElement;
  const okBtn  = document.getElementById('confirm-ok') as HTMLElement;
  const canBtn = document.getElementById('confirm-cancel') as HTMLElement;
  const settle = (val: boolean) => {
    modal.style.display = 'none';
    if (_confirmResolve) { _confirmResolve(val); _confirmResolve = null; }
  };
  okBtn.addEventListener('click',  () => settle(true));
  canBtn.addEventListener('click', () => settle(false));
  modal.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') settle(false); });
}

/* ---------------------------------- TOAST --------------------------------- */

export function showToast(msg: string, type: 'success' | 'error' | '' = ''): void {
  const t = document.getElementById('toast') as HTMLElement & { _timer?: ReturnType<typeof setTimeout> };
  const icons: Record<string, string> = { success: '✓', error: '✕', '': 'ℹ' };
  t.innerHTML  = `<span>${icons[type] ?? 'ℹ'}</span> ${msg}`;
  t.className  = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}
