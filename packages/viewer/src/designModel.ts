// Model panel Design (editor-canvas story 5): kelompok properti per tipe node, nilai gabungan seleksi ("Mixed"), dan
// pembangun op `update` untuk route ops viewer (AD-7). Murni: masukan = node tersimpan (ref token utuh) + pasangan
// ter-resolve (AD-10); keluaran = DocOp[] tanpa op untuk node yang nilainya tidak berubah. Patch hanya memakai
// properti skema v3 (AD-1, AD-13); `null` menghapus properti opsional (core `update`).
import { GRID_TRACKS_MAX, STROKE_DASH_MAX, STROKE_MITERLIMIT_MAX, type DocOp } from '@lakar/schema';
import { isTokenRef, joinHex, parseNumber, round2, sameValue, splitHex, withHex } from './designValues.js';

export type Raw = Record<string, unknown>;
export type ParentLayout = 'row' | 'column' | 'grid' | 'none';

/** Satu node terpilih untuk panel Design. */
export type DesignTarget = {
  id: string;
  type: string;
  name: string;
  /** Node tersimpan (ref `{$token}` utuh). */
  stored: Raw;
  /** Node yang sama dari `resolveDocument` (nilai token mode aktif); sama dengan `stored` bila tidak tersedia. */
  resolved: Raw;
  /** Layout induk; undefined untuk board. */
  parentLayout: ParentLayout | undefined;
  /** Ukuran terukur DOM live (koordinat desain). */
  measured?: { w: number; h: number } | undefined;
  /** Mode tema efektif board pemilik (`themeMode` ?? mode pertama; AD-11): nilai token di picker dan detach. */
  mode?: string | undefined;
  /**
   * Entri override instance terluar untuk alamat ini (epic komponen story 4): ada untuk akar instance dan isi instance
   * (alamat komposit), `stored` = node efektif. Override Marker dan Reset membacanya.
   */
  overrides?: Readonly<Record<string, unknown>> | undefined;
};

export type Group = 'position' | 'autoLayout' | 'typography' | 'icon' | 'appearance' | 'fill' | 'stroke' | 'effects';

/**
 * Kelompok per tipe (urutan tampil, spec-design-panel-figma). `appearance` = Opacity + Blend + Radius; kontrol
 * Radius sendiri hanya tampil bila semua target termasuk RADIUS_TYPES (frame/rect — satu-satunya yang punya
 * `radius` di skema). Teks tidak punya fills/stroke di skema, jadi kelompok itu tidak tampil.
 */
export const RADIUS_TYPES: ReadonlySet<string> = new Set(['frame', 'rect']);
const GROUPS: Record<string, readonly Group[]> = {
  board: ['position', 'fill'],
  frame: ['position', 'autoLayout', 'appearance', 'fill', 'stroke', 'effects'],
  rect: ['position', 'appearance', 'fill', 'stroke', 'effects'],
  ellipse: ['position', 'appearance', 'fill', 'stroke', 'effects'],
  path: ['position', 'appearance', 'fill', 'stroke', 'effects'],
  text: ['position', 'typography', 'appearance', 'effects'],
  icon: ['position', 'icon', 'appearance', 'effects'],
};
const ORDER: readonly Group[] = ['position', 'autoLayout', 'typography', 'icon', 'appearance', 'fill', 'stroke', 'effects'];

/** Kelompok yang berlaku untuk semua node terpilih. */
export function designGroups(targets: readonly DesignTarget[]): Group[] {
  if (targets.length === 0) return [];
  return ORDER.filter((g) => targets.every((t) => (GROUPS[t.type] ?? []).includes(g)));
}

export type FieldState = { mixed: true } | { mixed: false; value: unknown; resolved: unknown };

/** Nilai gabungan: sama di semua node → nilai tersimpan + resolve (node pertama); beda → mixed. */
export function readField(targets: readonly DesignTarget[], get: (n: Raw) => unknown): FieldState {
  const first = targets[0];
  if (!first) return { mixed: false, value: undefined, resolved: undefined };
  const v = get(first.stored);
  if (targets.some((t) => !sameValue(get(t.stored), v))) return { mixed: true };
  return { mixed: false, value: v, resolved: get(first.resolved) };
}

