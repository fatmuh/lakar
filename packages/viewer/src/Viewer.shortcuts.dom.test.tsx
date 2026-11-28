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
const selectedTab = () => document.querySelector('.panel-body')?.closest('[class]') && [...document.querySelectorAll<HTMLElement>('.panel-tab.tab-activity, .panel-tab.tab-design, .panel-tab.tab-prototype, .panel-tab.tab-history')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

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

  it('Alt+1..4 memilih tab panel kanan; Shift+E bolak-balik Design↔Prototype', async () => {
    await openViewer();
    expect(selectedTab()).toBe('Activity');
    key('2', { code: 'Digit2', altKey: true });
    await waitFor(() => expect(selectedTab()).toBe('Design'));
    key('4', { code: 'Digit4', altKey: true });
    await waitFor(() => expect(selectedTab()).toBe('History'));
    key('E', { code: 'KeyE', shiftKey: true });
    await waitFor(() => expect(selectedTab()).toBe('Prototype'));
    key('E', { code: 'KeyE', shiftKey: true });
    await waitFor(() => expect(selectedTab()).toBe('Design'));
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
