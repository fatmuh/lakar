// Aksi edit canvas (editor-canvas story 6, desain bagian 05 "Context menu" dan "Multi-select"): group, ungroup,
// duplikat, hapus, urutan z, align, distribute, nudge, pilih semua, dan edit teks. Tiap aksi menjadi satu plan berisi
// daftar `DocOp` untuk satu permintaan route ops (AD-7); invers dari respons route masuk tumpukan undo (AD-8).
// Murni: tanpa DOM dan tanpa IO. `scene` = pohon geometri board halaman aktif (gesture.ts, koordinat halaman).
import type { DocOp } from '@lakar/schema';
import { indexGeo, moveOps, unionBox, type Box, type GeoNode } from './gesture.js';

/** Bulat ke integer tanpa -0. */
const rnd = (v: number): number => Math.round(v) + 0;

export type AlignAction = 'align-left' | 'align-center' | 'align-right' | 'align-top' | 'align-middle' | 'align-bottom';
export type DistributeAction = 'distribute-h' | 'distribute-v';
/** Aksi komponen (epic komponen story 4): jadikan seleksi master, dan detach instance. */
export type ComponentAction = 'create-component' | 'detach';
/**
 * Paritas Figma (spec-canvas-shortcuts): `front`/`back` = ujung z (selain `forward`/`backward` satu langkah),
 * `wrap-frame` = bungkus dalam frame (mekanika group, nama "Frame"), `auto-layout`/`unlayout` = `layout` row ↔ none,
 * `fit-content` = frame dirapatkan ke union anaknya.
 */
export type EditAction =
  | 'group'
  | 'ungroup'
  | 'duplicate'
  | 'copy-png'
  | 'delete'
  | 'forward'
  | 'backward'
  | 'front'
  | 'back'
  | 'wrap-frame'
  | 'auto-layout'
  | 'unlayout'
  | 'fit-content'
  | AlignAction
  | DistributeAction
  | ComponentAction;

export const ALIGN_ACTIONS: readonly AlignAction[] = ['align-left', 'align-center', 'align-right', 'align-top', 'align-middle', 'align-bottom'];
export const DISTRIBUTE_ACTIONS: readonly DistributeAction[] = ['distribute-h', 'distribute-v'];
export const EDIT_ACTIONS: readonly EditAction[] = [
  'group',
  'ungroup',
  'duplicate',
  'copy-png',
  'delete',
  'forward',
  'backward',
  'front',
  'back',
  'wrap-frame',
  'auto-layout',
  'unlayout',
  'fit-content',
  ...ALIGN_ACTIONS,
  ...DISTRIBUTE_ACTIONS,
  'create-component',
  'detach',
];

/**
 * Plan satu aksi. `select`: seleksi sesudah sukses — `ids` langsung, atau `refs` (nama `ref` op add/duplicate yang
 * dipetakan lewat `refs` respons route). Tanpa `select` seleksi dipertahankan.
 */
export type EditPlan = { ops: DocOp[]; label: string; select?: { ids?: string[]; refs?: string[] } };
/** Hasil perencanaan: plan, pesan untuk pengguna (aksi tidak berlaku), atau undefined (tidak ada yang dikerjakan). */
export type PlanResult = EditPlan | { error: string } | undefined;

/** Batas `description` route ops. */
const LABEL_MAX = 200;
const label = (s: string): string => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s);
const named = (verb: string, nodes: readonly GeoNode[]): string => label(nodes.length === 1 ? `${verb} ${nodes[0]!.name}` : `${verb} ${nodes.length} layers`);

/** Offset duplikat node absolut (satuan dokumen) dan jarak duplikat board di kanan aslinya. */
export const DUPLICATE_OFFSET = 10;
export const BOARD_GAP = 40;

/** Anggota seleksi yang ada di scene tanpa leluhur yang juga terpilih (urutan seleksi dipertahankan). */
export function topMost(index: ReadonlyMap<string, GeoNode>, ids: readonly string[]): GeoNode[] {
  const set = new Set(ids);
  const seen = new Set<string>();
  return ids.flatMap((id) => {
    const n = index.get(id);
    if (!n || seen.has(id)) return [];
    seen.add(id);
    for (let p = n.parentId; p; p = index.get(p)?.parentId) if (set.has(p)) return [];
    return [n];
  });
}

/** Saudara node (urutan dokumen): anak parent, atau board halaman untuk board. */
function siblingsOf(scene: readonly GeoNode[], index: ReadonlyMap<string, GeoNode>, n: GeoNode): readonly GeoNode[] {
  return n.parentId ? (index.get(n.parentId)?.children ?? []) : scene;
}

/** Asal koordinat x/y node absolut di parentnya (koordinat halaman) = kotak terukur − x/y tersimpan. */
const originOf = (n: GeoNode) => ({ x: n.box.x - n.x, y: n.box.y - n.y });

const SAME_PARENT = 'Select layers in the same parent to group';