/**
 * Nilai baru dari kolom sama dengan nilai resolve sebuah ref token → tidak ada perubahan (ref dipertahankan);
 * selain itu nilai baru (literal, detach AD-11).
 */
export function keepsToken(state: FieldState, next: unknown): boolean {
  return !state.mixed && isTokenRef(state.value) && sameValue(state.resolved, next);
}

export type Patch = Record<string, unknown>;

/** Op `update` per node dari `patchFor`; kunci yang nilainya sudah sama dilewati, node tanpa perubahan tanpa op. */
export function opsFor(targets: readonly DesignTarget[], patchFor: (t: DesignTarget) => Patch | undefined): DocOp[] {
  const ops: DocOp[] = [];
  for (const t of targets) {
    const raw = patchFor(t);
    if (!raw) continue;
    const patch: Patch = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === undefined) continue;
      const cur = t.stored[k];
      if (v === null ? cur === undefined : sameValue(cur, v)) continue;
      patch[k] = v;
    }
    if (Object.keys(patch).length) ops.push({ op: 'update', id: t.id, patch });
  }
  return ops;
}

/** Satu properti sama untuk semua node. */
export const setProp = (targets: readonly DesignTarget[], key: string, value: unknown): DocOp[] => opsFor(targets, () => ({ [key]: value }));

/** Deskripsi entri History: `Change width` / `Change width on 3 layers`. */
export const describeEdit = (label: string, n: number) => (n > 1 ? `${label} on ${n} layers` : label);

// ---------------------------------------------------------------------------
// Posisi & ukuran
// ---------------------------------------------------------------------------

export type Sizing = 'fixed' | 'hug' | 'fill';
export type Axis = 'width' | 'height';

/** Mode sizing nilai tersimpan; ketiadaan = hug (render layout.ts: ukuran konten sendiri), kecuali board (angka, atau tinggi `'hug'` sejak v8). */
export function sizingMode(type: string, v: unknown): Sizing {
  if (v === 'hug' || v === 'fill') return v;
  if (v === undefined && type !== 'board') return 'hug';
  return 'fixed';
}

/** Mode sizing gabungan seleksi (undefined = campuran). */
export function readSizing(targets: readonly DesignTarget[], axis: Axis): Sizing | undefined {
  const modes = new Set(targets.map((t) => sizingMode(t.type, t.stored[axis])));
  return modes.size === 1 ? [...modes][0] : undefined;
}

/** Ganti mode sizing: hug/fill langsung; fixed = ukuran terukur dibulatkan (angka tersimpan tetap). */
export function setSizing(targets: readonly DesignTarget[], axis: Axis, mode: Sizing): DocOp[] {
  return opsFor(targets, (t) => {
    if (mode !== 'fixed') return { [axis]: mode };
    const cur = t.stored[axis];
    if (typeof cur === 'number' || isTokenRef(cur)) return undefined;
    const m = t.measured?.[axis === 'width' ? 'w' : 'h'];
    return m === undefined ? undefined : { [axis]: Math.max(0, Math.round(m)) };
  });
}

/**
 * Layout induk untuk `DesignTarget.parentLayout`, sejajar dengan core `implicitAbsolute` dan render layout.ts: board
 * = kolom (anak flow), frame tanpa `layout`/`none` = none (anak absolute), row/column apa adanya; node board → undefined.
 */
export function parentLayoutOf(type: string, parent: Raw | undefined): ParentLayout | undefined {
  if (type === 'board') return undefined;
  if (parent?.type === 'board') return 'column';
  return parent?.layout === 'row' || parent?.layout === 'column' || parent?.layout === 'grid' ? parent.layout : 'none';
}

/** X/Y bisa diedit: board, node absolute, atau anak frame `none` (core menambah `position` lewat implicitAbsolute). */
export const canEditXY = (t: DesignTarget) => t.type === 'board' || t.stored.position === 'absolute' || t.parentLayout === 'none';

// ---------------------------------------------------------------------------
// Auto layout
// ---------------------------------------------------------------------------

