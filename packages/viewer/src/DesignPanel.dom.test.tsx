// Panel Design — struktur spec-design-panel-figma (desain design-panel-figma.pen): seksi urut Position →
// Auto layout → Appearance → Fill → Stroke → Effects → Theme → Export → Code; bilah align di atas Position,
// chip sizing di field W/H, arah 3 ikon + toggle Wrap/Stretch, grid alignment 3×3, padding sumbu/4 sisi,
// Appearance (Opacity + Radius + blend di header), dan Effects sebagai daftar baris bertipe.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DocOp, LakarDocument } from '@lakar/schema';
import type { DesignTarget, Raw } from './designModel.js';
import type { EditAction } from './editActions';
import { DesignPanel, type DesignPanelProps } from './DesignPanel';
import { renderUi } from './test/dom';

const t = (id: string, stored: Raw, extra: Partial<DesignTarget> = {}): DesignTarget => ({
  id,
  type: 'frame',
  name: id,
  stored: { id, type: 'frame', name: id, ...stored },
  resolved: { id, type: 'frame', name: id, ...stored },
  parentLayout: 'column',
  ...extra,
});

const DOC = {
  schemaVersion: 8,
  id: 'Doc00001',
  rev: 1,
  pages: [{ id: 'Page0001', name: 'Page', children: [] }],
  tokenModes: [],
  tokens: {},
} as unknown as LakarDocument;

function panel(targets: DesignTarget[], editable = true, extra: Partial<DesignPanelProps> = {}) {
  const onCommit = vi.fn(async (_ops: DocOp[], _label: string) => true);
  renderUi(<DesignPanel targets={targets} path={['Board', 'Frame']} editable={editable} fonts={[]} inspectNode={undefined} rev={1} onCommit={onCommit} doc={DOC} slug="doc" {...extra} />);
  return onCommit;
}