function planGroup(scene: readonly GeoNode[], index: ReadonlyMap<string, GeoNode>, ids: readonly string[], name = 'Group', layout: 'none' | 'row' = 'none'): PlanResult {
  const members = topMost(index, ids);
  if (!members.length) return undefined;
  if (members.some((m) => m.type === 'board')) return { error: `Boards can't be ${layout === 'row' ? 'auto-laid out' : 'grouped'}` };
  const parentId = members[0]!.parentId;
  if (!parentId || members.some((m) => m.parentId !== parentId)) return { error: SAME_PARENT };
  const siblings = siblingsOf(scene, index, members[0]!);
  const at = (m: GeoNode) => siblings.findIndex((s) => s.id === m.id);
  const ordered = [...members].sort((a, b) => at(a) - at(b));
  const u = unionBox(ordered.map((m) => m.box))!;
  const flow = ordered.some((m) => !m.absolute);
  const anchor = flow ? at(ordered[0]!) : at(ordered[ordered.length - 1]!);
  const memberIds = new Set(ordered.map((m) => m.id));
  const finalIndex = siblings.filter((s, i) => i < anchor && !memberIds.has(s.id)).length;
  const frame: Record<string, unknown> = { type: 'frame', name, layout, width: Math.max(1, rnd(u.w)), height: Math.max(1, rnd(u.h)) };
  // Asal frame: anggota absolut pertama memberi asal koordinat parent, jadi x/y anak = x/y lama − x/y frame (persis).
  let fx = rnd(u.x);
  let fy = rnd(u.y);
  if (!flow) {
    const o = originOf(ordered[0]!);
    fx = rnd(u.x - o.x);
    fy = rnd(u.y - o.y);
    Object.assign(frame, { position: 'absolute', x: fx, y: fy });
  }
  const ops: DocOp[] = [{ op: 'add', parentId, node: frame, ref: 'group' }];
  for (const m of ordered) {
    ops.push({ op: 'move', id: m.id, parentId: '@group' });
    // Auto layout: anak jadi flow (`null` menghapus posisi absolut); grup: tetap absolut relatif frame baru.
    const patch =
      layout === 'row'
        ? { position: null, x: null, y: null }
        : { position: 'absolute', x: flow ? rnd(m.box.x - u.x) : rnd(m.box.x - originOf(ordered[0]!).x) - fx, y: flow ? rnd(m.box.y - u.y) : rnd(m.box.y - originOf(ordered[0]!).y) - fy };
    ops.push({ op: 'update', id: m.id, patch });
  }
  ops.push({ op: 'move', id: '@group', parentId, index: finalIndex });
  return { ops, label: named(name === 'Group' ? 'Group' : name === 'Frame' ? 'Frame selection' : 'Add auto layout to', ordered), select: { refs: ['group'] } };
}

/**
 * Auto layout (Shift+A, Figma): satu frame → `layout:'row'`; multi/satu non-frame → dibungkus frame `layout:'row'`
 * bernama "Auto layout" (mekanika `planGroup`, anak jadi flow). `unlayout` (Alt+Shift+A): `layout` → 'none'.
 */
function planAutoLayout(scene: readonly GeoNode[], index: ReadonlyMap<string, GeoNode>, ids: readonly string[]): PlanResult {
  const members = topMost(index, ids);
  if (!members.length) return undefined;
  if (members.length === 1 && members[0]!.type === 'frame') {
    // Frame yang sudah auto layout: Shift+A no-op (paritas Figma).
    if (members[0]!.layout === 'row' || members[0]!.layout === 'column' || members[0]!.layout === 'grid') return undefined;
    return { ops: [{ op: 'update', id: members[0]!.id, patch: { layout: 'row' } }], label: label(`Add auto layout to ${members[0]!.name}`) };
  }
  return planGroup(scene, index, ids, 'Auto layout', 'row');
}

function planUnlayout(_scene: readonly GeoNode[], index: ReadonlyMap<string, GeoNode>, ids: readonly string[]): PlanResult {
  const frames = topMost(index, ids).filter((n) => n.type === 'frame' && (n.layout === 'row' || n.layout === 'column' || n.layout === 'grid'));
  if (!frames.length) return undefined;
  return { ops: frames.map((f) => ({ op: 'update', id: f.id, patch: { layout: 'none' } })), label: named('Remove auto layout from', frames) };
}

/** Ujung z (Figma `]`/`[`): anggota terpilih pindah ke indeks akhir (front) / 0 (back) tiap parent; sudah di ujung → lewati. */
function planZEdge(scene: readonly GeoNode[], index: ReadonlyMap<string, GeoNode>, ids: readonly string[], dir: 'front' | 'back'): PlanResult {
  const members = topMost(index, ids);
  if (!members.length) return undefined;
  const sel = new Set(members.map((m) => m.id));
  const ops: DocOp[] = [];
  for (const p of [...new Set(members.map((m) => m.parentId ?? ''))]) {
    const order = (p ? (index.get(p)?.children ?? []) : scene).map((n) => n.id);
    const parentId = p || null;
    const picked = order.filter((id) => sel.has(id));
    const rest = order.filter((id) => !sel.has(id));
    // Indeks akhir tiap anggota (urutan relatif dipertahankan); anggota yang indeksnya sudah sama dilewati.
    picked.forEach((id, k) => {
      const final = dir === 'front' ? rest.length + k : k;
      if (order.indexOf(id) !== final) ops.push({ op: 'move', id, parentId, index: final });
    });
  }
  return ops.length ? { ops, label: named(dir === 'front' ? 'Bring to front' : 'Send to back', members) } : undefined;
}

/** Fit content (Figma Ctrl+Alt+Shift+R): frame/board absolut dirapatkan ke union anak-anaknya; anak ikut bergeser. */
function planFitContent(_scene: readonly GeoNode[], index: ReadonlyMap<string, GeoNode>, ids: readonly string[]): PlanResult {
  const frames = topMost(index, ids).filter((n) => (n.type === 'frame' || n.type === 'board') && n.absolute && n.children.length > 0);
  if (!frames.length) return undefined;
  const ops: DocOp[] = [];
  for (const f of frames) {
    const u = unionBox(f.children.map((c) => c.box));
    if (!u) continue;
    const dx = rnd(u.x - f.box.x);
    const dy = rnd(u.y - f.box.y);
    if (dx === 0 && dy === 0 && rnd(u.w) === rnd(f.box.w) && rnd(u.h) === rnd(f.box.h)) continue;
    for (const c of f.children) {
      if (!c.absolute) continue;
      if (dx !== 0 || dy !== 0) ops.push({ op: 'update', id: c.id, patch: { x: rnd(c.x - dx), y: rnd(c.y - dy) } });
    }
    ops.push({ op: 'update', id: f.id, patch: { x: rnd(f.x + dx), y: rnd(f.y + dy), width: Math.max(1, rnd(u.w)), height: Math.max(1, rnd(u.h)) } });
  }
  return ops.length ? { ops, label: named('Resize to fit', frames) } : undefined;
}