/** Arah layout tersimpan (ketiadaan = none). */
export const layoutOf = (n: Raw) => (n.layout === 'row' || n.layout === 'column' || n.layout === 'grid' ? n.layout : 'none');

/**
 * Ganti arah layout. Keluar dari grid menghapus `columnGap`/`rowGap`: di flex keduanya tetap berlaku (CSS) tetapi
 * panel flex hanya menampilkan Gap, jadi tanpa ini Gap tertimpa nilai yang tidak terlihat. Template track dipertahankan.
 * Keluar dari flex (ke grid/none) juga menghapus `wrap` (v9): properti itu hanya bermakna di row/column dan panel
 * menyembunyikannya di luar flex, jadi tidak boleh tersimpan sebagai nilai tak terlihat.
 */
export const setLayout = (targets: readonly DesignTarget[], layout: ParentLayout | null) =>
  opsFor(targets, (t) => ({
    layout,
    ...(layout === 'row' || layout === 'column' ? {} : { wrap: null }),
    ...(t.stored.layout === 'grid' && layout !== 'grid' ? { columnGap: null, rowGap: null } : {}),
  }));

export { GRID_TRACKS_MAX };

/** Teks kolom Columns → jumlah 1..GRID_TRACKS_MAX (dibulatkan); 0/teks tak valid → undefined (batal). */
export const parseColumnCount = (text: string) => parseNumber(text, { int: true, min: 1, max: GRID_TRACKS_MAX });
/** Teks kolom Rows → jumlah 0..GRID_TRACKS_MAX; kosong = 0 (hapus template, "Auto"). */
export const parseRowCount = (text: string) => (text.trim() === '' ? 0 : parseNumber(text, { int: true, min: 0, max: GRID_TRACKS_MAX }));
/** Nilai Rows → teks kolom: 0 (tanpa template) ditampilkan kosong dengan placeholder "Auto". */
export const formatRowCount = (v: unknown) => (typeof v === 'number' && v > 0 ? String(v) : '');

/**
 * Gap sumbu yang tampil di panel grid: `columnGap`/`rowGap`, lalu `gap` bila ≥ 0 (gap negatif diabaikan render grid).
 */
export const axisGapOf = (n: Raw, key: 'columnGap' | 'rowGap') => n[key] ?? (typeof n.gap === 'number' && n.gap < 0 ? 0 : n.gap) ?? 0;

export type TrackAxis = 'gridTemplateColumns' | 'gridTemplateRows';
/** Track tambahan saat jumlah dinaikkan: kolom `1fr`, baris `auto`. */
const TRACK_DEFAULT: Record<TrackAxis, unknown> = { gridTemplateColumns: { fr: 1 }, gridTemplateRows: 'auto' };

const tracksOf = (n: Raw, axis: TrackAxis): unknown[] => (Array.isArray(n[axis]) ? (n[axis] as unknown[]) : []);

/** Jumlah track tersimpan (0 = tanpa template). */
export const trackCount = (n: Raw, axis: TrackAxis) => tracksOf(n, axis).length;

/**
 * Ubah jumlah track: track awal dipertahankan, sisanya ditambah default (kolom `{fr:1}`, baris `'auto'`); 0 menghapus
 * template (`null`). Di luar 0..GRID_TRACKS_MAX atau bukan integer → tanpa op.
 */
export function setTrackCount(targets: readonly DesignTarget[], axis: TrackAxis, count: number): DocOp[] {
  if (!Number.isInteger(count) || count < 0 || count > GRID_TRACKS_MAX) return [];
  return opsFor(targets, (t) => {
    if (count === 0) return { [axis]: null };
    const cur = tracksOf(t.stored, axis);
    const next = Array.from({ length: count }, (_, i) => (i < cur.length ? cur[i] : structuredClone(TRACK_DEFAULT[axis])));
    return { [axis]: next };
  });
}

