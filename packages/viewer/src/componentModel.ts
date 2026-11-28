// Model komponen viewer (epic komponen story 4, desain bagian 08 Components): master dan instance dari dokumen
// tersimpan (termasuk isi slot), kunci override per alamat (AD-12), props yang di-override per grup panel Design,
// ringkasan override, op reset, label header, dan target sisip instance. Murni: tanpa DOM dan tanpa IO; semua tulis
// tetap berupa `DocOp` untuk route ops viewer (AD-7) dengan invers dari core (AD-8).
import { expandedNodeAt, type DocOp, type LakarDocument } from '@lakar/schema';
import type { Group } from './designModel.js';
import { containsPoint, type GeoNode, type Point } from './gesture.js';

export type ComponentKind = 'master' | 'instance';
/** Tipe data drag kartu Assets → canvas (isi = id master). */
export const COMPONENT_DRAG_TYPE = 'application/x-lakar-component';
type Raw = Record<string, unknown> & { id: string; name: string; type: string };

/** Master di dokumen (urut dokumen). */
export type MasterInfo = { id: string; name: string; type: string; boardId: string; boardName: string; pageIndex: number; instances: string[] };
/** Node tersimpan: tipe, parent tersimpan (isi slot: alamat slot `I/<frameSlot>` bila master punya slot itu), board. */
export type StoredInfo = { id: string; name: string; type: string; parentId: string | undefined; boardId: string };

export type ComponentInfo = {
  kinds: ReadonlyMap<string, ComponentKind>;
  masters: readonly MasterInfo[];
  /** id master → info. */
  masterById: ReadonlyMap<string, MasterInfo>;
  /** id instance tersimpan → node instance tersimpan (componentId, overrides, …). */
  instances: ReadonlyMap<string, Raw>;
  /** Semua node tersimpan (termasuk isi slot) → info. */
  stored: ReadonlyMap<string, StoredInfo>;
};

/** Alamat komposit (`I/…`, AD-12): isi instance hasil ekspansi, bukan node tersimpan. */
export const isComposite = (address: string): boolean => address.includes('/');
/** Instance tersimpan terluar sebuah alamat (segmen pertama). */
export const instanceRootOf = (address: string): string => address.split('/')[0]!;

/**
 * Escape dengan isi instance terpilih (desain dQRib "Esc to exit instance"): setiap alamat komposit naik ke instance
 * terluarnya, node lain tetap, tanpa duplikat. Tanpa alamat komposit → undefined (Escape biasa: kosongkan seleksi).
 */
export function exitInstanceSelection(selection: readonly string[]): string[] | undefined {
  if (!selection.some(isComposite)) return undefined;
  return [...new Set(selection.map((id) => (isComposite(id) ? instanceRootOf(id) : id)))];
}

/** Telusuri dokumen tersimpan, termasuk isi slot instance. */
export function componentInfo(doc: LakarDocument): ComponentInfo {
  const kinds = new Map<string, ComponentKind>();
  const masters: MasterInfo[] = [];
  const masterById = new Map<string, MasterInfo>();
  const instances = new Map<string, Raw>();
  const stored = new Map<string, StoredInfo>();
  doc.pages.forEach((page, pageIndex) => {
    for (const board of page.children as unknown as Raw[]) {
      const walk = (n: Raw, parentId: string | undefined) => {
        stored.set(n.id, { id: n.id, name: n.name, type: n.type, parentId, boardId: board.id });
        if (n.type === 'instance') {
          kinds.set(n.id, 'instance');
          instances.set(n.id, n);
          const slots = (n.slots ?? {}) as Record<string, Raw[]>;
          for (const [name, list] of Object.entries(slots)) for (const c of list ?? []) walk(c, slotParent(n, name));
        } else if (n.component !== undefined && n.type !== 'board') {
          kinds.set(n.id, 'master');
          const m: MasterInfo = { id: n.id, name: n.name, type: n.type, boardId: board.id, boardName: board.name, pageIndex, instances: [] };
          masters.push(m);
          masterById.set(n.id, m);
        }
        for (const c of (n.children ?? []) as Raw[]) walk(c, n.id);
      };
      walk(board, undefined);
    }
  });
  // Pemetaan slot butuh master; master bisa muncul sesudah instancenya (urut dokumen), jadi dipetakan ulang di sini.
  for (const [id, s] of stored) {
    const p = s.parentId;
    if (p?.startsWith('?slot:')) {
      const [, inst, name] = p.split(':');
      const master = masterNode(doc, instances.get(inst!)?.componentId as string | undefined);
      const slot = ((master?.component as { slots?: { name: string; nodeId: string }[] } | undefined)?.slots ?? []).find((x) => x.name === name);
      stored.set(id, { ...s, parentId: slot ? `${inst}/${slot.nodeId}` : inst });
    }
  }
  for (const inst of instances.values()) masterById.get(inst.componentId as string)?.instances.push(inst.id);
  return { kinds, masters, masterById, instances, stored };
}
const slotParent = (inst: Raw, name: string) => `?slot:${inst.id}:${name}`;
function masterNode(doc: LakarDocument, id: string | undefined): Raw | undefined {
  if (!id) return undefined;
  let hit: Raw | undefined;
  const walk = (n: Raw) => {
    if (hit) return;
    if (n.id === id) hit = n;
    for (const c of (n.children ?? []) as Raw[]) walk(c);
  };
  for (const p of doc.pages) for (const b of p.children as unknown as Raw[]) walk(b);
  return hit;
}