function planUngroup(scene: readonly GeoNode[], index: ReadonlyMap<string, GeoNode>, ids: readonly string[]): PlanResult {
  // Frame kosong tidak di-ungroup (bukan hapus diam-diam berlabel "Ungroup").
  // Instance hasil ekspansi bertipe frame, tetapi isinya bukan node tersimpan: tidak bisa di-ungroup (detach dulu).
  const frames = topMost(index, ids).filter((n) => n.type === 'frame' && n.component !== 'instance' && n.parentId && n.children.length > 0);
  if (!frames.length) return undefined;
  // Per parent dari indeks terbesar: indeks frame lain di parent yang sama tidak bergeser.
  const at = (n: GeoNode) => siblingsOf(scene, index, n).findIndex((s) => s.id === n.id);
  const ordered = [...frames].sort((a, b) => (a.parentId === b.parentId ? at(b) - at(a) : a.parentId! < b.parentId! ? -1 : 1));
  const ops: DocOp[] = [];
  const lifted: string[] = [];
  for (const f of ordered) {
    const parent = index.get(f.parentId!)!;
    const i = at(f);
    const parentFlow = parent.layout === 'row' || parent.layout === 'column' || parent.layout === 'grid';
    const o = f.absolute ? originOf(f) : { x: parent.box.x, y: parent.box.y };
    f.children.forEach((c, k) => {
      ops.push({ op: 'move', id: c.id, parentId: parent.id, index: i + k });
      const staysFlow = !c.absolute && !f.absolute && parentFlow;
      if (!staysFlow) ops.push({ op: 'update', id: c.id, patch: { position: 'absolute', x: rnd(c.box.x - o.x), y: rnd(c.box.y - o.y) } });
      lifted.push(c.id);
    });
    ops.push({ op: 'remove', id: f.id });
  }
  return { ops, label: named('Ungroup', frames), select: { ids: lifted } };
}

function planDuplicate(index: ReadonlyMap<string, GeoNode>, ids: readonly string[]): PlanResult {
  const members = topMost(index, ids);
  if (!members.length) return undefined;
  const refs: string[] = [];
  const ops: DocOp[] = members.map((m, k) => {
    const ref = `dup${k}`;
    refs.push(ref);
    if (m.type === 'board') return { op: 'duplicate', id: m.id, patch: { x: rnd(m.x + m.box.w + BOARD_GAP) }, ref };
    if (m.absolute) return { op: 'duplicate', id: m.id, patch: { x: rnd(m.x + DUPLICATE_OFFSET), y: rnd(m.y + DUPLICATE_OFFSET) }, ref };
    return { op: 'duplicate', id: m.id, ref };
  });
  return { ops, label: named('Duplicate', members), select: { refs } };
}

function planDelete(index: ReadonlyMap<string, GeoNode>, ids: readonly string[]): PlanResult {
  const members = topMost(index, ids);
  if (!members.length) return undefined;
  return { ops: members.map((m) => ({ op: 'remove', id: m.id })), label: named('Delete', members), select: { ids: [] } };
}

/** Satu langkah z: anggota terpilih bertukar dengan saudara tak terpilih di depan (forward) / belakang (backward). */
function planZOrder(scene: readonly GeoNode[], index: ReadonlyMap<string, GeoNode>, ids: readonly string[], dir: 'forward' | 'backward'): PlanResult {
  const members = topMost(index, ids);
  if (!members.length) return undefined;
  const sel = new Set(members.map((m) => m.id));
  const parents = [...new Set(members.map((m) => m.parentId ?? ''))];
  const ops: DocOp[] = [];
  for (const p of parents) {
    const order = (p ? (index.get(p)?.children ?? []) : scene).map((n) => n.id);
    const parentId = p || null;
    if (dir === 'forward') {
      for (let i = order.length - 2; i >= 0; i--) {
        if (sel.has(order[i]!) && !sel.has(order[i + 1]!)) {
          [order[i], order[i + 1]] = [order[i + 1]!, order[i]!];
          ops.push({ op: 'move', id: order[i + 1]!, parentId, index: i + 1 });
        }
      }
    } else {
      for (let i = 1; i < order.length; i++) {
        if (sel.has(order[i]!) && !sel.has(order[i - 1]!)) {
          [order[i], order[i - 1]] = [order[i - 1]!, order[i]!];
          ops.push({ op: 'move', id: order[i - 1]!, parentId, index: i - 1 });
        }
      }
    }
  }
  if (!ops.length) return undefined;
  return { ops, label: named(dir === 'forward' ? 'Bring forward' : 'Send backward', members) };
}

/** Kotak acuan align: bounding box seleksi (≥2), atau parent untuk satu node non-board. */
function alignReference(index: ReadonlyMap<string, GeoNode>, members: readonly GeoNode[]): Box | undefined {
  if (members.length >= 2) return unionBox(members.map((m) => m.box));
  const only = members[0];
  return only?.parentId ? index.get(only.parentId)?.box : undefined;
}

/** Op pindah node absolut/board ke kotak target (hanya sumbu yang berubah). */
function shiftOp(n: GeoNode, dx: number, dy: number): DocOp | undefined {
  const patch: Record<string, number> = {};
  const x = rnd(n.x + dx);
  const y = rnd(n.y + dy);
  if (x !== n.x) patch.x = x;
  if (y !== n.y) patch.y = y;
  return Object.keys(patch).length ? { op: 'update', id: n.id, patch } : undefined;
}

