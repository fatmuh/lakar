// Model Token Picker panel Design (epic token-tema story 4, desain 07: u5v2n/XvZQy, Token Field zjtyn). Murni:
// saringan token per slot memakai tabel slot `tokenSlot` @lakar/schema (AD-11, satu-satunya sumber), lalu pembangun
// op untuk pasang ref `{$token}`, detach ke nilai mode efektif board (AD-11), dan buat token dari nilai field — semua
// berupa DocOp[] untuk route ops viewer (AD-7). Setter slot = pembangun op edit literal field yang sama (designModel).
import { isTokenValueOf, LENGTH_TOKEN_TYPES, tokenSlot, type DocOp, type TokenType } from '@lakar/schema';
// Label History tanpa akhiran " on N layers": antrean panel Design (`ctx.run`) menambahkannya lewat `describeEdit`.
import { editFill, paddingEdges, radiusAll, radiusCorners, readField, setPaddingAxis, setPaddingEdge, setProp, setRadiusAll, setRadiusCorner, setStroke, type DesignTarget, type FieldState, type PadAxis, type Raw } from './designModel.js';
import { isTokenRef } from './designValues.js';
import { cellOf, groupOf, modeLabel, tokenNameError, TYPE_META, type Built, type TokenDefLike, type TokenMap } from './themeModel.js';

/** Tulis `value` (literal atau ref) ke slot field pada `targets`; node tanpa perubahan tanpa op. */
export type SlotSetter = (targets: readonly DesignTarget[], value: unknown) => DocOp[];

/** Slot token sebuah field panel Design. */
export type TokenSpec = {
  /** Path ref di dalam node (mis. `['fills', 0, 'color']`), untuk tabel slot. */
  propPath: readonly (string | number)[];
  /** Nilai tersimpan field dari node. */
  read: (n: Raw) => unknown;
  set: SlotSetter;
  /** Nama field untuk aria/title ("Gap", "Fill"). */
  label: string;
};

// ---------------------------------------------------------------------------
// Spesifikasi slot field panel Design (setter = pembangun op edit literal field yang sama)
// ---------------------------------------------------------------------------

/** Slot token satu properti tingkat atas (`setProp`); `read` default = nilai tersimpan apa adanya. */
export const propSpec = (key: string, label: string, read: (n: Raw) => unknown = (n) => n[key]): TokenSpec => ({
  propPath: [key],
  read,
  set: (ts, v) => setProp(ts, key, v),
  label,
});

const fillAt = (n: Raw, index: number) => (Array.isArray(n.fills) ? (n.fills[index] as Raw | undefined) : undefined);

/** Warna fill solid indeks `index` (indeks array tersimpan); fill non-solid tidak diubah. */
export const fillColorSpec = (index: number): TokenSpec => ({
  propPath: ['fills', index, 'color'],
  label: 'Fill',
  read: (n) => fillAt(n, index)?.color,
  set: (ts, v) => editFill(ts, index, (f) => (f.type === 'solid' ? { ...f, color: v } : undefined)),
});

/** Warna stop `k` gradien fill `index`. */
export const stopColorSpec = (index: number, k: number): TokenSpec => ({
  propPath: ['fills', index, 'stops', k, 'color'],
  label: 'Gradient stop',
  read: (n) => {
    const stops = fillAt(n, index)?.stops;
    return Array.isArray(stops) ? (stops[k] as Raw | undefined)?.color : undefined;
  },
  set: (ts, v) =>
    editFill(ts, index, (f) => (Array.isArray(f.stops) && f.stops[k] ? { ...f, stops: (f.stops as Raw[]).map((s, i) => (i === k ? { ...s, color: v } : s)) } : undefined)),
});

/** Warna atau lebar stroke. */
export const strokeSpec = (key: 'color' | 'width', label: string): TokenSpec => ({
  propPath: ['stroke', key],
  label,
  read: (n) => (n.stroke as Raw | undefined)?.[key],
  set: (ts, v) => setStroke(ts, { [key]: v }),
});