/**
 * Node tersimpan di dalam isi slot instance (langsung atau lebih dalam): POST /inspect (route lama, AD-4) hanya
 * menelusuri children, jadi viewer melewatinya seperti alamat komposit (story 5).
 */
export function inSlotContent(info: ComponentInfo, id: string): boolean {
  for (let p = info.stored.get(id)?.parentId; p; p = info.stored.get(p)?.parentId) {
    if (isComposite(p) || info.kinds.get(p) === 'instance') return true;
  }
  return false;
}

/** Kunci override untuk alamat: akar instance = `componentId`, komposit = sisa alamat sesudah instance terluar. */
export function overrideKey(address: string, componentId: string): string {
  const i = address.indexOf('/');
  return i < 0 ? componentId : address.slice(i + 1);
}

/** Entri override (properti → nilai) instance terluar untuk alamat; undefined bila bukan instance/isi instance. */
export function overrideEntry(info: ComponentInfo, address: string): Record<string, unknown> | undefined {
  const inst = info.instances.get(instanceRootOf(address));
  if (!inst) return undefined;
  const overrides = (inst.overrides ?? {}) as Record<string, Record<string, unknown>>;
  return overrides[overrideKey(address, inst.componentId as string)] ?? {};
}

/** Node efektif instance/isi instance (ref token utuh, AD-12); undefined bila alamat tidak ada atau ekspansi gagal. */
export function effectiveNode(doc: LakarDocument, address: string): Raw | undefined {
  try {
    return expandedNodeAt(doc, address)?.node as unknown as Raw | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sumber target panel Design untuk akar instance atau isi instance (alamat komposit): `stored` = node efektif (edit
 * menjadi override di core), `overrides` = entri override instance terluar. Undefined untuk node tersimpan biasa
 * (pemanggil memakai node tersimpan) atau alamat yang tidak ada.
 */
export function componentTarget(doc: LakarDocument, info: ComponentInfo, address: string): { stored: Raw; overrides: Record<string, unknown> | undefined } | undefined {
  if (!isComposite(address) && info.kinds.get(address) !== 'instance') return undefined;
  const stored = effectiveNode(doc, address);
  return stored ? { stored, overrides: overrideEntry(info, address) } : undefined;
}

/** Properti per grup panel Design (override marker). `align` milik Auto layout (frame) dan Typography (teks). */
export const GROUP_PROPS: Readonly<Record<Group, readonly string[]>> = {
  position: ['x', 'y', 'position', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'rotation', 'gridColumn', 'gridRow'],
  autoLayout: ['layout', 'gap', 'padding', 'align', 'justify', 'gridTemplateColumns', 'gridTemplateRows', 'columnGap', 'rowGap', 'wrap', 'clip', 'scrollY'],
  typography: ['content', 'family', 'weight', 'style', 'size', 'lineHeight', 'letterSpacing', 'align', 'wrap', 'numeric', 'color'],
  icon: ['lib', 'icon', 'version', 'size', 'color', 'strokeWidth', 'filled'],
  appearance: ['radius', 'opacity', 'blend'],
  fill: ['fills', 'fillRule'],
  stroke: ['stroke', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'strokeMiterlimit', 'svg'],
  effects: ['blur', 'backdropBlur', 'shadows'],
};

/** Target yang membawa entri override (DesignTarget instance/komposit). */
export type OverrideTarget = { id: string; overrides?: Readonly<Record<string, unknown>> | undefined };

/** Properti grup yang di-override pada salah satu target (urut GROUP_PROPS). */
export function groupOverrides(targets: readonly OverrideTarget[], group: Group): string[] {
  const keys = GROUP_PROPS[group];
  return keys.filter((k) => targets.some((t) => t.overrides !== undefined && Object.hasOwn(t.overrides, k)));
}

/** Reset grup: satu `resetOverride(alamat, props)` per target yang punya override di grup itu. */
export function resetGroupOps(targets: readonly OverrideTarget[], group: Group): DocOp[] {
  const keys = GROUP_PROPS[group];
  return targets.flatMap((t) => {
    const props = keys.filter((k) => t.overrides !== undefined && Object.hasOwn(t.overrides, k));
    return props.length ? [{ op: 'resetOverride', id: t.id, props } satisfies DocOp] : [];
  });
}

/** Label marker: "Text overridden" bila satu-satunya properti `content`, selain itu "Overridden". */
export const markerLabel = (props: readonly string[]): string => (props.length === 1 && props[0] === 'content' ? 'Text overridden' : 'Overridden');

const PROP_LABEL: Record<string, string> = { fills: 'fill', content: 'text', shadows: 'shadow', backdropBlur: 'backdrop blur', lineHeight: 'line height', letterSpacing: 'letter spacing', family: 'font', weight: 'weight' };
const propLabel = (p: string) => PROP_LABEL[p] ?? p.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Ringkasan override instance (desain "2 overrides · Fill, Title text"): jumlah pasangan kunci×properti; akar →
 * "Fill", node lain → "<nama node> <properti>". `nameOf(kunci)` = nama node master pada kunci (undefined = yatim).
 */
export function overrideSummary(instance: Raw, nameOf: (key: string) => string | undefined): { count: number; text: string } {
  const overrides = (instance.overrides ?? {}) as Record<string, Record<string, unknown>>;
  const parts: string[] = [];
  let count = 0;
  for (const [key, entry] of Object.entries(overrides)) {
    for (const p of Object.keys(entry ?? {})) {
      count++;
      if (key === instance.componentId) parts.push(cap(propLabel(p)));
      else parts.push(`${nameOf(key) ?? 'Missing layer'} ${propLabel(p)}`);
    }
  }
  const text = count === 0 ? 'No overrides' : `${count} override${count === 1 ? '' : 's'} · ${parts.join(', ')}`;
  return { count, text };
}

/** Reset all: buang seluruh peta override instance (invers core memulihkannya utuh). */
export const resetAllOps = (instanceId: string): DocOp[] => [{ op: 'update', id: instanceId, patch: { overrides: null } }];

/** `N instance(s)` untuk meta Assets dan header master. */
export const instancesText = (n: number): string => `${n} instance${n === 1 ? '' : 's'}`;

/** Node instance baru untuk op `add`. */
export function instanceNode(master: { id: string; name: string }, at?: Point): Record<string, unknown> {
  return { type: 'instance', name: master.name, componentId: master.id, ...(at ? { position: 'absolute', x: Math.round(at.x) + 0, y: Math.round(at.y) + 0 } : {}) };
}

export type InsertTargetResult = { parentId: string; at?: Point } | { error: string };

/** Kontainer `parentId` sama dengan master atau turunan tersimpannya (siklus komponen). */
function insideMaster(info: ComponentInfo, parentId: string, masterId: string): boolean {
  for (let p: string | undefined = parentId; p; ) {
    const id: string = isComposite(p) ? instanceRootOf(p) : p;
    if (id === masterId) return true;
    p = info.stored.get(id)?.parentId;
  }
  return false;
}
const CYCLE = "A component can't contain an instance of itself";

/**
 * Target tombol `+` Assets: board/frame tersimpan primer → node itu; node lain → parent tersimpannya; alamat komposit
 * → parent instance terluar; tanpa seleksi → board pertama halaman (`firstBoard`).
 */
export function instanceTarget(info: ComponentInfo, masterId: string, primary: string | undefined, firstBoard: string | undefined): InsertTargetResult {
  let parentId: string | undefined;
  if (primary) {
    const id = isComposite(primary) ? instanceRootOf(primary) : primary;
    const s = info.stored.get(id);
    if (s) parentId = !isComposite(primary) && (s.type === 'board' || s.type === 'frame') ? s.id : s.parentId;
  }
  // Seleksi = master itu sendiri atau isinya (mis. sesudah klik kartu Assets): sisip di samping master, bukan di dalamnya.
  if (parentId && insideMaster(info, parentId, masterId)) parentId = info.stored.get(masterId)?.parentId;
  parentId ??= firstBoard;
  if (!parentId) return { error: 'Add a board first, then insert the component' };
  if (insideMaster(info, parentId, masterId)) return { error: CYCLE };
  return { parentId };
}

/**
 * Target drop kartu Assets di titik halaman `p`: kontainer tersimpan (board/frame, bukan instance/isi instance)
 * terdalam di bawah kursor. Parent frame `none` → posisi absolut relatif kotak parent.
 */
export function dropTarget(info: ComponentInfo, masterId: string, scene: readonly GeoNode[], p: Point): InsertTargetResult {
  let found: GeoNode | undefined;
  let list: readonly GeoNode[] = scene;
  for (;;) {
    let hit: GeoNode | undefined;
    for (let i = list.length - 1; i >= 0; i--) if (containsPoint(list[i]!.box, p)) {
      hit = list[i];
      break;
    }
    if (!hit || isComposite(hit.id) || hit.component === 'instance') break;
    if (hit.type === 'board' || hit.type === 'frame') found = hit;
    list = hit.children;
  }
  if (!found) return { error: 'Drop the component onto a board' };
  if (insideMaster(info, found.id, masterId)) return { error: CYCLE };
  if (found.type === 'frame' && (found.layout === 'none' || found.layout === undefined)) return { parentId: found.id, at: { x: p.x - found.box.x, y: p.y - found.box.y } };
  return { parentId: found.id };
}