function planAlign(index: ReadonlyMap<string, GeoNode>, ids: readonly string[], kind: AlignAction): PlanResult {
  const members = topMost(index, ids);
  const ref = alignReference(index, members);
  if (!ref) return undefined;
  const ops: DocOp[] = [];
  for (const n of members) {
    if (!n.absolute) continue;
    const b = n.box;
    let dx = 0;
    let dy = 0;
    if (kind === 'align-left') dx = ref.x - b.x;
    else if (kind === 'align-center') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
    else if (kind === 'align-right') dx = ref.x + ref.w - (b.x + b.w);
    else if (kind === 'align-top') dy = ref.y - b.y;
    else if (kind === 'align-middle') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
    else dy = ref.y + ref.h - (b.y + b.h);
    const op = shiftOp(n, dx, dy);
    if (op) ops.push(op);
  }
  if (!ops.length) return undefined;
  const title = { 'align-left': 'Align left', 'align-center': 'Align center', 'align-right': 'Align right', 'align-top': 'Align top', 'align-middle': 'Align middle', 'align-bottom': 'Align bottom' }[kind];
  return { ops, label: named(title, members) };
}

function planDistribute(index: ReadonlyMap<string, GeoNode>, ids: readonly string[], kind: DistributeAction): PlanResult {
  const nodes = topMost(index, ids).filter((n) => n.absolute);
  if (nodes.length < 3) return undefined;
  const h = kind === 'distribute-h';
  const start = (b: Box) => (h ? b.x : b.y);
  const size = (b: Box) => (h ? b.w : b.h);
  const sorted = [...nodes].sort((a, b) => start(a.box) - start(b.box) || a.id.localeCompare(b.id));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = start(last.box) + size(last.box) - start(first.box);
  const gap = (span - sorted.reduce((s, n) => s + size(n.box), 0)) / (sorted.length - 1);
  const ops: DocOp[] = [];
  let cursor = start(first.box) + size(first.box) + gap;
  for (const n of sorted.slice(1, -1)) {
    const d = cursor - start(n.box);
    const op = shiftOp(n, h ? d : 0, h ? 0 : d);
    if (op) ops.push(op);
    cursor += size(n.box) + gap;
  }
  if (!ops.length) return undefined;
  return { ops, label: named(h ? 'Distribute horizontally' : 'Distribute vertically', sorted) };
}

/** Alamat komposit (isi instance, AD-12): hanya bisa di-update/reset, bukan dipindah/dihapus/diduplikat. */
const composite = (n: GeoNode) => n.id.includes('/');
/** Aksi yang memindah/menghapus/menyalin node tersimpan: nonaktif bila seleksi memuat alamat komposit. */
const STRUCTURAL: ReadonlySet<EditAction> = new Set<EditAction>(['group', 'ungroup', 'duplicate', 'delete', 'forward', 'backward', 'front', 'back', 'wrap-frame', 'auto-layout', 'unlayout', 'fit-content']);
/** Nama master hasil Create component dari beberapa layer (frame pembungkus). */
export const COMPONENT_FRAME_NAME = 'Component';
const EMPTY_COMPONENT = { props: [], slots: [] };

/** Leluhur `n` di scene (parent terdekat dulu). */
function ancestors(index: ReadonlyMap<string, GeoNode>, n: GeoNode): GeoNode[] {
  const out: GeoNode[] = [];
  for (let p = n.parentId ? index.get(n.parentId) : undefined; p; p = p.parentId ? index.get(p.parentId) : undefined) out.push(p);
  return out;
}

/**
 * Create component (desain ZHqtv): satu node non-board/non-instance → `setComponent`; beberapa node satu parent (atau
 * satu instance) → dibungkus frame (plan group), dinamai, lalu frame itu dijadikan master. Satu permintaan.
 */
function planCreateComponent(scene: readonly GeoNode[], index: ReadonlyMap<string, GeoNode>, ids: readonly string[]): PlanResult {
  const members = topMost(index, ids);
  if (!members.length) return undefined;
  if (members.some((m) => m.type === 'board')) return { error: "Boards can't become components" };
  if (members.some((m) => composite(m) || ancestors(index, m).some((a) => composite(a) || a.component === 'instance'))) return { error: "Layers inside an instance can't become components" };
  // Master tidak boleh bersarang (AD-12): master yang sudah ada tidak bisa dijadikan/dibungkus master baru.
  if (members.some((m) => m.component === 'master')) return { error: 'This layer is already a component' };
  if (members.some((m) => ancestors(index, m).some((a) => a.component === 'master'))) return { error: "Layers inside a component can't become components" };
  const only = members.length === 1 ? members[0]! : undefined;
  if (only && only.component !== 'instance') {
    return { ops: [{ op: 'setComponent', id: only.id, component: EMPTY_COMPONENT }], label: label(`Create component ${only.name}`), select: { ids: [only.id] } };
  }
  const group = planGroup(scene, index, ids);
  if (group && 'error' in group && group.error === SAME_PARENT) return { error: 'Select layers in the same parent to create a component' };
  if (!group || 'error' in group) return group;
  return {
    ops: [...group.ops, { op: 'update', id: '@group', patch: { name: COMPONENT_FRAME_NAME } }, { op: 'setComponent', id: '@group', component: EMPTY_COMPONENT }],
    label: label(`Create component from ${members.length === 1 ? members[0]!.name : `${members.length} layers`}`),
    select: { refs: ['group'] },
  };
}

/** Detach (AD-12): satu op `detach` ber-ref per instance terpilih; seleksi = node hasil detach. */
function planDetach(index: ReadonlyMap<string, GeoNode>, ids: readonly string[]): PlanResult {
  const instances = topMost(index, ids).filter((n) => n.component === 'instance' && !composite(n));
  if (!instances.length) return undefined;
  const refs = instances.map((_, k) => `det${k}`);
  return {
    ops: instances.map((n, k) => ({ op: 'detach', id: n.id, ref: refs[k]! })),
    label: label(instances.length === 1 ? `Detach ${instances[0]!.name}` : `Detach ${instances.length} instances`),
    select: { refs },
  };
}

