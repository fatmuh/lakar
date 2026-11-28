// Seksi Export di tab Design (spec-design-panel-figma): baris preset ala Figma (skala ▾ + format ▾ + sufiks + −),
// tujuan = folder + nama (akhiran ekstensi redup dari format), tombol Export sekunder, dan seksi Code terpisah
// (select target + tombol "Export…" → onExportCode dengan target pilihan).
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CodeSection, ExportSection } from './ExportSection';
import { dom, renderUi } from './test/dom';

const SEL = { boardId: 'Board001', nodeId: 'Frame01', name: 'Card Item' };

describe('ExportSection — preset + save ke path', () => {
  it('tanpa seleksi: tombol Export nonaktif; dengan seleksi: dua preset default (PNG 2x, SVG 1x)', () => {
    const off = renderUi(<ExportSection slug="doc" sel={undefined} />);
    expect((off.getByRole('button', { name: /Export selection/ }) as HTMLButtonElement).disabled).toBe(true);
    off.unmount();

    const t = renderUi(<ExportSection slug="doc" sel={SEL} />);
    expect((t.getByRole('button', { name: /Export Card Item/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(t.getAllByLabelText('Format').map((s) => (s as HTMLSelectElement).value)).toEqual(['png', 'svg']);
    // Nama file mengikuti nama layer (di-slugify).
    expect((t.getByLabelText('File name') as HTMLInputElement).value).toBe('card-item');
  });

  it('baris preset = select skala + select format + input sufiks + tombol − (tanpa menu "···" FIGMA-ONLY)', () => {
    const t = renderUi(<ExportSection slug="doc" sel={SEL} />);
    const row = t.container.querySelector('.export-preset')!;
    expect(row.querySelectorAll('.dp-select').length).toBe(2);
    expect(row.querySelectorAll('input').length).toBe(1);
    expect(row.querySelectorAll('button').length).toBe(1);
    // Tombol Export netral (bukan primary putih).
    expect(t.getByRole('button', { name: /Export Card Item/ }).className).not.toContain('primary');
  });

  it('klik Export → POST /export-file per preset dengan dir+name+scale+format; status menampilkan path tersimpan', async () => {
    const t = renderUi(<ExportSection slug="doc" sel={SEL} />);
    dom().daemon.on('POST', /^\/viewer\/docs\/doc\/export-file$/, (req) => {
      const b = req.body as { name: string };
      return { path: `/home/u/Downloads/${b.name}.x`, bytes: 1, dropped: [] };
    });
    const folder = t.getByLabelText('Save folder');
    await t.user.clear(folder);
    await t.user.type(folder, '/tmp/out');
    await t.user.click(t.getByRole('button', { name: /Export Card Item/ }));
    await waitFor(() => expect(dom().daemon.find('POST', '/viewer/docs/doc/export-file')).toHaveLength(2));
    const bodies = dom().daemon.find('POST', '/viewer/docs/doc/export-file').map((r) => r.body as Record<string, unknown>);
    expect(bodies[0]).toMatchObject({ boardId: 'Board001', nodeId: 'Frame01', scale: 2, format: 'png', dir: '/tmp/out', name: 'card-item@2x' });
    expect(bodies[1]).toMatchObject({ boardId: 'Board001', nodeId: 'Frame01', scale: 1, format: 'svg', dir: '/tmp/out', name: 'card-item' });
    await t.findByRole('status');
  });

  it('error route → pesan AD-11 tampil; akhiran ".png" redup hanya bila semua preset satu format', async () => {
    const t = renderUi(<ExportSection slug="doc" sel={SEL} />);
    expect(t.container.querySelector('.export-ext')).toBeNull();
    await t.user.click(t.getByRole('button', { name: /Export Card Item/ }));
    await t.findByRole('alert');
  });
});

describe('CodeSection — target + Export…', () => {
  it('tanpa seleksi tombol nonaktif; dengan seleksi memanggil onExportCode(id, target pilihan)', async () => {
    const onCode = vi.fn();
    const t = renderUi(<CodeSection sel={undefined} onExportCode={onCode} />);
    expect((t.getByRole('button', { name: 'Export…' }) as HTMLButtonElement).disabled).toBe(true);
    t.unmount();

    const u = renderUi(<CodeSection sel={SEL} onExportCode={onCode} />);
    expect((u.getByLabelText('Code target') as HTMLSelectElement).value).toBe('react-tailwind');
    u.getByRole('option', { name: 'React + CSS' });
    await u.user.selectOptions(u.getByLabelText('Code target'), 'react-css');
    await u.user.click(u.getByRole('button', { name: 'Export…' }));
    expect(onCode).toHaveBeenCalledWith('Frame01', 'react-css');
  });

  it('tanpa onExportCode seksi tidak dirender', () => {
    const t = renderUi(<CodeSection sel={SEL} />);
    expect(t.container.querySelector('.code-section')).toBeNull();
  });
});
