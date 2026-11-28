// Shortcut kanvas paritas Figma (spec-canvas-shortcuts): panel shortcut Ctrl/⌘+Shift+?, tab panel Alt+1..4,
// tab Design↔Prototype Shift+E, siklus fokus region F6, toggle komentar/kursor tidak merusak viewer.
import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { dom, renderUi } from './test/dom';
import { BOARD, makeDoc, SLUG } from './test/fixtures';
import { Viewer } from './Viewer';

function routes() {
  const d = dom().daemon;
  d.on('GET', `/viewer/docs/${SLUG}`, () => ({ doc: makeDoc(1) }));
  d.on('POST', '/sessions', () => ({ sessionId: 'sess-1' }));
  d.on('POST', '/docs/open', () => ({ rev: 1 }));
}

async function openViewer() {
  routes();
  const view = renderUi(<Viewer slug={SLUG} />);
  await waitFor(() => expect(document.querySelector(`[data-layer="${BOARD}"]`)).not.toBeNull());
  return view;
}

const key = (k: string, o: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(window, { key: k, ...o });
const selectedLeftTab = () => [...document.querySelectorAll<HTMLElement>('.layers-panel [role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

describe('Viewer — shortcut paritas Figma (tampilan)', () => {
  it('Ctrl/⌘+Shift+? membuka panel shortcut; Esc menutup', async () => {
    await openViewer();
    expect(document.querySelector('.modal.shortcuts')).toBeNull();
    key('?', { code: 'Slash', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(document.querySelector('.modal.shortcuts')).not.toBeNull());
    expect(document.querySelector('.modal.shortcuts')!.textContent).toContain('Select inverse');
    key('Escape');
    await waitFor(() => expect(document.querySelector('.modal.shortcuts')).toBeNull());
  });

  it('Alt+1..3 memilih tab sidebar kiri (paritas Figma); Shift+E bolak-balik Design↔Prototype', async () => {
    await openViewer();
    expect(selectedLeftTab()).toBe('Layers');
    key('2', { code: 'Digit2', altKey: true });
    await waitFor(() => expect(selectedLeftTab()).toBe('Assets'));
    key('3', { code: 'Digit3', altKey: true });
    await waitFor(() => expect(selectedLeftTab()).toContain('Comments'));
    key('1', { code: 'Digit1', altKey: true });
    await waitFor(() => expect(selectedLeftTab()).toBe('Layers'));
  });

  it('Shift+E bolak-balik tab kanan Design↔Prototype', async () => {
    await openViewer();
    key('E', { code: 'KeyE', shiftKey: true });
    await waitFor(() => expect(document.querySelector('.panel-tab.tab-prototype')?.getAttribute('aria-selected')).toBe('true'));
    key('E', { code: 'KeyE', shiftKey: true });
    await waitFor(() => expect(document.querySelector('.panel-tab.tab-design')?.getAttribute('aria-selected')).toBe('true'));
  });

  it('F6 menyikluskan fokus antar region (sidebar → canvas → panel)', async () => {
    await openViewer();
    key('F6', { code: 'F6' });
    const first = document.activeElement as HTMLElement;
    expect(first).not.toBeNull();
    key('F6', { code: 'F6' });
    const second = document.activeElement as HTMLElement;
    expect(second).not.toBe(first);
  });

  it('Shift+C dan Ctrl/⌘+Alt+\\ toggle tanpa merusak render', async () => {
    await openViewer();
    key('C', { code: 'KeyC', shiftKey: true });
    key('\\', { code: 'Backslash', ctrlKey: true, altKey: true });
    key('O', { code: 'KeyO', ctrlKey: true, shiftKey: true });
    key('C', { code: 'KeyC', shiftKey: true });
    expect(document.querySelector(`[data-layer="${BOARD}"]`)).not.toBeNull();
  });
});