/** Rencana aksi `kind` untuk seleksi `ids` di `scene`. */
export function planAction(kind: EditAction, scene: readonly GeoNode[], ids: readonly string[]): PlanResult {
  const index = indexGeo(scene);
  if (STRUCTURAL.has(kind) && topMost(index, ids).some(composite)) return undefined;
  switch (kind) {
    case 'copy-png':
      // Bukan op dokumen: Viewer mengekspor PNG node ke clipboard (route ekspor + navigator.clipboard).
      return undefined;
    case 'create-component':
      return planCreateComponent(scene, index, ids);
    case 'detach':
      return planDetach(index, ids);
    case 'group':
      return planGroup(scene, index, ids);
    case 'ungroup':
      return planUngroup(scene, index, ids);
    case 'duplicate':
      return planDuplicate(index, ids);
    case 'delete':
      return planDelete(index, ids);
    case 'forward':
    case 'backward':
      return planZOrder(scene, index, ids, kind);
    case 'front':
    case 'back':
      return planZEdge(scene, index, ids, kind);
    case 'wrap-frame':
      return planGroup(scene, index, ids, 'Frame');
    case 'auto-layout':
      return planAutoLayout(scene, index, ids);
    case 'unlayout':
      return planUnlayout(scene, index, ids);
    case 'fit-content':
      return planFitContent(scene, index, ids);
    case 'distribute-h':
    case 'distribute-v':
      return planDistribute(index, ids, kind);
    default:
      return planAlign(index, ids, kind);
  }
}

/**
 * Ketersediaan aksi untuk menu/panel: struktural (aksi berlaku untuk seleksi ini), bukan "akan mengubah sesuatu" —
 * kecuali urutan z yang nonaktif bila seleksi sudah paling depan/belakang.
 */
export function actionState(scene: readonly GeoNode[], ids: readonly string[]): Record<EditAction, boolean> {
  const index = indexGeo(scene);
  const members = topMost(index, ids);
  const any = members.length > 0;
  const absolute = members.filter((m) => m.absolute);
  const parent = members[0]?.parentId;
  const canAlign = absolute.length > 0 && (members.length >= 2 || (members.length === 1 && parent !== undefined));
  const out = {} as Record<EditAction, boolean>;
  for (const a of ALIGN_ACTIONS) out[a] = canAlign;
  for (const a of DISTRIBUTE_ACTIONS) out[a] = absolute.length >= 3;
  const structural = any && !members.some(composite);
  out.group = structural && members.every((m) => m.type !== 'board' && m.parentId !== undefined && m.parentId === parent);
  out.ungroup = structural && members.some((m) => m.type === 'frame' && m.component !== 'instance' && m.parentId !== undefined && m.children.length > 0);
  out.duplicate = structural;
  // Copy as PNG (desain 11): tepat satu node tersimpan — alamat komposit (isi instance) tidak bisa dirender daemon.
  out['copy-png'] = members.length === 1 && !composite(members[0]!);
  out.delete = structural;
  out.forward = structural && planZOrder(scene, index, ids, 'forward') !== undefined;
  out.backward = structural && planZOrder(scene, index, ids, 'backward') !== undefined;
  out.front = structural && members.some((m) => planZEdge(scene, index, [m.id], 'front') !== undefined);
  out.back = structural && members.some((m) => planZEdge(scene, index, [m.id], 'back') !== undefined);
  out['wrap-frame'] = out.group;
  out['auto-layout'] = structural && (members.some((m) => m.type !== 'frame' || m.layout === 'none' || m.layout === undefined) || members.length > 1);
  out.unlayout = structural && members.some((m) => m.layout === 'row' || m.layout === 'column' || m.layout === 'grid');
  out['fit-content'] = structural && members.some((m) => (m.type === 'frame' || m.type === 'board') && m.absolute && m.children.length > 0);
  const create = planCreateComponent(scene, index, ids);
  out['create-component'] = create !== undefined && !('error' in create);
  out.detach = planDetach(index, ids) !== undefined;
  return out;
}

/** Node yang bisa di-nudge: x/y tersimpan dibaca pemanggil dari dokumen terkini (bukan geometri yang bisa basi). */
export type NudgeNode = { id: string; name: string; absolute: boolean; x: number; y: number };
/** Nudge panah: Δ untuk node absolut/board; node flow diabaikan. */
export function nudgeOps(nodes: readonly NudgeNode[], dx: number, dy: number): EditPlan | undefined {
  const movable = nodes.filter((n) => n.absolute);
  const ops = moveOps(movable.map((n) => ({ id: n.id, type: '', name: n.name, box: { x: 0, y: 0, w: 0, h: 0 }, parentId: undefined, absolute: true, x: n.x, y: n.y, layout: undefined, children: [] })), dx, dy);
  if (!ops.length) return undefined;
  return { ops, label: label(movable.length === 1 ? `Nudge ${movable[0]!.name}` : `Nudge ${movable.length} layers`) };
}

/**
 * Node nudge dari seleksi: anggota teratas di scene, x/y dari dokumen tersimpan (`stored`, bukan geometri yang basi
 * sampai board di-mount ulang); node absolut tanpa x/y tersimpan = 0; node yang tidak ada di dokumen → geometri.
 */
export function nudgeNodes(scene: readonly GeoNode[], ids: readonly string[], stored: (id: string) => Record<string, unknown> | undefined): NudgeNode[] {
  return topMost(indexGeo(scene), ids).map((g) => {
    const s = stored(g.id);
    const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : s ? 0 : fallback);
    return { id: g.id, name: g.name, absolute: g.absolute, x: num(s?.x, g.x), y: num(s?.y, g.y) };
  });
}