/** Masuk mode grid: `layout:'grid'` + kolom `{fr:1}` sebanyak min(max(anak, 1), 3) bila template kolom belum ada. `wrap` (hanya flex) dihapus. */
export function enterGrid(targets: readonly DesignTarget[]): DocOp[] {
  return opsFor(targets, (t) => {
    if (tracksOf(t.stored, 'gridTemplateColumns').length) return { layout: 'grid', wrap: null };
    const kids = Array.isArray(t.stored.children) ? t.stored.children.length : 0;
    return { layout: 'grid', wrap: null, gridTemplateColumns: Array.from({ length: Math.min(Math.max(kids, 1), 3) }, () => ({ fr: 1 })) };
  });
}

/** Sumbu padding panel: 'h' = kiri/kanan, 'v' = atas/bawah. */
export type PadAxis = 'h' | 'v';

/** Padding tersimpan → 4 sisi [atas, kanan, bawah, kiri]; angka = semua sisi; [v,h] = shorthand CSS. */
export function paddingEdges(v: unknown): unknown[] {
  if (Array.isArray(v)) {
    if (v.length === 4) return [...v];
    if (v.length === 2) return [v[0] ?? 0, v[1] ?? 0, v[0] ?? 0, v[1] ?? 0];
  }
  return [v ?? 0, v ?? 0, v ?? 0, v ?? 0];
}

/** Tulis ulang tuple sisi menjadi bentuk skema minimal: semua sama → angka; [v,h] → array 2; selain itu array 4. */
const padTuple = (e: unknown[]): unknown => {
  if (e.every((x) => sameValue(x, e[0]))) return e[0];
  if (sameValue(e[0], e[2]) && sameValue(e[1], e[3])) return [e[0], e[1]];
  return e;
};

/**
 * FieldState sumbu padding (kolom Pad H/V, spec-design-panel-figma): kedua sisi sumbu pada satu node beda, atau
 * nilai sumbu beda antar node → mixed. Ref token pada salah satu sisi ikut terbaca (ditampilkan apa adanya).
 */
export function paddingAxisState(targets: readonly DesignTarget[], axis: PadAxis): FieldState {
  const idx: [number, number] = axis === 'h' ? [1, 3] : [0, 2];
  const axisOf = (n: Raw): { same: boolean; value: unknown } => {
    const e = paddingEdges(n.padding);
    return sameValue(e[idx[0]], e[idx[1]]) ? { same: true, value: e[idx[0]] } : { same: false, value: undefined };
  };
  const first = targets[0];
  if (!first) return { mixed: false, value: undefined, resolved: undefined };
  const vals = targets.map((t) => axisOf(t.stored));
  if (vals.some((v) => !v.same || !sameValue(v.value, vals[0]!.value))) return { mixed: true };
  const res = axisOf(first.resolved);
  return { mixed: false, value: vals[0]!.value, resolved: res.same ? res.value : vals[0]!.value };
}

/** Sisi padding tunggal (indeks tuple [t,r,b,l]) untuk kolom mode Independent. */
export const paddingEdgeOf = (n: Raw, i: number): unknown => paddingEdges(n.padding)[i];

/** Ubah kedua sisi satu sumbu padding (sisi lain dipertahankan), lalu normalisasi tuple. */
export function setPaddingAxis(targets: readonly DesignTarget[], axis: PadAxis, value: unknown): DocOp[] {
  const idx: [number, number] = axis === 'h' ? [1, 3] : [0, 2];
  return opsFor(targets, (t) => {
    const e = paddingEdges(t.stored.padding);
    e[idx[0]] = value;
    e[idx[1]] = value;
    return { padding: padTuple(e) };
  });
}

/** Ubah satu sisi padding (tuple 4), lalu normalisasi. */
export function setPaddingEdge(targets: readonly DesignTarget[], index: number, value: unknown): DocOp[] {
  return opsFor(targets, (t) => {
    const e = paddingEdges(t.stored.padding);
    e[index] = value;
    return { padding: padTuple(e) };
  });
}

// ---------------------------------------------------------------------------
// Fill
// ---------------------------------------------------------------------------

export type FillLike = Raw & { type?: unknown };
export type FillRow = { index: number; fill: FillLike; resolved: FillLike };
export const FILL_DEFAULT = '#D9D9D9';

const fillsOf = (n: Raw): FillLike[] => (Array.isArray(n.fills) ? (n.fills as FillLike[]) : []);

