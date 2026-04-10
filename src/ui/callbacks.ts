import type { Table } from '../types.ts';

/**
 * Forward-reference registry for functions that would otherwise create circular
 * imports between ui/ modules and the editor.ts orchestrator.
 *
 * editor.ts calls registerCallbacks() in init() before any user interaction,
 * so the no-op stubs are never invoked at runtime.
 */

export let renderEditor: (table: Table) => void = () => {};
export let refreshSidebar: () => void = () => {};
export let selectTable: (name: string) => void = () => {};
export let updateToolbarState: () => void = () => {};

export function registerCallbacks(cbs: {
  renderEditor: (table: Table) => void;
  refreshSidebar: () => void;
  selectTable: (name: string) => void;
  updateToolbarState: () => void;
}): void {
  renderEditor       = cbs.renderEditor;
  refreshSidebar     = cbs.refreshSidebar;
  selectTable        = cbs.selectTable;
  updateToolbarState = cbs.updateToolbarState;
}