/** Seleksi sesudah plan sukses: `ids` langsung, `refs` dipetakan lewat `refs` respons; undefined = tetap. */
export function selectionAfter(plan: EditPlan, refs: Readonly<Record<string, string>>): string[] | undefined {
  const s = plan.select;
  if (s?.ids) return [...s.ids];
  if (s?.refs) return s.refs.flatMap((r) => (refs[r] ? [refs[r]!] : []));
  return undefined;
}

/** Bentuk event keyboard yang dibaca `shortcutAction`/`viewShortcut`. */
export type ShortcutKey = { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };
const ALIGN_CODES: Record<string, EditAction> = { KeyA: 'align-left', KeyH: 'align-center', KeyD: 'align-right', KeyW: 'align-top', KeyV: 'align-middle', KeyS: 'align-bottom' };
const DISTRIBUTE_CODES: Record<string, EditAction> = { KeyH: 'distribute-h', KeyV: 'distribute-v' };
const ARROWS: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Gaya teks paritas Figma (spec-canvas-shortcuts): dipetakan ke patch properti node teks oleh `textStyleOps`. */
export type TextStyleKey = 'bold' | 'italic' | 'underline' | 'size+' | 'size-' | 'weight+' | 'weight-' | 'spacing+' | 'spacing-' | 'leading+' | 'leading-' | 'align-left' | 'align-right';

/** Intent edit yang bukan `EditAction` langsung: seleksi navigasi, rename, rotate, resize, dan gaya teks. */
export type ShortcutIntent =
  | { action: EditAction }
  | { selectAll: true }
  | { selectInverse: true }
  | { enter: true }
  | { parent: true }
  | { sibling: 1 | -1 }
  | { rename: true }
  | { gotoMain: true }
  | { multiVariant: true }
  | { rotate: number }
  | { resize: readonly [number, number] }
  | { textStyle: TextStyleKey }
  | { nudge: readonly [number, number] };

/**
 * Shortcut aksi (level edit): Delete/Backspace, Ctrl/⌘+G (Shift = ungroup, Ctrl+Backspace juga), Ctrl/⌘+D,
 * Ctrl/⌘+Shift+C (Copy as PNG), Ctrl/⌘+] / [ satu langkah dan `]`/`[` atau Ctrl/⌘+Shift+]/[ ke ujung,
 * Ctrl/⌘+Alt+G frame selection, Alt+A/H/D/W/V/S align, Alt+Shift+H/V distribute, Alt+Shift+A lepas auto layout,
 * Ctrl/⌘+A pilih semua, Ctrl/⌘+Shift+A inverse, Shift+A auto layout, Ctrl/⌘+Alt+Shift+R fit content,
 * Enter masuk / Shift+Enter atau `\` ke parent, Tab/Shift+Tab sibling, Ctrl/⌘+R rename,
 * Ctrl/⌘+Alt+Shift+K ke master, Q multi-edit varian, Ctrl/⌘+Alt+panah putar 1° (+Shift 15°),
 * Ctrl/⌘+Alt+L/R rata teks, Alt+panah resize 1px (Shift 10px),
 * Ctrl/⌘+B/I/U dan <>/, untuk gaya teks, panah (Shift = 10px) nudge. `code` dipakai untuk Alt/&lt;&gt; (aman macOS).
 */
export function shortcutAction(e: ShortcutKey): ShortcutIntent | undefined {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  // Ctrl/⌘+Alt(+Shift): komponen (K/B, Shift+K = ke master), frame selection (G), fit content (Shift+R), putar (panah).
  if (mod && e.altKey) {
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') return { rotate: (e.code === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 15 : 1) };
    if (e.shiftKey) return e.code === 'KeyK' ? { gotoMain: true } : e.code === 'KeyR' ? { action: 'fit-content' } : undefined;
    if (e.code === 'Comma' || e.code === 'Period') return { textStyle: `weight${e.code === 'Comma' ? '-' : '+'}` };
    if (e.key === 'Enter') return undefined;
    return e.code === 'KeyK'
      ? { action: 'create-component' }
      : e.code === 'KeyB'
        ? { action: 'detach' }
        : e.code === 'KeyG'
          ? { action: 'wrap-frame' }
          : e.code === 'KeyL'
            ? { textStyle: 'align-left' }
            : e.code === 'KeyR'
              ? { textStyle: 'align-right' }
              : undefined;
  }
  if (!mod && !e.altKey && !e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) return { action: 'delete' };
  if (mod && !e.altKey) {
    if (k === 'g') return { action: e.shiftKey ? 'ungroup' : 'group' };
    if (k === 'c' && e.shiftKey) return { action: 'copy-png' };
    if (k === 'a' && e.shiftKey) return { selectInverse: true };
    if (e.code === 'BracketRight' || e.code === 'BracketLeft') return { action: e.code === 'BracketRight' ? (e.shiftKey ? 'front' : 'forward') : e.shiftKey ? 'back' : 'backward' };
    if (e.key === 'Backspace') return { action: 'ungroup' };
    if (e.shiftKey) {
      if (e.code === 'Comma' || e.code === 'Period') return { textStyle: `size${e.code === 'Comma' ? '-' : '+'}` };
      return undefined;
    }
    if (k === 'd') return { action: 'duplicate' };
    if (k === 'a') return { selectAll: true };
    if (k === 'r') return { rename: true };
    if (k === 'b') return { textStyle: 'bold' };
    if (k === 'i') return { textStyle: 'italic' };
    if (k === 'u') return { textStyle: 'underline' };
    return undefined;
  }
  if (e.altKey && !mod) {
    if (e.code === 'Comma' || e.code === 'Period') return { textStyle: `${e.shiftKey ? 'leading' : 'spacing'}${e.code === 'Comma' ? '-' : '+'}` };
    if (e.shiftKey && e.code === 'KeyA') return { action: 'unlayout' };
    // Alt+panah: resize 1px (Shift 10px) — →/↓ membesar, ←/↑ mengecil (paritas Figma).
    const rs = ARROWS[e.key];
    if (rs) return { resize: [rs[0] * (e.shiftKey ? 10 : 1), rs[1] * (e.shiftKey ? 10 : 1)] };
    const a = (e.shiftKey ? DISTRIBUTE_CODES : ALIGN_CODES)[e.code];
    return a ? { action: a } : undefined;
  }
  if (e.shiftKey && !mod) {
    if (e.key === 'Tab') return { sibling: -1 };
    if (e.code === 'KeyA') return { action: 'auto-layout' };
    if (e.key === 'Enter') return { parent: true };
    const big = ARROWS[e.key];
    if (big) return { nudge: [big[0] * 10, big[1] * 10] };
    return undefined;
  }
  if (e.key === 'Tab') return { sibling: 1 };
  if (e.key === 'Enter') return { enter: true };
  if (e.key === '\\') return { parent: true };
  if (e.key === ']') return { action: 'front' };
  if (e.key === '[') return { action: 'back' };
  if (e.code === 'KeyQ') return { multiVariant: true };
  const arrow = ARROWS[e.key];
  if (arrow) return { nudge: [arrow[0], arrow[1]] };
  return undefined;
}