/**
 * Radius All (`radius` tunggal; tuple 4 sudut sama dibaca sebagai satu nilai, sama dengan kolom All) atau satu sudut
 * (`radius[i]`, tuple 4).
 */
export const radiusSpec = (corner?: number, label = 'Radius'): TokenSpec =>
  corner === undefined
    ? {
        propPath: ['radius'],
        label,
        read: (n) => {
          const all = radiusAll(n.radius ?? 0);
          return all.mixed ? n.radius : all.value;
        },
        set: setRadiusAll,
      }
    : { propPath: ['radius', corner], label, read: (n) => radiusCorners(n.radius)[corner], set: (ts, v) => setRadiusCorner(ts, corner, v) };

/** Slot token sumbu padding (kolom Pad H/V): token diterapkan ke kedua sisi sumbu (sisi lain dipertahankan). */
export const paddingAxisSpec = (axis: PadAxis, label: string): TokenSpec => ({
  propPath: ['padding', axis === 'h' ? 1 : 0],
  label,
  read: (n) => paddingEdges(n.padding)[axis === 'h' ? 1 : 0],
  set: (ts, v) => setPaddingAxis(ts, axis, v),
});

/** Slot token satu sisi padding (kolom Independent T/R/B/L; indeks tuple [t,r,b,l]). */
export const paddingEdgeSpec = (index: number, label: string): TokenSpec => ({
  propPath: ['padding', index],
  label,
  read: (n) => paddingEdges(n.padding)[index],
  set: (ts, v) => setPaddingEdge(ts, index, v),
});

export type SlotTypes = { accepts: TokenType[]; primary: TokenType };

/** Tipe token yang diterima slot di semua node terpilih (irisan); undefined = bukan slot token / tanpa tipe bersama. */
export function slotAccepts(targets: readonly DesignTarget[], propPath: readonly (string | number)[]): SlotTypes | undefined {
  let accepts: TokenType[] | undefined;
  let primary: TokenType | undefined;
  for (const t of targets) {
    const slot = tokenSlot(t.type, propPath);
    if (!slot) return undefined;
    accepts = accepts ? accepts.filter((a) => slot.accepts.includes(a)) : [...slot.accepts];
    primary ??= slot.primary;
  }
  if (!accepts?.length) return undefined;
  return { accepts, primary: primary && accepts.includes(primary) ? primary : accepts[0]! };
}

export type PickerRow = { name: string; type: TokenType; value: string | number; text: string };
export type PickerGroup = { group: string; rows: PickerRow[] };

/** Teks nilai token pada mode (format sel panel Theme; warna tanpa `#`). */
export const tokenValueText = (def: TokenDefLike, mode: string | undefined, modes: readonly string[] = []) =>
  TYPE_META[def.type].format(cellOf(def, mode, modes).value);

/** Token bertipe `accepts` yang namanya memuat `query`, dikelompokkan per grup (urut kemunculan), nilai mode `mode`. */
export function pickerGroups(tokens: TokenMap = {}, accepts: readonly TokenType[], query: string, mode: string | undefined, modes: readonly string[] = []): PickerGroup[] {
  const q = query.trim().toLowerCase();
  const out: PickerGroup[] = [];
  const at = new Map<string, PickerGroup>();
  for (const [name, def] of Object.entries(tokens)) {
    if (!accepts.includes(def.type) || (q && !name.includes(q))) continue;
    const g = groupOf(name);
    let grp = at.get(g);
    if (!grp) {
      grp = { group: g, rows: [] };
      at.set(g, grp);
      out.push(grp);
    }
    grp.rows.push({ name, type: def.type, value: cellOf(def, mode, modes).value, text: tokenValueText(def, mode, modes) });
  }
  return out;
}

const isLengthGroup = (accepts: readonly TokenType[]) => accepts.length === LENGTH_TOKEN_TYPES.length && LENGTH_TOKEN_TYPES.every((t) => accepts.includes(t));