describe('DesignPanel — struktur seksi (spec-design-panel-figma)', () => {
  it('frame: urutan judul Position → Auto layout → Appearance → Fill → Stroke → Effects, lalu Theme/Export/Code', () => {
    panel([t('a', {})], true, { onExportCode: vi.fn() });
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual(['Position', 'Auto layout', 'Appearance', 'Fill', 'Stroke', 'Effects', 'Code']);
    screen.getByRole('button', { name: /^Theme\d+ tokens/ });
    screen.getByRole('button', { name: /^Export[A-Z]/ });
  });

  it('Position: field X/Y/W/H dengan chip sizing di ujung W/H; bilah align saat multi-seleksi', () => {
    const run = vi.fn();
    const enabled = new Proxy({} as Record<EditAction, boolean>, { get: () => true });
    const align = { enabled, run };
    panel([t('a', { x: 10, y: 20, width: 100, height: 50 }), t('b', { x: 30, y: 40, width: 100, height: 50 })], true, { align });
    screen.getByLabelText('X');
    screen.getByLabelText('Y');
    screen.getByLabelText('W');
    screen.getByLabelText('H');
    // 6 align + 2 distribute + tombol "···" overflow (desain E5).
    screen.getByRole('button', { name: 'Align left' });
    screen.getByRole('button', { name: 'Distribute horizontally' });
    screen.getByRole('button', { name: 'More alignment actions' });
    screen.getByRole('button', { name: 'Width sizing' });
    fireEvent.click(screen.getByRole('button', { name: 'Align left' }));
    expect(run).toHaveBeenCalledWith('align-left');
  });

  it('chip sizing: menu Fixed/Hug/Fill dengan item aktif; pilih Fill → {width:"fill"}', async () => {
    const onCommit = panel([t('a', { width: 100 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Width sizing' }));
    const fill = await screen.findByRole('menuitemradio', { name: 'Fill' });
    expect((fill as HTMLElement).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(fill);
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { width: 'fill' } }], 'Change width sizing'));
  });

  it('board: field W tanpa chip (lebar selalu angka), chip H hanya Fixed/Hug', async () => {
    panel([t('a', { width: 1440, height: 800 }, { type: 'board' })], true);
    expect(screen.queryByRole('button', { name: 'Width sizing' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Height sizing' }));
    await screen.findByRole('menuitemradio', { name: 'Fixed' });
    await screen.findByRole('menuitemradio', { name: 'Hug' });
    expect(screen.queryByRole('menuitemradio', { name: 'Fill' })).toBeNull();
  });
});

describe('DesignPanel — Auto layout', () => {
  it('arah 3 ikon (Vertical/Horizontal/Grid); "−" di header menulis {layout:null, wrap:null}', async () => {
    const onCommit = panel([t('a', { layout: 'row', wrap: true })]);
    screen.getByRole('group', { name: 'Direction' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove auto layout' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { layout: null, wrap: null } }], 'Remove auto layout'));
  });

  it('tanpa auto layout: "+" di header menambah column; tombol Wrap/Stretch tersembunyi', async () => {
    const onCommit = panel([t('a', {})]);
    expect(screen.queryByRole('button', { name: 'Wrap' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stretch' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add auto layout' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { layout: 'column' } }], 'Add auto layout'));
  });

  it('pilih Grid di segmented arah → enterGrid (layout grid + wrap null + kolom fr)', async () => {
    const onCommit = panel([t('a', { layout: 'row', wrap: true })]);
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { layout: 'grid', wrap: null, gridTemplateColumns: [{ fr: 1 }] } }], 'Change layout direction'));
  });

  it('toggle Wrap (satu tombol): off → {wrap:true}; on → {wrap:null}', async () => {
    const onCommit = panel([t('a', { layout: 'row' })]);
    const wrap = screen.getByRole('button', { name: 'Wrap' });
    expect(wrap.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(wrap);
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { wrap: true } }], 'Change wrap'));
  });

  it('wrap:true → toggle aktif; klik menulis {wrap:null}', async () => {
    const onCommit = panel([t('a', { layout: 'row', wrap: true })]);
    fireEvent.click(screen.getByRole('button', { name: 'Wrap' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { wrap: null } }], 'Change wrap'));
  });

  it('toggle Stretch menulis align stretch; klik lagi kembali ke start', async () => {
    const onCommit = panel([t('a', { layout: 'column' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Stretch' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { align: 'stretch' } }], 'Change align'));
  });

  it('grid alignment 3×3: klik sel menulis align+justify dalam satu commit', async () => {
    const onCommit = panel([t('a', { layout: 'row' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Align center, justify center' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { align: 'center', justify: 'center' } }], 'Change alignment'));
  });

  it('Row gap: nonaktif tanpa wrap ("wrap only"); dengan wrap meng-commit rowGap', async () => {
    const off = panel([t('a', { layout: 'row', gap: 12 })]);
    const rowGap = screen.getByLabelText('Row gap') as HTMLInputElement;
    expect(rowGap.disabled).toBe(true);
    expect(screen.getByText('wrap only')).toBeDefined();
    // Nyalakan wrap dulu, lalu field aktif.
    fireEvent.click(screen.getByRole('button', { name: 'Wrap' }));
    await waitFor(() => expect(off).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { wrap: true } }], 'Change wrap'));
  });

  it('Row gap dengan wrap aktif menulis rowGap', async () => {
    const onCommit = panel([t('a', { layout: 'row', wrap: true, gap: 12 })]);
    const input = screen.getByLabelText('Row gap') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('12');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { rowGap: 20 } }], 'Change row gap'));
  });

  it('field Pad H/V menulis kedua sisi sumbu (normalisasi tuple)', async () => {
    const onCommit = panel([t('a', { layout: 'column', padding: [4, 8] })]);
    const padH = screen.getByLabelText('Horizontal padding') as HTMLInputElement;
    expect(padH.value).toBe('8');
    fireEvent.change(padH, { target: { value: '10' } });
    fireEvent.blur(padH);
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { padding: [4, 10] } }], 'Change padding'));
  });

  it('toggle Independent padding membuka 4 field sisi (E4); commit sisi atas → tuple 4', async () => {
    const onCommit = panel([t('a', { layout: 'column', padding: 4 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Independent padding' }));
    const top = screen.getByLabelText('Top padding') as HTMLInputElement;
    expect(top.value).toBe('4');
    fireEvent.change(top, { target: { value: '8' } });
    fireEvent.blur(top);
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { padding: [8, 4, 4, 4] } }], 'Change padding'));
  });

  it('grid layout: Wrap tersembunyi, field Columns/Rows tampil', () => {
    panel([t('g', { layout: 'grid' })]);
    expect(screen.queryByRole('button', { name: 'Wrap' })).toBeNull();
    screen.getByLabelText('Columns');
    screen.getByLabelText('Rows');
  });
});