/** Baris fill urut tampil: atas = lapisan teratas = indeks terakhir (render: `fills[0]` paling bawah). */
export function fillRows(t: DesignTarget): FillRow[] {
  const s = fillsOf(t.stored);
  const r = fillsOf(t.resolved);
  return s.map((fill, index) => ({ index, fill, resolved: r[index] ?? fill })).reverse();
}

const withFills = (fills: FillLike[]): Patch => ({ fills: fills.length ? fills : null });

export const addFill = (targets: readonly DesignTarget[]) =>
  opsFor(targets, (t) => withFills([...fillsOf(t.stored), { type: 'solid', color: FILL_DEFAULT }]));

export const removeFill = (targets: readonly DesignTarget[], index: number) =>
  opsFor(targets, (t) => withFills(fillsOf(t.stored).filter((_, i) => i !== index)));

/** Pindah fill indeks `from` ke indeks `to` (indeks array tersimpan). */
export function moveFill(targets: readonly DesignTarget[], from: number, to: number): DocOp[] {
  return opsFor(targets, (t) => {
    const f = [...fillsOf(t.stored)];
    if (from === to || from < 0 || from >= f.length || to < 0 || to >= f.length) return undefined;
    const [x] = f.splice(from, 1);
    f.splice(to, 0, x!);
    return { fills: f };
  });
}

/** Ganti fill indeks `index` lewat `edit(fill, resolved)`. */
export function editFill(targets: readonly DesignTarget[], index: number, edit: (fill: FillLike, resolved: FillLike) => FillLike | undefined): DocOp[] {
  return opsFor(targets, (t) => {
    const s = fillsOf(t.stored);
    const fill = s[index];
    if (!fill) return undefined;
    const next = edit(fill, fillsOf(t.resolved)[index] ?? fill);
    if (!next) return undefined;
    return { fills: s.map((f, i) => (i === index ? next : f)) };
  });
}

/** Seleksi dengan fills berbeda: ganti semuanya dengan satu solid (baris "Mixed"). */
export const setAllFills = (targets: readonly DesignTarget[], fills: FillLike[] | null) => opsFor(targets, () => ({ fills }));

/** Warna solid baru dari teks hex: alpha lama dipertahankan (dari nilai resolve bila tersimpan sebagai token). */
export function solidColor(fill: FillLike, resolved: FillLike, hexText: string): FillLike | undefined {
  if (fill.type !== 'solid') return undefined;
  const next = withHex(resolved.color, hexText);
  return next.startsWith('#') && splitHex(next) ? { ...fill, color: next } : undefined;
}

/** Alpha solid (0–1) pada warna resolve. */
export function solidAlpha(fill: FillLike, resolved: FillLike, alpha: number): FillLike | undefined {
  const c = splitHex(resolved.color);
  if (fill.type !== 'solid' || !c) return undefined;
  return { ...fill, color: joinHex(c.hex, alpha) };
}

export type PaintKind = 'solid' | 'linear' | 'radial';
type Stop = { offset: number; color: unknown };

/** Konversi jenis fill dengan mempertahankan warna: solid → gradien (warna → warna transparan), gradien → solid (stop pertama). */
export function convertFill(fill: FillLike, resolved: FillLike, kind: PaintKind): FillLike | undefined {
  if (fill.type === kind) return undefined;
  const stops = (Array.isArray(fill.stops) ? fill.stops : undefined) as Stop[] | undefined;
  if (kind === 'solid') {
    if (!stops?.length) return undefined;
    return { type: 'solid', color: stops[0]!.color };
  }
  let nextStops = stops;
  if (!nextStops) {
    if (fill.type !== 'solid') return undefined;
    const c = splitHex(resolved.color);
    nextStops = [
      { offset: 0, color: fill.color },
      { offset: 1, color: c ? joinHex(c.hex, 0) : '#00000000' },
    ];
  }
  return kind === 'linear' ? { type: 'linear', angle: typeof fill.angle === 'number' ? fill.angle : 180, stops: nextStops } : { type: 'radial', stops: nextStops };
}