/** Nama jenis untuk hint/kosong: satu tipe = label tipe, grup panjang = "Length". */
export const acceptsLabel = (accepts: readonly TokenType[]) => (accepts.length === 1 ? TYPE_META[accepts[0]!].label : isLengthGroup(accepts) ? 'Length' : 'Matching');

/** Hint di bawah pencarian: "Color tokens · values for Dark" (dokumen tanpa mode: tanpa bagian kedua). */
export const pickerHint = (accepts: readonly TokenType[], mode: string | undefined, modes: readonly string[] = []) =>
  `${acceptsLabel(accepts)} tokens${modes.length && mode ? ` · values for ${modeLabel(mode)}` : ''}`;

/** Teks daftar kosong. */
export const pickerEmpty = (accepts: readonly TokenType[], query: string) =>
  query.trim() ? `No tokens match “${query.trim()}”.` : `No ${acceptsLabel(accepts).toLowerCase()} tokens yet.`;

/** Nama token ref field (tidak campuran), atau undefined. */
export const refAt = (state: FieldState): string | undefined => (!state.mixed && isTokenRef(state.value) ? state.value.$token : undefined);

/** Ada node terpilih yang memegang ref di slot field (Detach tersedia, juga untuk nilai campuran). */
export const anyRef = (targets: readonly DesignTarget[], read: TokenSpec['read']) => targets.some((t) => isTokenRef(read(t.stored)));

/** Pasang token `name` ke slot semua node terpilih (node yang sudah memakainya tanpa op). */
export function applyTokenOps(targets: readonly DesignTarget[], spec: Pick<TokenSpec, 'set'>, name: string): Built {
  const ops = spec.set(targets, { $token: name });
  return { ops, label: ops.length ? `Apply token ${name}` : '' };
}

/**
 * Detach: tiap node yang memegang ref di slot mendapat literal `modes[mode]` ?? `value` dengan mode efektif
 * board-nya (`DesignTarget.mode`, AD-11). Satu commit; ref ke token yang tidak ada dilewati.
 */
export function detachOps(targets: readonly DesignTarget[], spec: Pick<TokenSpec, 'read' | 'set'>, tokens: TokenMap = {}, modes: readonly string[] = []): Built {
  const ops: DocOp[] = [];
  const names = new Set<string>();
  for (const t of targets) {
    const v = spec.read(t.stored);
    if (!isTokenRef(v)) continue;
    const def = tokens[v.$token];
    if (!def) continue;
    names.add(v.$token);
    ops.push(...spec.set([t], cellOf(def, t.mode, modes).value));
  }
  if (!ops.length) return { ops: [], label: '' };
  const label = names.size === 1 ? `Detach token ${[...names][0]}` : 'Detach tokens';
  return { ops, label };
}

/** Nilai untuk "Create token from value": nilai resolve field bila sah untuk tipe utama slot, selain itu undefined. */
export function createValue(state: FieldState, type: TokenType): string | number | undefined {
  if (state.mixed) return undefined;
  const v = state.resolved;
  return (typeof v === 'string' || typeof v === 'number') && isTokenValueOf(type, v) ? v : undefined;
}

/** Buat token `name` bertipe utama slot dari nilai field, lalu pasang ke semua node terpilih — satu commit. */
export function createTokenOps(tokens: TokenMap = {}, rawName: string, type: TokenType, state: FieldState, targets: readonly DesignTarget[], spec: Pick<TokenSpec, 'set'>): Built {
  const name = rawName.trim();
  const error = tokenNameError(tokens, name);
  if (error) return { error };
  if (state.mixed) return { error: 'Selected layers have different values.' };
  const value = createValue(state, type);
  if (value === undefined) return { error: `This value can't be a ${TYPE_META[type].label.toLowerCase()} token.` };
  return {
    ops: [{ op: 'setTokens', tokens: { [name]: { type, value } } }, ...spec.set(targets, { $token: name })],
    label: `Create token ${name}`,
  };
}

/** Status field untuk picker (dibaca ulang dari target terbaru). */
export const specState = (targets: readonly DesignTarget[], spec: Pick<TokenSpec, 'read'>) => readField(targets, spec.read);
