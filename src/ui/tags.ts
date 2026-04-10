import { tables, activeKey } from '../state.ts';
import { esc } from './utils.ts';

export function tagChipHtml(tag: string): string {
  return `<span class="tag-chip" data-tag="${esc(tag)}">${esc(tag)}<button class="tag-remove" data-tag="${esc(tag)}">×</button></span>`;
}

export function handleTagInput(e: KeyboardEvent): void {
  const target = e.target as HTMLInputElement;
  if (e.key !== 'Enter' && e.key !== ',') {
    if (e.key === 'Backspace' && !target.value && activeKey) {
      const tags = tables[activeKey].tags;
      if (tags.length) removeTag(tags[tags.length - 1]);
    }
    return;
  }
  e.preventDefault();
  const val = target.value.trim().replace(/,/g, '');
  if (!val || !activeKey) return;
  if (!tables[activeKey].tags.includes(val)) {
    tables[activeKey].tags.push(val);
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.dataset.tag = val;
    chip.innerHTML = `${esc(val)}<button class="tag-remove" data-tag="${esc(val)}">×</button>`;
    target.parentNode!.insertBefore(chip, target);
  }
  target.value = '';
}

export function removeTag(tag: string): void {
  if (!activeKey) return;
  tables[activeKey].tags = tables[activeKey].tags.filter(t => t !== tag);
  const chip = document.querySelector<HTMLElement>(`.tag-chip[data-tag="${tag}"]`);
  if (chip) chip.remove();
}

/** Registers the delegated click listener for .tag-remove buttons. */
export function bindTags(): void {
  document.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.matches('.tag-remove')) {
      removeTag((target as HTMLElement & { dataset: DOMStringMap }).dataset.tag!);
    }
  });
}
