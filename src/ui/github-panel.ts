import { tables, activeKey, syncEditorToState } from '../state.ts';
import { showToast } from './modals.ts';
import { getCleanJson } from './json-export.ts';
import { submitTableDefinition } from '../github.ts';
import { esc } from './utils.ts';

export function renderGitHubForm(): void {
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

  document.getElementById('btn-gh-submit')!.addEventListener('click', submitToGitHub);
}

async function submitToGitHub(): Promise<void> {
  if (!activeKey) return;
  syncEditorToState();

  const name = (document.getElementById('gh-name') as HTMLInputElement)?.value?.trim();
  const team = (document.getElementById('gh-team') as HTMLInputElement)?.value?.trim();
  const desc = (document.getElementById('gh-desc') as HTMLTextAreaElement)?.value?.trim();

  if (!name || !team) {
    setGhStatus('Please enter your name and team.', 'error');
    return;
  }

  const t = tables[activeKey];
  if (t.type === 'definition' && t.definition_data?.length && !t.definition_headers?.length) {
    setGhStatus('Definition data has no headers. Add headers before submitting.', 'error');
    return;
  }

  localStorage.setItem('gh_submitter', JSON.stringify({ name, team, desc }));

  setGhStatus('Submitting…', '');
  const btn = document.getElementById('btn-gh-submit') as HTMLButtonElement;
  btn.disabled = true;

  try {
    await submitTableDefinition({
      tableName:      activeKey,
      tableType:      tables[activeKey].type || 'data',
      jsonContent:    getCleanJson(),
      queries:        tables[activeKey].queries,
      definitionData: tables[activeKey]['definition_data'],
      submitterName:  name,
      submitterTeam:  team,
      description:    desc
    });

    setGhStatus('✓ Submitted! A PR will be opened on nsu-prod-docs shortly.', 'success');
    showToast('Submission sent', 'success');
  } catch (e) {
    setGhStatus(`✕ ${(e as Error).message}`, 'error');
    showToast((e as Error).message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function setGhStatus(html: string, type: 'success' | 'error' | ''): void {
  const el = document.getElementById('gh-status');
  if (!el) return;
  el.innerHTML = html;
  el.style.color = type === 'success' ? 'var(--success)'
                 : type === 'error'   ? 'var(--danger)'
                 : 'var(--text3)';
}