/** Ubah satu stop gradien: warna (teks hex, alpha dipertahankan) dan/atau offset 0–1 (di-clamp). */
export function editStop(fill: FillLike, resolved: FillLike, k: number, change: { hex?: string; offset?: number }): FillLike | undefined {
  const stops = Array.isArray(fill.stops) ? (fill.stops as Stop[]) : undefined;
  const rs = Array.isArray(resolved.stops) ? (resolved.stops as Stop[]) : stops;
  const stop = stops?.[k];
  if (!stops || !stop) return undefined;
  const next: Stop = { ...stop };
  if (change.hex !== undefined) {
    const c = withHex(rs?.[k]?.color, change.hex);
    if (!splitHex(c)) return undefined;
    next.color = c;
  }
  if (change.offset !== undefined) next.offset = round2(Math.min(1, Math.max(0, change.offset)));
  return { ...fill, stops: stops.map((s, i) => (i === k ? next : s)) };
}

// ---------------------------------------------------------------------------
// Stroke
// ---------------------------------------------------------------------------

export const SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type Side = (typeof SIDES)[number];
export const STROKE_DEFAULT = { color: '#000000', width: 1, align: 'inside' } as const;

export const addStroke = (targets: readonly DesignTarget[]) =>
  opsFor(targets, (t) => (t.stored.stroke ? undefined : { stroke: { ...STROKE_DEFAULT } }));

export const removeStroke = (targets: readonly DesignTarget[]) => setProp(targets, 'stroke', null);

/** Gabungkan perubahan ke stroke tiap node (node tanpa stroke mendapat default + perubahan). */
export function setStroke(targets: readonly DesignTarget[], change: Raw): DocOp[] {
  return opsFor(targets, (t) => ({ stroke: { ...((t.stored.stroke as Raw | undefined) ?? STROKE_DEFAULT), ...change } }));
}

/** Warna stroke baru dari teks hex (alpha dipertahankan). */
export function strokeColor(targets: readonly DesignTarget[], hexText: string): DocOp[] {
  return opsFor(targets, (t) => {
    const s = t.stored.stroke as Raw | undefined;
    if (!s) return undefined;
    const c = withHex((t.resolved.stroke as Raw | undefined)?.color, hexText);
    return splitHex(c) ? { stroke: { ...s, color: c } } : undefined;
  });
}

/** Sisi aktif stroke (ketiadaan `sides` = semua). */
export const strokeSides = (stroke: unknown): Side[] => {
  const s = (stroke as Raw | undefined)?.sides;
  return Array.isArray(s) ? SIDES.filter((x) => s.includes(x)) : [...SIDES];
};

/**
 * Nyala/matikan satu sisi; sisi terakhir tidak bisa dimatikan; semua sisi aktif → `sides` dihapus. Sisi baru dihitung
 * dari node primer (terakhir) lalu dipasang ke semua node, sehingga seleksi bersisi campuran menyatu.
 */
export function toggleSide(targets: readonly DesignTarget[], side: Side): DocOp[] {
  const primary = targets[targets.length - 1]?.stored.stroke;
  const cur = strokeSides(primary);
  const next = cur.includes(side) ? cur.filter((x) => x !== side) : SIDES.filter((x) => x === side || cur.includes(x));
  if (next.length === 0) return [];
  return opsFor(targets, (t) => {
    const s = t.stored.stroke as Raw | undefined;
    if (!s) return undefined;
    const { sides: _drop, ...rest } = s;
    return { stroke: next.length === SIDES.length ? rest : { ...rest, sides: next } };
  });
}

// ---------------------------------------------------------------------------
// Vektor (epic paste-vektor story 2, AD-14; desain J7AmQi/S8w37): fill rule, cap, join, dash, miter pada path
// ---------------------------------------------------------------------------

/** Kontrol vektor tampil hanya bila semua node terpilih adalah path. */
export const isVectorSelection = (targets: readonly DesignTarget[]) => targets.length > 0 && targets.every((t) => t.type === 'path');

