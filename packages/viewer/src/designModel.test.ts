import { describe, expect, it } from 'vitest';
import {
  addEffect,
  addFill,
  addShadow,
  addStroke,
  axisGapOf,
  canEditXY,
  convertEffect,
  formatRowCount,
  GRID_TRACKS_MAX,
  parseColumnCount,
  parseRowCount,
  convertFill,
  designGroups,
  describeEdit,
  editFill,
  editShadow,
  editStop,
  effectKindsOf,
  enterGrid,
  fillRows,
  keepsToken,
  layoutOf,
  moveFill,
  opsFor,
  paddingAxisState,
  paddingEdgeOf,
  paddingEdges,
  parentLayoutOf,
  radiusAll,
  readField,
  readSizing,
  removeEffect,
  removeFill,
  removeShadow,
  removeStroke,
  setAllFills,
  setLayout,
  setPaddingAxis,
  setPaddingEdge,
  setProp,
  setRadiusAll,
  setRadiusCorner,
  setSizing,
  setStroke,
  setTrackCount,
  solidAlpha,
  solidColor,
  strokeColor,
  strokeSides,
  toggleSide,
  trackCount,
  type DesignTarget,
  type Raw,
} from './designModel.js';

const t = (id: string, type: string, stored: Raw, extra: Partial<DesignTarget> = {}): DesignTarget => ({
  id,
  type,
  name: id,
  stored: { id, type, name: id, ...stored },
  resolved: { id, type, name: id, ...stored },
  parentLayout: type === 'board' ? undefined : 'column',
  ...extra,
});