/** Kunci tampilan (tetap berlaku saat dokumen read-only): tab panel, komentar/kursor, outline, shortcuts, present, siklus fokus. */
export type ViewKey = 'tab' | 'toggle-proto' | 'present' | 'comments' | 'cursors' | 'outline' | 'shortcuts' | 'focus-cycle';

/**
 * Shortcut level tampilan (spec-canvas-shortcuts): Shift+E tab Design↔Prototype, Alt+Digit1..4 tab panel ke-N,
 * Shift+C sembunyikan pin komentar, Ctrl/⌘+Alt+\ kursor agen, Ctrl/⌘+Shift+? panel shortcut,
 * Shift+Space atau Ctrl/⌘+Alt+Enter present, F6 siklus fokus region. `tab` membawa indeks 0..3.
 */
export function viewShortcut(e: ShortcutKey): { view: ViewKey; tab?: number } | undefined {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'F6' && !mod && !e.altKey) return { view: 'focus-cycle' };
  if (mod && e.altKey && e.key === 'Enter' && !e.shiftKey) return { view: 'present' };
  if (mod && e.altKey && (e.key === '\\' || e.code === 'Backslash')) return { view: 'cursors' };
  if (mod && e.shiftKey && !e.altKey && e.code === 'KeyO') return { view: 'outline' };
  if (mod && e.shiftKey && !e.altKey && (e.key === '?' || e.code === 'Slash')) return { view: 'shortcuts' };
  if (e.shiftKey && !mod && !e.altKey) {
    if (e.code === 'KeyE') return { view: 'toggle-proto' };
    if (e.code === 'KeyC') return { view: 'comments' };
    if (e.code === 'KeyO') return { view: 'outline' };
    // ⇧I = quick insert di Figma → tab Assets (panel komponen Lakar).
    if (e.code === 'KeyI') return { view: 'tab', tab: 1 };
    if (e.code === 'Space') return { view: 'present' };
    return undefined;
  }
  if (e.altKey && !mod && !e.shiftKey && e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    // Paritas Figma: ⌥1/2/3 = tab sidebar kiri (Layers/Assets/Comments di Lakar).
    if (n >= 1 && n <= 3) return { view: 'tab', tab: n - 1 };
  }
  return undefined;
}

// --- Seleksi navigasi (paritas Figma) ---

/** Ctrl+Shift+A: invers seleksi dalam lingkup `selectAllIds` (saudara board primer / board saat seleksi kosong). */
export function selectInverseIds(scene: readonly GeoNode[], ids: readonly string[]): string[] {
  const sel = new Set(ids);
  return selectAllIds(scene, ids).filter((id) => !sel.has(id));
}

/** Enter (Figma): satu kontainer terpilih (frame/board/instance dengan anak) → anak pertama; selain itu undefined. */
export function enterChildId(scene: readonly GeoNode[], ids: readonly string[]): string | undefined {
  if (ids.length !== 1) return undefined;
  const n = indexGeo(scene).get(ids[0]!);
  return n && (n.type === 'frame' || n.type === 'board' || n.component === 'instance') && n.children.length ? n.children[0]!.id : undefined;
}

/** Shift+Enter atau `\`: parent dari node primer (terpilih terakhir); board → undefined (sudah puncak). */
export function parentIdOf(scene: readonly GeoNode[], ids: readonly string[]): string | undefined {
  const index = indexGeo(scene);
  const primary = [...ids].reverse().map((id) => index.get(id)).find((n) => n !== undefined);
  return primary?.parentId;
}

/** Tab/Shift+Tab: saudara berikutnya/sebelumnya dari node primer; di ujung → undefined (tidak wrap). */
export function siblingIdOf(scene: readonly GeoNode[], ids: readonly string[], dir: 1 | -1): string | undefined {
  const index = indexGeo(scene);
  const primary = [...ids].reverse().map((id) => index.get(id)).find((n) => n !== undefined);
  if (!primary) return undefined;
  const siblings = siblingsOf(scene, index, primary);
  const at = siblings.findIndex((s) => s.id === primary.id);
  return siblings[at + dir]?.id;
}

// --- Op dari nilai tersimpan (rotate, gaya teks) ---

/** Node untuk `rotateOps`/`resizeOps`/`textStyleOps`: id + properti tersimpan yang relevan (dari `findNode`, bukan geometri). */
export type StyledNode = { id: string; name: string; type: string; rotation?: number; width?: number; height?: number; weight?: number; style?: string; decoration?: string; size?: number; lineHeight?: number; letterSpacing?: number };