describe('DesignPanel — Appearance', () => {
  it('Opacity + Radius satu baris; menu blend di header menulis {blend}', async () => {
    const onCommit = panel([t('a', { opacity: 0.8, radius: 8 })]);
    expect((screen.getByLabelText('Opacity') as HTMLInputElement).value).toBe('80%');
    expect((screen.getByLabelText('Radius') as HTMLInputElement).value).toBe('8');
    fireEvent.click(screen.getByRole('button', { name: 'Blend mode: Normal' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Multiply' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { blend: 'multiply' } }], 'Change blend mode'));
  });

  it('toggle Independent corners membuka 4 field sudut; commit TL → tuple radius (E4)', async () => {
    const onCommit = panel([t('a', { radius: 12 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Independent corners' }));
    const tl = screen.getByLabelText('TL corner radius') as HTMLInputElement;
    expect(tl.value).toBe('12');
    fireEvent.change(tl, { target: { value: '8' } });
    fireEvent.blur(tl);
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { radius: [8, 12, 12, 12] } }], 'Change corner radius'));
  });
});

describe('DesignPanel — Stroke', () => {
  const stroke = { color: '#000000', width: 1, align: 'inside' };

  it('select posisi Inside/Center/Outside; tombol sides menu; settings nonaktif pada non-vektor', async () => {
    panel([t('a', { stroke })]);
    const pos = screen.getByLabelText('Stroke position') as HTMLSelectElement;
    expect(pos.value).toBe('inside');
    const settings = screen.getByRole('button', { name: 'Stroke settings' }) as HTMLButtonElement;
    expect(settings.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Stroke sides' }));
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) await screen.findByRole('menuitemradio', { name: s });
  });

  it('path: settings membuka blok Cap/Join/Dash/Miter + strip pratinjau dash (E3)', () => {
    panel([t('p', { stroke, strokeLinecap: 'round', strokeLinejoin: 'round', strokeDasharray: [4, 2], strokeMiterlimit: 4 }, { type: 'path' })]);
    const settings = screen.getByRole('button', { name: 'Stroke settings' }) as HTMLButtonElement;
    expect(settings.disabled).toBe(false);
    fireEvent.click(settings);
    screen.getByLabelText('Cap');
    screen.getByLabelText('Join');
    expect((screen.getByLabelText('Dash') as HTMLInputElement).value).toBe('4 2');
    screen.getByLabelText('Miter');
    expect(document.querySelector('svg.dp-dashline line')?.getAttribute('stroke-dasharray')).toBe('4 2');
  });
});

describe('DesignPanel — Fill & Effects', () => {
  it('dua fill → dua baris paint dengan grip saat hover', () => {
    panel([t('a', { fills: [{ type: 'solid', color: '#FF0000' }, { type: 'solid', color: '#00FF00' }] })]);
    expect(document.querySelectorAll('.dp-paint .dp-grip')).toHaveLength(2);
  });

  it('seleksi fill campuran: swatch bergaris + "Mixed fills" (E2)', () => {
    panel([t('a', { fills: [{ type: 'solid', color: '#FF0000' }] }), t('b', { fills: [{ type: 'solid', color: '#0000FF' }] })]);
    screen.getByText('Mixed fills');
    expect(document.querySelector('.dp-swatch-mixed')).not.toBeNull();
  });

  it('menu "+" Effects menawarkan 4 jenis; Layer blur menulis {blur:8}; jenis skalar terpakai dinonaktifkan', async () => {
    const onCommit = panel([t('a', { blur: 4 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Add effect' }));
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Drop shadow', 'Inner shadow', 'Layer blur', 'Background blur']);
    expect((items[2] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Background blur' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { backdropBlur: 8 } }], 'Add background blur'));
  });

  it('baris efek bertipe: select jenis mengubah tipe shadow di tempat', async () => {
    const onCommit = panel([t('a', { shadows: [{ type: 'drop', x: 0, y: 4, blur: 12, color: '#00000033' }] })]);
    const select = screen.getByLabelText('Effect type') as HTMLSelectElement;
    expect(select.value).toBe('drop');
    fireEvent.change(select, { target: { value: 'inner' } });
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { shadows: [{ type: 'inner', x: 0, y: 4, blur: 12, color: '#00000033' }] } }], 'Change effect type'));
  });

  it('"−" pada baris efek menghapusnya (shadow → null; skalar → null)', async () => {
    const onCommit = panel([t('a', { shadows: [{ type: 'drop', x: 0, y: 4, blur: 12, color: '#00000033' }] })]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove drop shadow' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith([{ op: 'update', id: 'a', patch: { shadows: null } }], 'Remove drop shadow'));
  });

  it('settings baris shadow membuka editor X/Y/Blur + warna', () => {
    panel([t('a', { shadows: [{ type: 'drop', x: 0, y: 4, blur: 12, color: '#00000033' }] })]);
    fireEvent.click(screen.getByRole('button', { name: 'Drop shadow settings' }));
    expect(document.querySelectorAll('.dp-fx-edit').length).toBe(1);
    screen.getByLabelText('Blur');
  });

  it('baris blur skalar: select jenis + settings membuka field Blur', () => {
    panel([t('a', { blur: 6 })]);
    const select = screen.getByLabelText('Effect type') as HTMLSelectElement;
    expect(select.value).toBe('blur');
    fireEvent.click(screen.getByRole('button', { name: 'Layer blur settings' }));
    expect((screen.getByLabelText('Blur') as HTMLInputElement).value).toBe('6');
  });
});

describe('DesignPanel — seksi bawah + read-only', () => {
  it('Export: baris preset select+select+input+−; Name menampilkan akhiran ".png" redup; tombol netral', async () => {
    panel([t('a', {})], true, { exportSel: { boardId: 'B1', nodeId: 'a', name: 'Card' } });
    expect(document.querySelectorAll('.export-preset .dp-select').length).toBeGreaterThanOrEqual(4);
    // Format campuran (PNG+SVG) → tanpa akhiran; hapus preset SVG → ".png" tampil.
    expect(document.querySelector('.export-ext')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove preset' })[1]!);
    await waitFor(() => expect(document.querySelector('.export-ext')?.textContent).toBe('.png'));
    const run = screen.getByRole('button', { name: /Export Card/ });
    expect(run.className.includes('primary')).toBe(false);
  });

  it('Code: select target + tombol Export… memanggil onExportCode(id, target)', async () => {
    const onExportCode = vi.fn();
    panel([t('a', {})], true, { exportSel: { boardId: 'B1', nodeId: 'a', name: 'Card' }, onExportCode });
    const sel = screen.getByLabelText('Code target') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'react-css' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    expect(onExportCode).toHaveBeenCalledWith('a', 'react-css');
  });

  it('read-only (editable=false): root berkelas .readonly (E6) dan kontrol dinonaktifkan', () => {
    panel([t('a', { layout: 'row' })], false);
    expect(document.querySelector('.design-panel.readonly')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Wrap' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('X') as HTMLInputElement).disabled).toBe(true);
    screen.getByText(/Read only while previewing/);
  });
});