describe('designModel', () => {
  it('kelompok per tipe dan irisan multi-select', () => {
    expect(designGroups([t('a', 'board', {})])).toEqual(['position', 'fill']);
    expect(designGroups([t('a', 'frame', {})])).toEqual(['position', 'autoLayout', 'appearance', 'fill', 'stroke', 'effects']);
    expect(designGroups([t('a', 'text', {})])).toEqual(['position', 'typography', 'appearance', 'effects']);
    expect(designGroups([t('a', 'icon', {})])).toEqual(['position', 'icon', 'appearance', 'effects']);
    expect(designGroups([t('a', 'frame', {}), t('b', 'rect', {})])).toEqual(['position', 'appearance', 'fill', 'stroke', 'effects']);
    expect(designGroups([t('a', 'frame', {}), t('b', 'text', {})])).toEqual(['position', 'appearance', 'effects']);
    expect(designGroups([])).toEqual([]);
  });

  it('readField: sama → nilai + resolve; beda → mixed; keepsToken', () => {
    const a = t('a', 'frame', { width: 169 });
    const b = t('b', 'frame', { width: 169 });
    const c = t('c', 'frame', { width: 200 });
    expect(readField([a, b], (n) => n.width)).toEqual({ mixed: false, value: 169, resolved: 169 });
    expect(readField([a, b, c], (n) => n.width)).toEqual({ mixed: true });
    const tok = { ...t('d', 'frame', { gap: { $token: 'space.4' } }), resolved: { gap: 16 } };
    const st = readField([tok], (n) => n.gap);
    expect(st).toEqual({ mixed: false, value: { $token: 'space.4' }, resolved: 16 });
    expect(keepsToken(st, 16)).toBe(true);
    expect(keepsToken(st, 20)).toBe(false);
    expect(setProp([tok], 'gap', 20)).toEqual([{ op: 'update', id: 'd', patch: { gap: 20 } }]);
  });

  it('opsFor: lewati node/kunci tanpa perubahan; null menghapus hanya bila ada', () => {
    const a = t('a', 'frame', { width: 150 });
    const b = t('b', 'frame', { width: 169 });
    expect(setProp([a, b], 'width', 150)).toEqual([{ op: 'update', id: 'b', patch: { width: 150 } }]);
    expect(setProp([a], 'stroke', null)).toEqual([]);
    expect(opsFor([a], () => ({ width: 150, gap: undefined }))).toEqual([]);
    expect(describeEdit('Change width', 3)).toBe('Change width on 3 layers');
    expect(describeEdit('Change width', 1)).toBe('Change width');
  });

  it('sizing: hug/fill langsung; fixed = ukuran terukur; board fixed', () => {
    const f = t('a', 'frame', { width: 298, height: 100 }, { measured: { w: 298.4, h: 120.6 } });
    expect(setSizing([f], 'width', 'hug')).toEqual([{ op: 'update', id: 'a', patch: { width: 'hug' } }]);
    expect(setSizing([f], 'width', 'fixed')).toEqual([]);
    const h = t('b', 'frame', { height: 'hug' }, { measured: { w: 10, h: 120.6 } });
    expect(setSizing([h], 'height', 'fixed')).toEqual([{ op: 'update', id: 'b', patch: { height: 121 } }]);
    expect(setSizing([t('c', 'frame', { height: 'fill' })], 'height', 'fixed')).toEqual([]);
    expect(readSizing([f], 'width')).toBe('fixed');
    expect(readSizing([t('d', 'text', {})], 'width')).toBe('hug');
    expect(readSizing([f, h], 'height')).toBeUndefined();
    expect(readSizing([t('e', 'board', { width: 100 })], 'width')).toBe('fixed');
  });

  it("board height:'hug' (v8): Hug ↔ Fixed; Fixed = tinggi terukur dibulatkan", () => {
    const hug = t('b', 'board', { width: 1440, height: 'hug' }, { measured: { w: 1440, h: 4050.4 } });
    expect(readSizing([hug], 'height')).toBe('hug');
    expect(readSizing([hug], 'width')).toBe('fixed');
    expect(setSizing([hug], 'height', 'fixed')).toEqual([{ op: 'update', id: 'b', patch: { height: 4050 } }]);
    const fixed = t('c', 'board', { width: 1440, height: 4050 });
    expect(readSizing([fixed], 'height')).toBe('fixed');
    expect(setSizing([fixed], 'height', 'hug')).toEqual([{ op: 'update', id: 'c', patch: { height: 'hug' } }]);
  });

  it('X/Y: board, absolute, anak frame none bisa diedit; anak flow tidak', () => {
    expect(canEditXY(t('a', 'board', {}))).toBe(true);
    expect(canEditXY(t('b', 'rect', { position: 'absolute' }))).toBe(true);
    expect(canEditXY(t('c', 'rect', {}, { parentLayout: 'none' }))).toBe(true);
    expect(canEditXY(t('d', 'rect', {}, { parentLayout: 'row' }))).toBe(false);
  });

  it('parentLayoutOf sejajar implicitAbsolute: board → column, frame tanpa layout/none → none, row/column apa adanya', () => {
    expect(parentLayoutOf('board', undefined)).toBeUndefined();
    expect(parentLayoutOf('rect', { type: 'board' })).toBe('column');
    expect(parentLayoutOf('rect', { type: 'frame' })).toBe('none');
    expect(parentLayoutOf('rect', { type: 'frame', layout: 'none' })).toBe('none');
    expect(parentLayoutOf('rect', { type: 'frame', layout: 'row' })).toBe('row');
    expect(parentLayoutOf('text', { type: 'frame', layout: 'column' })).toBe('column');
  });

  it('auto layout: arah dan hapus', () => {
    const f = t('a', 'frame', {});
    expect(layoutOf(f.stored)).toBe('none');
    expect(setLayout([f], 'column')).toEqual([{ op: 'update', id: 'a', patch: { layout: 'column' } }]);
    expect(setLayout([t('b', 'frame', { layout: 'row' })], null)).toEqual([{ op: 'update', id: 'b', patch: { layout: null } }]);
    expect(setLayout([f], null)).toEqual([]);
  });

  it('wrap (v9): dihapus saat arah → grid/none; flex → flex mempertahankannya; boolean via setProp', () => {
    const w = t('w', 'frame', { layout: 'row', wrap: true });
    expect(setLayout([w], 'column')).toEqual([{ op: 'update', id: 'w', patch: { layout: 'column' } }]);
    expect(setLayout([w], null)).toEqual([{ op: 'update', id: 'w', patch: { layout: null, wrap: null } }]);
    expect(setLayout([w], 'grid')).toEqual([{ op: 'update', id: 'w', patch: { layout: 'grid', wrap: null } }]);
    expect(setProp([t('u', 'frame', { layout: 'row' })], 'wrap', true)).toEqual([{ op: 'update', id: 'u', patch: { wrap: true } }]);
    // "No wrap" menulis null (hapus), bukan false — dokumen lama tetap minimal.
    expect(setProp([w], 'wrap', null)).toEqual([{ op: 'update', id: 'w', patch: { wrap: null } }]);
    expect(setProp([t('n', 'frame', { layout: 'row' })], 'wrap', null)).toEqual([]);
  });

  it('fill: urutan tampil, tambah, hapus, pindah, warna/alpha, Mixed', () => {
    const fills = [
      { type: 'solid', color: '#FFFFFF' },
      { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#3B82F6' }, { offset: 1, color: '#F97316' }] },
    ];
    const f = t('a', 'frame', { fills });
    expect(fillRows(f).map((r) => r.index)).toEqual([1, 0]);
    expect(addFill([f])[0]).toMatchObject({ patch: { fills: [...fills, { type: 'solid', color: '#D9D9D9' }] } });
    expect(removeFill([f], 1)[0]).toMatchObject({ patch: { fills: [fills[0]] } });
    expect(removeFill([t('b', 'rect', { fills: [fills[0]] })], 0)[0]).toMatchObject({ patch: { fills: null } });
    expect(moveFill([f], 0, 1)[0]).toMatchObject({ patch: { fills: [fills[1], fills[0]] } });
    expect(moveFill([f], 0, 0)).toEqual([]);
    const semi = t('c', 'rect', { fills: [{ type: 'solid', color: '#00000080' }] });
    expect(editFill([semi], 0, (x, r) => solidColor(x, r, '#1a1a1a'))[0]).toMatchObject({ patch: { fills: [{ type: 'solid', color: '#1A1A1A80' }] } });
    expect(editFill([semi], 0, (x, r) => solidColor(x, r, 'nope'))).toEqual([]);
    const solid = t('d', 'rect', { fills: [{ type: 'solid', color: '#112233' }] });
    expect(editFill([solid], 0, (x, r) => solidAlpha(x, r, 0.5))[0]).toMatchObject({ patch: { fills: [{ type: 'solid', color: '#11223380' }] } });
    expect(setAllFills([f, solid], [{ type: 'solid', color: '#000000' }])).toHaveLength(2);
  });

  it('fill: token warna dipertahankan alpha dari nilai resolve', () => {
    const tok = { ...t('a', 'rect', { fills: [{ type: 'solid', color: { $token: 'colors.bg' } }] }), resolved: { fills: [{ type: 'solid', color: '#FFFFFF80' }] } };
    expect(editFill([tok], 0, (x, r) => solidColor(x, r, '000'))[0]).toMatchObject({ patch: { fills: [{ type: 'solid', color: '#00000080' }] } });
  });

  it('gradien: konversi jenis dan edit stop', () => {
    const solid = { type: 'solid', color: '#3B82F6' };
    const lin = convertFill(solid, solid, 'linear');
    expect(lin).toEqual({ type: 'linear', angle: 180, stops: [{ offset: 0, color: '#3B82F6' }, { offset: 1, color: '#3B82F600' }] });
    const rad = convertFill(lin!, lin!, 'radial');
    expect(rad).toEqual({ type: 'radial', stops: lin!.stops });
    expect(convertFill(rad!, rad!, 'solid')).toEqual({ type: 'solid', color: '#3B82F6' });
    expect(convertFill(solid, solid, 'solid')).toBeUndefined();
    expect(convertFill({ type: 'image', assetId: 'x', fit: 'cover' }, {}, 'linear')).toBeUndefined();
    expect(editStop(lin!, lin!, 1, { offset: 1.4 })?.stops).toEqual([{ offset: 0, color: '#3B82F6' }, { offset: 1, color: '#3B82F600' }]);
    expect(editStop(lin!, lin!, 0, { hex: 'f00', offset: 0.25 })?.stops).toEqual([{ offset: 0.25, color: '#FF0000' }, { offset: 1, color: '#3B82F600' }]);
    expect(editStop(lin!, lin!, 5, { offset: 0 })).toBeUndefined();
  });

  it('stroke: tambah, ubah, warna, sisi, hapus', () => {
    const r = t('a', 'rect', {});
    expect(addStroke([r])).toEqual([{ op: 'update', id: 'a', patch: { stroke: { color: '#000000', width: 1, align: 'inside' } } }]);
    const s = t('b', 'rect', { stroke: { color: '#E5E5E5', width: 1, align: 'inside' } });
    expect(addStroke([s])).toEqual([]);
    expect(setStroke([s], { width: 2 })[0]).toMatchObject({ patch: { stroke: { color: '#E5E5E5', width: 2, align: 'inside' } } });
    expect(setStroke([s], { align: 'center' })[0]).toMatchObject({ patch: { stroke: { align: 'center' } } });
    expect(strokeColor([s], '000')[0]).toMatchObject({ patch: { stroke: { color: '#000000' } } });
    const off = toggleSide([s], 'top')[0] as unknown as { patch: { stroke: Raw } };
    expect(off.patch.stroke.sides).toEqual(['right', 'bottom', 'left']);
    const back = t('c', 'rect', { stroke: { ...s.stored.stroke as Raw, sides: ['right', 'bottom', 'left'] } });
    expect((toggleSide([back], 'top')[0] as unknown as { patch: { stroke: Raw } }).patch.stroke).toEqual({ color: '#E5E5E5', width: 1, align: 'inside' });
    expect(toggleSide([t('d', 'rect', { stroke: { color: '#000000', width: 1, align: 'inside', sides: ['top'] } })], 'top')).toEqual([]);
    expect(strokeSides(undefined)).toEqual(['top', 'right', 'bottom', 'left']);
    // Multi bersisi campuran: sisi baru dari primer (terakhir) dipasang ke semua.
    const m1 = t('m', 'rect', { stroke: { color: '#000000', width: 1, align: 'inside', sides: ['top'] } });
    const m2 = t('n', 'rect', { stroke: { color: '#000000', width: 1, align: 'inside' } });
    expect(toggleSide([m1, m2], 'top').map((o) => (o as unknown as { patch: { stroke: Raw } }).patch.stroke.sides)).toEqual([
      ['right', 'bottom', 'left'],
      ['right', 'bottom', 'left'],
    ]);
    expect(removeStroke([s])).toEqual([{ op: 'update', id: 'b', patch: { stroke: null } }]);
  });

  it('radius: All, per sudut, mixed', () => {
    const r = t('a', 'rect', { radius: 12 });
    expect(radiusAll(12)).toEqual({ mixed: false, value: 12 });
    expect(radiusAll([8, 8, 0, 0])).toEqual({ mixed: true });
    expect(radiusAll([4, 4, 4, 4])).toEqual({ mixed: false, value: 4 });
    expect(setRadiusAll([r], 16)).toEqual([{ op: 'update', id: 'a', patch: { radius: 16 } }]);
    expect(setRadiusCorner([r], 0, 8)).toEqual([{ op: 'update', id: 'a', patch: { radius: [8, 12, 12, 12] } }]);
    expect(setRadiusCorner([t('b', 'rect', {})], 2, 4)).toEqual([{ op: 'update', id: 'b', patch: { radius: [0, 0, 4, 0] } }]);
  });

  it('efek: properti tunggal dan daftar shadow', () => {
    const f = t('a', 'frame', {});
    expect(setProp([f], 'opacity', 0.5)).toEqual([{ op: 'update', id: 'a', patch: { opacity: 0.5 } }]);
    expect(setProp([f], 'blend', 'multiply')[0]).toMatchObject({ patch: { blend: 'multiply' } });
    expect(addShadow([f])).toEqual([{ op: 'update', id: 'a', patch: { shadows: [{ type: 'drop', x: 0, y: 4, blur: 12, color: '#00000033' }] } }]);
    const s = t('b', 'frame', { shadows: [{ type: 'drop', x: 0, y: 8, blur: 24, color: '#00000033' }] });
    expect(editShadow([s], 0, (x) => ({ ...x, type: 'inner', x: 0, y: 2, blur: 6, spread: 1 }))[0]).toMatchObject({
      patch: { shadows: [{ type: 'inner', x: 0, y: 2, blur: 6, spread: 1, color: '#00000033' }] },
    });
    expect(removeShadow([s], 0)).toEqual([{ op: 'update', id: 'b', patch: { shadows: null } }]);
  });

  it('efek bertipe (spec-design-panel-figma): addEffect 4 jenis, skalar maksimal 1; removeEffect', () => {
    const f = t('a', 'frame', {});
    expect(effectKindsOf(f.stored)).toEqual(new Set());
    expect(addEffect([f], 'inner')).toEqual([{ op: 'update', id: 'a', patch: { shadows: [{ type: 'inner', x: 0, y: 4, blur: 12, color: '#00000033' }] } }]);
    expect(addEffect([f], 'blur')).toEqual([{ op: 'update', id: 'a', patch: { blur: 8 } }]);
    expect(addEffect([f], 'backdropBlur')).toEqual([{ op: 'update', id: 'a', patch: { backdropBlur: 8 } }]);
    // Skalar yang sudah terisi (≠0) tidak menambah baris kedua.
    expect(addEffect([t('b', 'frame', { blur: 4 })], 'blur')).toEqual([]);
    expect(addEffect([t('c', 'frame', { blur: 0 })], 'blur')).toEqual([{ op: 'update', id: 'c', patch: { blur: 8 } }]);
    expect(effectKindsOf({ shadows: [{ type: 'drop' }, { type: 'inner' }], blur: 4, backdropBlur: 8 })).toEqual(new Set(['drop', 'inner', 'blur', 'backdropBlur']));
    // Hapus: shadow per indeks, skalar per kunci.
    const s = t('d', 'frame', { shadows: [{ type: 'drop' }, { type: 'inner' }], blur: 4 });
    expect(removeEffect([s], 'inner', 1)).toEqual([{ op: 'update', id: 'd', patch: { shadows: [{ type: 'drop' }] } }]);
    expect(removeEffect([s], 'blur')).toEqual([{ op: 'update', id: 'd', patch: { blur: null } }]);
  });

  it('efek bertipe: convertEffect shadow↔shadow, shadow→skalar, skalar→shadow, skalar↔skalar', () => {
    const drop = { type: 'drop', x: 0, y: 4, blur: 12, color: '#00000033' };
    const a = t('a', 'frame', { shadows: [drop] });
    expect(convertEffect([a], { index: 0 }, 'inner')).toEqual([{ op: 'update', id: 'a', patch: { shadows: [{ ...drop, type: 'inner' }] } }]);
    expect(convertEffect([a], { index: 0 }, 'blur')).toEqual([{ op: 'update', id: 'a', patch: { shadows: null, blur: 8 } }]);
    const b = t('b', 'frame', { blur: 6 });
    expect(convertEffect([b], 'blur', 'drop')).toEqual([{ op: 'update', id: 'b', patch: { blur: null, shadows: [{ type: 'drop', x: 0, y: 4, blur: 12, color: '#00000033' }] } }]);
    // Nilai skalar dibawa antar kunci (blur → backdropBlur).
    expect(convertEffect([b], 'blur', 'backdropBlur')).toEqual([{ op: 'update', id: 'b', patch: { blur: null, backdropBlur: 6 } }]);
    expect(convertEffect([a], { index: 2 }, 'inner')).toEqual([]);
  });

  it('padding sumbu/sisi (spec-design-panel-figma): edges, state sumbu (mixed), set axis/edge ternormalisasi', () => {
    expect(paddingEdges(8)).toEqual([8, 8, 8, 8]);
    expect(paddingEdges([4, 8])).toEqual([4, 8, 4, 8]);
    expect(paddingEdges([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(paddingEdgeOf({ padding: [4, 8] }, 1)).toBe(8);
    const p = t('a', 'frame', { padding: [4, 8] });
    expect(paddingAxisState([p], 'h')).toEqual({ mixed: false, value: 8, resolved: 8 });
    expect(paddingAxisState([p], 'v')).toEqual({ mixed: false, value: 4, resolved: 4 });
    // Kedua sisi sumbu beda (tuple 4) → mixed; nilai antar node beda → mixed.
    expect(paddingAxisState([t('b', 'frame', { padding: [4, 8, 6, 8] })], 'v')).toEqual({ mixed: true });
    expect(paddingAxisState([p, t('c', 'frame', { padding: [4, 10] })], 'h')).toEqual({ mixed: true });
    // Tulis sumbu mempertahankan sisi lain lalu normalisasi: [4,10] → array 2; semua sama → angka; beda → tuple 4.
    expect(setPaddingAxis([p], 'h', 10)).toEqual([{ op: 'update', id: 'a', patch: { padding: [4, 10] } }]);
    // Nilai yang sama dengan tersimpan → tanpa op (filter perubahan kosong di opsFor).
    expect(setPaddingAxis([t('d', 'frame', { padding: 4 })], 'h', 4)).toEqual([]);
    expect(setPaddingAxis([p], 'v', 8)).toEqual([{ op: 'update', id: 'a', patch: { padding: 8 } }]);
    expect(setPaddingEdge([t('d', 'frame', { padding: 4 })], 0, 8)).toEqual([{ op: 'update', id: 'd', patch: { padding: [8, 4, 4, 4] } }]);
    expect(setPaddingEdge([t('e', 'frame', { padding: [8, 4, 4, 4] })], 0, 4)).toEqual([{ op: 'update', id: 'e', patch: { padding: 4 } }]);
  });

  it('tipografi: satu op per edit, multi dalam satu daftar', () => {
    const a = t('a', 'text', { size: 16, weight: 400 });
    const b = t('b', 'text', { size: 16, weight: 700 });
    expect(setProp([a, b], 'weight', 700)).toEqual([{ op: 'update', id: 'a', patch: { weight: 700 } }]);
    expect(setProp([a, b], 'size', 34)).toHaveLength(2);
    expect(setProp([a], 'align', 'center')[0]).toMatchObject({ patch: { align: 'center' } });
  });
});

describe('designModel: grid (v4)', () => {
  const fr = { fr: 1 };
  it('layoutOf / parentLayoutOf / canEditXY mengenal grid', () => {
    expect(layoutOf({ layout: 'grid' })).toBe('grid');
    expect(parentLayoutOf('rect', { type: 'frame', layout: 'grid' })).toBe('grid');
    expect(canEditXY(t('a', 'rect', {}, { parentLayout: 'grid' }))).toBe(false);
    expect(canEditXY(t('a', 'rect', { position: 'absolute' }, { parentLayout: 'grid' }))).toBe(true);
  });

  it('enterGrid: kolom fr = min(max(anak,1),3) bila template belum ada; template ada → hanya layout; wrap (v9) dihapus', () => {
    expect(enterGrid([t('a', 'frame', { layout: 'row', children: [{}, {}] })])).toEqual([{ op: 'update', id: 'a', patch: { layout: 'grid', gridTemplateColumns: [fr, fr] } }]);
    expect(enterGrid([t('a', 'frame', { children: [] })])[0]!).toMatchObject({ patch: { gridTemplateColumns: [fr] } });
    expect(enterGrid([t('a', 'frame', { children: [{}, {}, {}, {}, {}] })])[0]!).toMatchObject({ patch: { gridTemplateColumns: [fr, fr, fr] } });
    expect(enterGrid([t('a', 'frame', { gridTemplateColumns: [80, fr] })])).toEqual([{ op: 'update', id: 'a', patch: { layout: 'grid' } }]);
    expect(enterGrid([t('a', 'frame', { layout: 'grid', gridTemplateColumns: [fr] })])).toEqual([]);
    expect(enterGrid([t('w', 'frame', { layout: 'row', wrap: true, children: [{}, {}] })])).toEqual([{ op: 'update', id: 'w', patch: { layout: 'grid', wrap: null, gridTemplateColumns: [fr, fr] } }]);
  });

  it('setTrackCount: naik menambah default, turun memangkas, 0 menghapus, di luar batas tanpa op', () => {
    const g = t('g', 'frame', { layout: 'grid', gridTemplateColumns: [80, fr, fr] });
    expect(trackCount(g.stored, 'gridTemplateColumns')).toBe(3);
    expect(setTrackCount([g], 'gridTemplateColumns', 4)).toEqual([{ op: 'update', id: 'g', patch: { gridTemplateColumns: [80, fr, fr, fr] } }]);
    expect(setTrackCount([g], 'gridTemplateColumns', 2)).toEqual([{ op: 'update', id: 'g', patch: { gridTemplateColumns: [80, fr] } }]);
    expect(setTrackCount([g], 'gridTemplateColumns', 3)).toEqual([]);
    expect(setTrackCount([g], 'gridTemplateRows', 2)).toEqual([{ op: 'update', id: 'g', patch: { gridTemplateRows: ['auto', 'auto'] } }]);
    expect(setTrackCount([g], 'gridTemplateRows', 0)).toEqual([]);
    const r = t('r', 'frame', { layout: 'grid', gridTemplateRows: ['auto', 40] });
    expect(setTrackCount([r], 'gridTemplateRows', 0)).toEqual([{ op: 'update', id: 'r', patch: { gridTemplateRows: null } }]);
    expect(setTrackCount([g], 'gridTemplateColumns', 25)).toEqual([]);
    expect(setTrackCount([g], 'gridTemplateColumns', 1.5)).toEqual([]);
    expect(setTrackCount([g], 'gridTemplateColumns', -1)).toEqual([]);
  });

  it('setLayout keluar dari grid menghapus columnGap/rowGap (template tetap); ke grid / dari flex hanya layout; wrap ikut dihapus ke grid/none', () => {
    const g = t('g', 'frame', { layout: 'grid', gridTemplateColumns: [fr], columnGap: 8, rowGap: 4 });
    expect(setLayout([g], 'row')).toEqual([{ op: 'update', id: 'g', patch: { layout: 'row', columnGap: null, rowGap: null } }]);
    expect(setLayout([g], null)).toEqual([{ op: 'update', id: 'g', patch: { layout: null, columnGap: null, rowGap: null } }]);
    expect(setLayout([t('h', 'frame', { layout: 'grid' })], 'column')).toEqual([{ op: 'update', id: 'h', patch: { layout: 'column' } }]);
    expect(setLayout([t('r', 'frame', { layout: 'row', columnGap: 8 })], 'column')).toEqual([{ op: 'update', id: 'r', patch: { layout: 'column' } }]);
    // Grid basi ber-wrap → flex: wrap bertahan (bermakna di flex); → none: wrap ikut terhapus.
    const gw = t('gw', 'frame', { layout: 'grid', gridTemplateColumns: [fr], wrap: true, columnGap: 8 });
    expect(setLayout([gw], 'row')).toEqual([{ op: 'update', id: 'gw', patch: { layout: 'row', columnGap: null } }]);
    expect(setLayout([gw], null)).toEqual([{ op: 'update', id: 'gw', patch: { layout: null, wrap: null, columnGap: null } }]);
  });

  it('parse Columns/Rows panel: Columns 0/abc/25 batal; Rows kosong = 0 (hapus), format 0 = kosong', () => {
    expect(parseColumnCount('4')).toBe(4);
    for (const s of ['0', 'abc', '25', '-1', '']) expect(parseColumnCount(s)).toBeUndefined();
    expect(parseRowCount('')).toBe(0);
    expect(parseRowCount('  ')).toBe(0);
    expect(parseRowCount('3')).toBe(3);
    for (const s of ['abc', '25', '-1']) expect(parseRowCount(s)).toBeUndefined();
    expect(formatRowCount(0)).toBe('');
    expect(formatRowCount(2)).toBe('2');
    expect(GRID_TRACKS_MAX).toBe(24);
  });

  it('axisGapOf: gap sumbu, lalu gap ≥ 0; gap negatif tampil 0 (diabaikan render grid)', () => {
    expect(axisGapOf({ columnGap: 6, gap: 12 }, 'columnGap')).toBe(6);
    expect(axisGapOf({ gap: 12 }, 'rowGap')).toBe(12);
    expect(axisGapOf({ gap: -4 }, 'rowGap')).toBe(0);
    expect(axisGapOf({ gap: { $token: 'space.4' } }, 'rowGap')).toEqual({ $token: 'space.4' });
    expect(axisGapOf({}, 'columnGap')).toBe(0);
  });

  it('gap sumbu: setProp columnGap tidak menyentuh gap', () => {
    const g = t('g', 'frame', { layout: 'grid', gap: 12 });
    expect(setProp([g], 'columnGap', 20)).toEqual([{ op: 'update', id: 'g', patch: { columnGap: 20 } }]);
    expect(readField([g], (n) => n.columnGap ?? n.gap ?? 0)).toMatchObject({ value: 12 });
  });
});