/** Alt+panah (paritas Figma): resize 1px/10px — →/↓ membesar, ←/↑ mengecil; board/komposit dan non-angka (hug/fill) dilewati. */
export function resizeOps(nodes: readonly StyledNode[], dw: number, dh: number): EditPlan | undefined {
  const sizable = nodes.filter((n) => n.type !== 'board' && !n.id.includes('/'));
  const ops: DocOp[] = [];
  const changed: StyledNode[] = [];
  for (const n of sizable) {
    const patch: Record<string, unknown> = {};
    if (dw !== 0 && typeof n.width === 'number') patch.width = Math.max(1, n.width + dw);
    if (dh !== 0 && typeof n.height === 'number') patch.height = Math.max(1, n.height + dh);
    if (Object.keys(patch).length) {
      ops.push({ op: 'update', id: n.id, patch });
      changed.push(n);
    }
  }
  if (!ops.length) return undefined;
  return { ops, label: label(changed.length === 1 ? `Resize ${changed[0]!.name}` : `Resize ${changed.length} layers`) };
}

/** Ctrl/⌘+Alt+panah: `rotation += deg` pada tiap node terpilih yang bisa diputar (bukan board/alamat komposit). */
export function rotateOps(nodes: readonly StyledNode[], deg: number): EditPlan | undefined {
  const rotatable = nodes.filter((n) => n.type !== 'board' && !n.id.includes('/'));
  if (!rotatable.length) return undefined;
  return {
    ops: rotatable.map((n) => ({ op: 'update', id: n.id, patch: { rotation: (n.rotation ?? 0) + deg } })),
    label: label(rotatable.length === 1 ? `Rotate ${rotatable[0]!.name}` : `Rotate ${rotatable.length} layers`),
  };
}

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 120, 144] as const;
const nextSize = (v: number, dir: 1 | -1): number => {
  if (dir > 0) return FONT_SIZES.find((s) => s > v) ?? v + 24;
  return [...FONT_SIZES].reverse().find((s) => s < v) ?? Math.max(1, v - 1);
};

/**
 * Gaya teks Figma (Ctrl/⌘+B/I/U, Ctrl/⌘+Shift+<> size, Ctrl/⌘+Alt+<> weight, Alt+<> spacing, Alt+Shift+<> leading):
 * patch properti node teks; nilai token (bukan angka) dilewati. Toggle: bold 400↔700, italic, underline.
 */
export function textStyleOps(nodes: readonly StyledNode[], key: TextStyleKey): EditPlan | undefined {
  const texts = nodes.filter((n) => n.type === 'text' && !n.id.includes('/'));
  const ops: DocOp[] = [];
  for (const t of texts) {
    const patch: Record<string, unknown> = {};
    if (key === 'bold') patch.weight = (t.weight ?? 400) >= 700 ? 400 : 700;
    else if (key === 'italic') patch.style = t.style === 'italic' ? 'normal' : 'italic';
    else if (key === 'underline') patch.decoration = t.decoration === 'underline' ? 'none' : 'underline';
    else if (key === 'align-left') patch.align = 'left';
    else if (key === 'align-right') patch.align = 'right';
    else if (key.startsWith('size')) patch.size = typeof t.size === 'number' ? nextSize(t.size, key === 'size+' ? 1 : -1) : undefined;
    else if (key.startsWith('weight')) {
      const w = (t.weight ?? 400) + (key === 'weight+' ? 100 : -100);
      patch.weight = Math.min(900, Math.max(100, w));
    } else if (key.startsWith('spacing')) patch.letterSpacing = typeof t.letterSpacing === 'number' || t.letterSpacing === undefined ? Math.round(((t.letterSpacing ?? 0) + (key === 'spacing+' ? 0.5 : -0.5)) * 100) / 100 : undefined;
    else if (key.startsWith('leading')) patch.lineHeight = typeof t.lineHeight === 'number' ? Math.max(1, t.lineHeight + (key === 'leading+' ? 4 : -4)) : undefined;
    if (Object.values(patch).every((v) => v === undefined)) continue;
    ops.push({ op: 'update', id: t.id, patch });
  }
  if (!ops.length) return undefined;
  const title = { bold: 'Bold', italic: 'Italic', underline: 'Underline' }[key as 'bold' | 'italic' | 'underline'] ?? 'Change text style';
  return { ops, label: label(texts.length === 1 ? `${title} ${texts[0]!.name}` : `${title} ${texts.length} text layers`) };
}

/** Ctrl+A: kosong → semua board; board primer → anaknya (atau board itu bila kosong); node → semua saudaranya. */
export function selectAllIds(scene: readonly GeoNode[], ids: readonly string[]): string[] {
  const index = indexGeo(scene);
  const primary = [...ids].reverse().map((id) => index.get(id)).find((n) => n !== undefined);
  if (!primary) return scene.map((b) => b.id);
  if (primary.type === 'board') return primary.children.length ? primary.children.map((c) => c.id) : [primary.id];
  return siblingsOf(scene, index, primary).map((n) => n.id);
}

/** Commit edit teks inline: isi sama atau kosong → tanpa op (batal). */
export function textEditPlan(id: string, name: string, before: string, after: string): EditPlan | undefined {
  if (after === before || after.trim() === '') return undefined;
  return { ops: [{ op: 'update', id, patch: { content: after } }], label: label(`Edit text ${name}`) };
}

/** Normalisasi `innerText` elemen contentEditable: CRLF → LF, satu `\n` penutup sisa `<br>` dibuang. */
export function normalizeEditedText(raw: string, endsWithBreak: boolean): string {
  const t = raw.replace(/\r\n?/g, '\n');
  return endsWithBreak && t.endsWith('\n') ? t.slice(0, -1) : t;
}
