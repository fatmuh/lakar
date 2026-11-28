// Seksi Theme di tab Design (spec-viewer-merged-design-tab): menu "⋯" berisi Import (CSS variables, DTCG tokens),
// export token (Copy tokens as CSS, Export/Copy DTCG JSON), dan aksi mode; seksi harus dibuka lewat header dulu.
import { describe, expect, it, vi } from 'vitest';
import type { DocOp, LakarDocument } from '@lakar/schema';
import { dtcgTokensJson } from '@lakar/codegen';
import { renderUi } from './test/dom';
import { ThemeSection } from './ThemeSection';

const DOC = {
  schemaVersion: 8,
  id: 'Doc00001',
  rev: 1,
  pages: [{ id: 'Page0001', name: 'Page', children: [] }],
  tokenModes: ['light', 'dark'],
  tokens: {
    'colors.bg': { type: 'color', value: '#FFFFFF', modes: { dark: '#0F0F0F' } },
    'radius.md': { type: 'radius', value: 12 },
  },
} as unknown as LakarDocument;

function renderSection() {
  const onCommit = vi.fn(async (_ops: DocOp[], _label: string) => true);
  const onImportCss = vi.fn();
  const onImportDtcg = vi.fn();
  const ui = renderUi(<ThemeSection doc={DOC} rev={1} editable onCommit={onCommit} onImportCss={onImportCss} onImportDtcg={onImportDtcg} />);
  return { onCommit, onImportCss, onImportDtcg, ...ui };
}

describe('ThemeSection: header + menu aksi', () => {
  it('collapsed menampilkan ringkasan jumlah token ("N tokens"); klik membuka isi', async () => {
    const t = renderSection();
    const head = t.getByRole('button', { name: /^Theme\d+ tokens/ });
    expect(head.textContent).toContain('2 tokens');
    await t.user.click(head);
    // Mode switch + grup jenis token tampil.
    t.getByRole('radiogroup', { name: 'Token mode' });
    t.getByRole('button', { name: /^Color/ });
  });

  it('menu ⋯: Import CSS variables… dan Import DTCG tokens (.json)… memanggil callback masing-masing', async () => {
    const t = renderSection();
    await t.user.click(t.getByRole('button', { name: 'Theme actions' }));
    await t.user.click(t.getByRole('menuitem', { name: 'Import CSS variables…' }));
    expect(t.onImportCss).toHaveBeenCalledTimes(1);
    expect(t.onImportDtcg).not.toHaveBeenCalled();
    await t.user.click(t.getByRole('button', { name: 'Theme actions' }));
    await t.user.click(t.getByRole('menuitem', { name: 'Import DTCG tokens (.json)…' }));
    expect(t.onImportDtcg).toHaveBeenCalledTimes(1);
  });

  it('menu ⋯: Copy tokens as CSS membuka popover; Copy DTCG JSON menyalin byte codegen', async () => {
    const t = renderSection();
    await t.user.click(t.getByRole('button', { name: 'Theme actions' }));
    for (const name of ['Copy tokens as CSS', 'Export DTCG JSON', 'Copy DTCG JSON']) {
      expect(t.getByRole('menuitem', { name })).toBeTruthy();
    }
    await t.user.click(t.getByRole('menuitem', { name: 'Copy tokens as CSS' }));
    expect(t.getByRole('dialog', { name: 'Copy tokens' })).toBeTruthy();
    await t.user.click(t.getByRole('button', { name: 'Theme actions' }));
    await t.user.click(t.getByRole('menuitem', { name: 'Copy DTCG JSON' }));
    expect(await navigator.clipboard.readText()).toBe(dtcgTokensJson(DOC));
  });

  it('menu ⋯: Rename mode… membuka input yang mengirim ops rename', async () => {
    const t = renderSection();
    await t.user.click(t.getByRole('button', { name: /^Theme\d+ tokens/ }));
    await t.user.click(t.getByRole('button', { name: 'Theme actions' }));
    await t.user.click(t.getByRole('menuitem', { name: 'Rename Light…' }));
    const input = t.getByRole('textbox', { name: 'Rename mode Light' });
    await t.user.clear(input);
    await t.user.type(input, 'day{Enter}');
    expect(t.onCommit).toHaveBeenCalledTimes(1);
  });
});