/** Nilai bawaan SVG/render yang ditampilkan bila properti belum diisi. */
export const VECTOR_DEFAULTS = { fillRule: 'nonzero', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeMiterlimit: 4 } as const;
export type VectorProp = 'fillRule' | 'strokeLinecap' | 'strokeLinejoin' | 'strokeDasharray' | 'strokeMiterlimit';
export const DASH_MAX = STROKE_DASH_MAX;
export const MITER_MAX = STROKE_MITERLIMIT_MAX;

/** Nilai vektor node atau bawaannya (untuk tampilan). */
export const vectorValue = (n: Raw, key: Exclude<VectorProp, 'strokeDasharray'>): unknown => n[key] ?? VECTOR_DEFAULTS[key];

/** Tulis satu properti vektor ke semua path terpilih (`null` = hapus). */
export const setVector = (targets: readonly DesignTarget[], key: VectorProp, value: unknown): DocOp[] =>
  opsFor(targets, (t) => (t.type === 'path' ? { [key]: value } : undefined));

/**
 * Teks Dash → `strokeDasharray`: angka ≥ 0 dipisah spasi/koma (maks 16). Kosong, `none`, atau semua 0 → `null`
 * (garis utuh, properti dihapus). Tidak valid → undefined.
 */
export function parseDash(text: string): number[] | null | undefined {
  const t = text.trim();
  if (t === '' || t.toLowerCase() === 'none') return null;
  const parts = t.split(/[\s,]+/).filter(Boolean);
  if (parts.length > DASH_MAX) return undefined;
  const nums = parts.map((p) => parseNumber(p, { min: 0 }));
  if (nums.some((n) => n === undefined)) return undefined;
  return (nums as number[]).every((n) => n === 0) ? null : (nums as number[]);
}

/** `strokeDasharray` → teks Dash (`4 2`); tidak diisi → kosong. */
export const formatDash = (v: unknown): string => (Array.isArray(v) ? v.map((n) => String(round2(Number(n)))).join(' ') : '');

/** Teks Miter → `strokeMiterlimit` (1..100). */
export const parseMiter = (text: string) => parseNumber(text, { min: 1, max: MITER_MAX });

// ---------------------------------------------------------------------------
// Radius
// ---------------------------------------------------------------------------

export const CORNERS = ['TL', 'TR', 'BR', 'BL'] as const;

/** Radius tersimpan → 4 sudut (TL, TR, BR, BL); ketiadaan = 0. */
export function radiusCorners(v: unknown): unknown[] {
  if (Array.isArray(v) && v.length === 4) return [...v];
  return [v ?? 0, v ?? 0, v ?? 0, v ?? 0];
}

/** Nilai kolom All: angka/token tunggal, atau tuple yang keempat sudutnya sama. */
export function radiusAll(v: unknown): { mixed: true } | { mixed: false; value: unknown } {
  const c = radiusCorners(v);
  return c.every((x) => sameValue(x, c[0])) ? { mixed: false, value: c[0] } : { mixed: true };
}

export const setRadiusAll = (targets: readonly DesignTarget[], value: unknown) => setProp(targets, 'radius', value);

/** Ubah satu sudut: radius tiap node jadi tuple 4. */
export function setRadiusCorner(targets: readonly DesignTarget[], corner: number, value: unknown): DocOp[] {
  return opsFor(targets, (t) => {
    const c = radiusCorners(t.stored.radius);
    c[corner] = value;
    return { radius: c };
  });
}

// ---------------------------------------------------------------------------
// Efek: shadow
// ---------------------------------------------------------------------------

export const SHADOW_DEFAULT = { type: 'drop', x: 0, y: 4, blur: 12, color: '#00000033' } as const;
const shadowsOf = (n: Raw): Raw[] => (Array.isArray(n.shadows) ? (n.shadows as Raw[]) : []);
const withShadows = (s: Raw[]): Patch => ({ shadows: s.length ? s : null });

/** Jenis efek daftar (spec-design-panel-figma): dua jenis shadow + blur layer + blur latar. */
export type EffectKind = 'drop' | 'inner' | 'blur' | 'backdropBlur';
/** Baris efek satu node: shadow menyertakan indeks array; skalar blur/backdropBlur tidak berindeks. */
export type EffectRow = { kind: 'drop' | 'inner'; index: number; shadow: Raw; resolved: Raw } | { kind: 'blur' | 'backdropBlur'; value: unknown; resolved: unknown };

/** Jenis baris efek yang sudah dipakai node (untuk menonaktifkan duplikat skalar di menu "+"). */
export const effectKindsOf = (n: Raw): Set<EffectKind> => {
  const k = new Set<EffectKind>();
  for (const s of shadowsOf(n)) k.add(s.type === 'inner' ? 'inner' : 'drop');
  if (typeof n.blur === 'number' && n.blur !== 0) k.add('blur');
  if (typeof n.backdropBlur === 'number' && n.backdropBlur !== 0) k.add('backdropBlur');
  return k;
};

export const addShadow = (targets: readonly DesignTarget[], type: 'drop' | 'inner' = 'drop') =>
  opsFor(targets, (t) => withShadows([...shadowsOf(t.stored), { ...SHADOW_DEFAULT, type }]));

/** Tambah baris efek: shadow baru bertipe `kind`, atau skalar blur/backdropBlur = 8 bila belum diisi. */
export function addEffect(targets: readonly DesignTarget[], kind: EffectKind): DocOp[] {
  if (kind === 'drop' || kind === 'inner') return addShadow(targets, kind);
  return opsFor(targets, (t) => (typeof t.stored[kind] === 'number' && t.stored[kind] !== 0 ? undefined : { [kind]: 8 }));
}

export const removeShadow = (targets: readonly DesignTarget[], index: number) =>
  opsFor(targets, (t) => withShadows(shadowsOf(t.stored).filter((_, i) => i !== index)));

/** Hapus satu baris efek: shadow pada indeks `index`, atau skalar blur/backdropBlur. */
export function removeEffect(targets: readonly DesignTarget[], kind: EffectKind, index = 0): DocOp[] {
  return kind === 'blur' || kind === 'backdropBlur' ? setProp(targets, kind, null) : removeShadow(targets, index);
}

/**
 * Ubah jenis satu baris efek (menu jenis di baris, spec-design-panel-figma): shadow↔shadow mengganti `type` di
 * tempat; shadow→skalar membuang shadow dan mengisi skalar 8; skalar→shadow membuang skalar dan menambah shadow
 * `SHADOW_DEFAULT`; skalar↔skalar memindahkan nilai ke kunci lain.
 */
export function convertEffect(targets: readonly DesignTarget[], from: { index: number } | 'blur' | 'backdropBlur', to: EffectKind): DocOp[] {
  const toShadow = to === 'drop' || to === 'inner';
  return opsFor(targets, (t) => {
    const list = shadowsOf(t.stored);
    const patch: Patch = {};
    if (typeof from === 'object') {
      const cur = list[from.index];
      if (!cur) return undefined;
      if (toShadow) {
        patch.shadows = list.map((s, i) => (i === from.index ? { ...s, type: to } : s));
        return patch;
      }
      const next = list.filter((_, i) => i !== from.index);
      patch.shadows = next.length ? next : null;
    } else {
      patch[from] = null;
    }
    if (toShadow) {
      const base = Array.isArray(patch.shadows) ? (patch.shadows as Raw[]) : list.filter((_, i) => i !== (typeof from === 'object' ? from.index : -1));
      patch.shadows = [...base, { ...SHADOW_DEFAULT, type: to }];
    } else {
      // Nilai lama dibawa bila skalar sumber bertipe sama (mis. blur → backdropBlur).
      patch[to] = typeof from === 'object' ? 8 : t.stored[from] ?? 8;
    }
    return patch;
  });
}

/** Ubah shadow indeks `index` lewat `edit(shadow, resolved)`. */
export function editShadow(targets: readonly DesignTarget[], index: number, edit: (s: Raw, resolved: Raw) => Raw | undefined): DocOp[] {
  return opsFor(targets, (t) => {
    const all = shadowsOf(t.stored);
    const s = all[index];
    if (!s) return undefined;
    const next = edit(s, shadowsOf(t.resolved)[index] ?? s);
    return next ? { shadows: all.map((x, i) => (i === index ? next : x)) } : undefined;
  });
}
