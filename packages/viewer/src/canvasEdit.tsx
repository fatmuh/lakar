/// <reference lib="dom" />
// Gestur editor di canvas live (editor-canvas story 4, desain bagian 05 "Editor"): klik/Shift/Ctrl/dobel-klik memilih
// node lewat hit-test geometri DOM live (`[data-lakar-id]` di shadow root), marquee, geser node absolute/board,
// urutkan ulang anak flow (termasuk pindah ke kontainer flow lain), dan resize 8 handle. Selama gestur hanya
// pratinjau lokal (gaya DOM sementara + overlay); satu `onCommit(ops)` di akhir gestur (AD-7). Escape membatalkan.
// Sesudah commit pratinjau ditahan sampai board tersentuh di-mount ulang dari rev baru (tanpa lompat balik).
// Hanya mouse/pen: pointer sentuh tidak masuk ke sini (Canvas mempertahankan pan/pinch/tap lama).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { findBoard } from '@lakar/render';
import type { DocOp, ResolvedDocument } from '@lakar/schema';
import {
  boxFrom,
  committedBox,
  dropContainer,
  HANDLES,
  hitPath,
  indexGeo,
  marqueeSelect,
  moveOps,
  pickTarget,
  posBadge,
  reorderHint,
  reorderTarget,
  resizeBox,
  resizeOp,
  scaleBox,
  sizeBadge,
  toggleSelection,
  unionBox,
  type Box,
  type GeoNode,
  type Handle,
  type Point,
  type ReorderTarget,
} from './gesture';
import { normalizeEditedText, textEditPlan } from './editActions';
import { measure, SNAP_TOLERANCE_PX, snapCandidates, snapMove, snapResize, type Guide, type Measure, type Snap } from './snap';
import { heldStatus, rebaseNodes, rebaseReorderNode, rebaseResize } from './liveChanges';
import { Icon } from './icons';
import { liveElement, measureBoard, pageGeometry } from './liveGeometry';
import { CLICK_SLOP } from './sheet';
import { instanceRootOf, isComposite, type ComponentInfo } from './componentModel';
import type { Camera } from './viewState';

export type EditBoard = { id: string; name: string; x: number; y: number; width: number; height: number };

/** Pengubah gaya sementara: nilai asli tiap properti disimpan sekali, `restore` mengembalikan semuanya. */
function styleSaver() {
  const saved = new Map<HTMLElement, Map<string, string>>();
  return {
    set(el: HTMLElement, prop: string, value: string) {
      let m = saved.get(el);
      if (!m) saved.set(el, (m = new Map()));
      if (!m.has(prop)) m.set(prop, el.style.getPropertyValue(prop));
      el.style.setProperty(prop, value);
    },
    restore() {
      for (const [el, m] of saved) for (const [p, v] of m) (v ? el.style.setProperty(p, v) : el.style.removeProperty(p));
      saved.clear();
    },
  };
}
type Saver = ReturnType<typeof styleSaver>;

/** `mounts` = hitungan mount board tersentuh saat gestur mulai (mount ulang di tengah gestur → rebase, story 3). */
type Base = { pointer: number; c0: Point; p0: Point; moved: boolean; mounts?: Record<string, number> };
type Gesture =
  | (Base & { kind: 'press'; picked: GeoNode; ids: string[]; collapse: string | undefined })
  | (Base & { kind: 'marquee'; p: Point; picked: GeoNode | undefined; candidates: GeoNode[]; base: string[]; shift: boolean })
  | (Base & { kind: 'move'; d: Point; nodes: GeoNode[]; saver: Saver; snap?: Snap })
  | (Base & { kind: 'reorder'; p: Point; node: GeoNode; container: GeoNode | undefined; target: ReorderTarget | undefined; saver: Saver; ghost: HTMLElement | undefined })
  | (Base & { kind: 'resize'; handle: Handle; members: GeoNode[]; from: Box; to: Box; saver: Saver; p?: Point; snap?: Snap });

/**
 * Pratinjau yang ditahan sesudah commit (agen-di-canvas story 3): berlaku sampai setiap board tersentuh di-mount dari
 * dokumen ber-rev ≥ `rev` commit (`heldStatus`). Mount ulang dari rev lebih lama (commit agen tiba duluan) →
 * `apply` menerapkan ulang pratinjau ke DOM baru lewat `extra` (hanya elemen di shadow root, bukan host).
 */
type Held = { key: number; mounts: Record<string, number>; boxes: Map<string, Box>; saver: Saver; rev?: number; apply: (s: Saver) => void; extra?: Saver };
let heldSeq = 0;

/** Jarak waktu maksimal dua tekan sebagai dobel-klik. */
const DOUBLE_MS = 400;

const HANDLE_CURSOR: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

export function useCanvasEdit({
  section,
  cam,
  boards,
  doc,
  active,
  hoverable,
  canEdit,
  selection,
  onSelectIds,
  onCommit,
  components,
  pastedTag,
  onEnterPath,
  pathEditing,
  measuring,
}: {
  /** Info komponen dokumen tersimpan terkini (epic komponen story 4): penanda master/instance, tag, breadcrumb. */
  components?: ComponentInfo | undefined;
  /** Label "Pasted · nama" di bawah node hasil paste HTML (desain rkIyP Pasted Tag), selama node itu terpilih. */
  pastedTag?: { id: string; label: string } | undefined;
  /** Dobel-klik path → mode edit titik (story vektor 5); false = tidak bisa (mis. berotasi), klik biasa berlaku. */
  onEnterPath?: ((id: string) => boolean) | undefined;
  /** Mode edit titik atau pen berjalan: kotak seleksi, handle, dan hover tidak digambar (overlay milik pathTools). */
  pathEditing?: boolean | undefined;
  /** Alt ditahan (desain bagian 11 "Measure distance"): hover node lain menggambar pengukur jarak ke seleksi. */
  measuring?: boolean | undefined;
  section: RefObject<HTMLElement | null>;
  cam: Camera;
  boards: readonly EditBoard[];
  /** Dokumen ter-resolve terkini (mode live); undefined = jalur PNG, gestur nonaktif. */
  doc: ResolvedDocument | undefined;
  /** Seleksi/hover lewat geometri live aktif (live, bukan pratinjau versi). */
  active: boolean;
  /** Outline hover tampil (tool Select tanpa Space). */
  hoverable: boolean;
  /** Gestur edit (geser/reorder/resize) boleh (editable, tool Select). */
  canEdit: boolean;
  selection: readonly string[];
  onSelectIds: (ids: string[]) => void;
  /** Commit satu gestur lewat route ops: rev commit baru, atau undefined bila gagal. */
  onCommit: ((ops: DocOp[], description: string) => Promise<number | undefined>) | undefined;
}) {
  const hosts = useRef(new Map<string, HTMLDivElement>());
  const [mounts, setMounts] = useState<Record<string, number>>({});
  const mountsRef = useRef(mounts);
  mountsRef.current = mounts;
  /** Rev dokumen yang terakhir di-mount per board (pelepasan pratinjau tertahan). */
  const mountRevs = useRef<Record<string, number>>({});
  const onMounted = useCallback((id: string, host: HTMLDivElement, rev?: number) => {
    hosts.current.set(id, host);
    if (rev !== undefined) mountRevs.current = { ...mountRevs.current, [id]: rev };
    setMounts((m) => ({ ...m, [id]: (m[id] ?? 0) + 1 }));
  }, []);
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  const gRef = useRef<Gesture | null>(null);
  const setGesture = (g: Gesture | null) => {
    gRef.current = g;
    setGestureState(g);
  };
  const [held, setHeldState] = useState<Held | null>(null);
  const heldRef = useRef<Held | null>(null);
  const setHeld = useCallback((h: Held | null) => {
    heldRef.current = h;
    setHeldState(h);
  }, []);
  const [hover, setHover] = useState<string | undefined>(undefined);
  const lastDown = useRef<{ t: number; x: number; y: number } | undefined>(undefined);
  /** `startTextEdit` render terakhir (dipanggil tertunda dari dobel-klik). */
  const startTextRef = useRef<(id: string) => boolean>(() => false);

  // Geometri per board di-cache per mount + posisi/ukuran board (pan/zoom tidak mengukur ulang).
  const cache = useRef(new Map<string, { key: string; kinds: string; geo: GeoNode | undefined }>());
  const kinds = components?.kinds;
  // Tanda tangan isi (bukan identitas peta): `componentInfo` dibuat ulang tiap dokumen termuat, padahal penanda
  // master/instance jarang berubah; tanpa ini setiap rev mengukur ulang semua board.
  const kindsKey = useMemo(() => (kinds ? [...kinds].map(([id, k]) => `${id}:${k}`).join(',') : ''), [kinds]);
  const geometry = (): GeoNode[] => {
    if (!active || !doc) return [];
    // Board belum ter-mount: stub tanpa anak (pageGeometry), aksi board tetap tahu posisinya.
    return pageGeometry(boards, (id) => {
      const b = boards.find((x) => x.id === id)!;
      const n = mounts[b.id] ?? 0;
      const key = `${n}:${b.x}:${b.y}:${b.width}:${b.height}`;
      let c = cache.current.get(b.id);
      // Penanda master/instance ikut dokumen tersimpan (bisa berubah tanpa mount ulang): diukur ulang bila berganti.
      if (!c || c.key !== key || c.kinds !== kindsKey) {
        const host = hosts.current.get(b.id);
        const rb = findBoard(doc, b.id);
        c = { key, kinds: kindsKey, geo: host && rb && n > 0 ? measureBoard(host, rb, { x: b.x, y: b.y }, kinds) : undefined };
        cache.current.set(b.id, c);
      }
      return c.geo;
    });
  };
  const geo = geometry();
  const index = indexGeo(geo);
  const boardOf = (id: string): string | undefined => {
    let n = index.get(id);
    while (n?.parentId) n = index.get(n.parentId);
    return n?.id;
  };

  const toPage = (clientX: number, clientY: number): Point => {
    const r = section.current?.getBoundingClientRect();
    return { x: (clientX - (r?.left ?? 0) - cam.x) / cam.z, y: (clientY - (r?.top ?? 0) - cam.y) / cam.z };
  };

  const endGhost = (g: Gesture | null) => {
    if (g?.kind === 'reorder') g.ghost?.remove();
  };
  /** Batalkan gestur: pratinjau dipulihkan, tanpa request. */
  const cancel = useCallback(() => {
    const g = gRef.current;
    if (!g) return false;
    if (g.kind === 'move' || g.kind === 'reorder' || g.kind === 'resize') g.saver.restore();
    endGhost(g);
    setGesture(null);
    return true;
  }, []);

  // Board yang sedang digestur di-mount ulang (agen menulis, story 3): gestur di-rebase ke geometri baru (node dicari
  // ulang per id, pratinjau diterapkan ulang), bukan dibatalkan; op dihitung saat dilepas dari nilai terbaru (AD-7).
  // Pratinjau tertahan dilepas begitu board tersentuh di-mount dari rev commit; mount lebih lama → diterapkan ulang.
  // Board yang sudah tidak ada di halaman (dihapus) dianggap selesai.
  useEffect(() => {
    const g = gRef.current;
    if (g?.mounts && Object.entries(g.mounts).some(([b, n]) => (mounts[b] ?? 0) !== n)) rebase(g);
    const h = heldRef.current;
    if (!h) return;
    const status = heldStatus(h, mounts, mountRevs.current, new Set(boards.map((b) => b.id)));
    if (status === 'release') {
      h.extra?.restore();
      setHeld(null);
    } else if (status === 'reapply') {
      h.extra?.restore();
      const extra = styleSaver();
      h.apply(extra);
      setHeld({ ...h, extra, mounts: Object.fromEntries(Object.keys(h.mounts).map((b) => [b, mounts[b] ?? 0])) });
    }
  }, [mounts, boards, held]);
  useEffect(() => () => void cancel(), [cancel]);

  const mountsOf = (ids: readonly string[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const id of ids) {
      const b = boardOf(id);
      if (b) out[b] = mountsRef.current[b] ?? 0;
    }
    return out;
  };

  /**
   * Commit satu gestur; pratinjau ditahan sampai board tersentuh di-mount dari rev commit (`apply` menerapkannya ulang
   * bila mount lebih lama tiba lebih dulu), dipulihkan bila gagal.
   */
  const commit = (ops: DocOp[], description: string, ids: readonly string[], boxes: Map<string, Box>, saver: Saver, apply: (s: Saver) => void) => {
    if (!ops.length || !onCommit) {
      saver.restore();
      return;
    }
    // Hanya board yang benar-benar diubah op (anggota tanpa op tidak memicu mount ulang).
    const opIds = new Set(ops.flatMap((o) => ('id' in o ? [o.id] : [])));
    const key = ++heldSeq;
    setHeld({ key, mounts: mountsOf(ids.filter((id) => opIds.has(id))), boxes, saver, apply });
    void onCommit(ops, description).then((rev) => {
      const cur = heldRef.current;
      if (rev !== undefined) {
        if (cur?.key === key) setHeld({ ...cur, rev });
        return;
      }
      saver.restore();
      if (cur?.key === key) {
        cur.extra?.restore();
        setHeld(null);
      }
    });
  };

  /** Gestur berjalan sesudah board-nya di-mount ulang: rebase ke geometri baru; tidak ada yang tersisa → batal. */
  const rebase = (g: Gesture) => {
    switch (g.kind) {
      case 'move': {
        const nodes = rebaseNodes(g.nodes, index, (n) => n.absolute);
        if (!nodes.length) break;
        g.saver.restore();
        const next = { ...g, nodes, saver: styleSaver(), mounts: mountsOf(nodes.map((n) => n.id)) };
        previewMove(next.nodes, next.d, next.saver);
        setGesture(next);
        return;
      }
      case 'resize': {
        const r = rebaseResize(g.members, index, g.handle, g.moved && g.p ? { x: g.p.x - g.p0.x, y: g.p.y - g.p0.y } : undefined);
        if (!r) break;
        g.saver.restore();
        const next = { ...g, ...r, saver: styleSaver(), mounts: mountsOf(r.members.map((n) => n.id)) };
        if (next.moved) previewResize(next, next.to, next.saver, true);
        setGesture(next);
        return;
      }
      case 'reorder': {
        const node = rebaseReorderNode(g.node, index);
        if (!node) break;
        g.saver.restore();
        const saver = styleSaver();
        dimNode(node.id, saver);
        setGesture(updateReorder({ ...g, node, saver, mounts: mountsOf([node.id]) }, g.p));
        return;
      }
      default:
        break;
    }
    cancel();
  };
  /** Redupkan elemen asli node yang di-reorder (pratinjau). */
  const dimNode = (id: string, saver: Saver) => {
    const host = hostOf(id);
    const el = host && liveElement(host, id);
    if (el) saver.set(el, 'opacity', '0.35');
  };

  const hostOf = (id: string) => {
    const b = boardOf(id);
    return b ? hosts.current.get(b) : undefined;
  };
  /** Anggota tanpa leluhur yang juga anggota (leluhur yang digeser membawa turunannya). */
  const topMost = (ids: readonly string[]): GeoNode[] => {
    const set = new Set(ids);
    return ids.flatMap((id) => {
      const n = index.get(id);
      if (!n) return [];
      for (let p = n.parentId; p; p = index.get(p)?.parentId) if (set.has(p)) return [];
      return [n];
    });
  };

  const startDrag = (g: Gesture & { kind: 'press' }, p: Point) => {
    const nodes = topMost(g.ids);
    const base = { pointer: g.pointer, c0: g.c0, p0: g.p0, moved: true };
    const single = nodes.length === 1 ? nodes[0]! : undefined;
    if (single && !single.absolute && single.parentId) {
      // Isi instance (alamat komposit, AD-12) tidak bisa dipindah urutannya: hanya di-update (override).
      if (isComposite(single.id)) {
        setGesture(null);
        return;
      }
      // Reorder di dalam grid belum didukung (ditunda): jangan sampai drop memindahkan anak grid ke leluhur flex.
      if (index.get(single.parentId)?.layout === 'grid') {
        setGesture(null);
        return;
      }
      const saver = styleSaver();
      const el = hostOf(single.id) && liveElement(hostOf(single.id)!, single.id);
      let ghost: HTMLElement | undefined;
      if (el && section.current) {
        ghost = dragGhost(el, single.box);
        section.current.appendChild(ghost);
        dimNode(single.id, saver);
      }
      setGesture(updateReorder({ ...base, kind: 'reorder', p, node: single, container: undefined, target: undefined, saver, ghost, mounts: mountsOf([single.id]) }, p));
      return;
    }
    const movable = nodes.filter((n) => n.absolute);
    if (!movable.length) {
      setGesture(null);
      return;
    }
    setGesture({ ...base, kind: 'move', d: { x: 0, y: 0 }, nodes: movable, saver: styleSaver(), mounts: mountsOf(movable.map((n) => n.id)) });
  };

  const updateReorder = (g: Gesture & { kind: 'reorder' }, p: Point): Gesture => {
    const path = hitPath(geo, p);
    const parent = g.node.parentId ? index.get(g.node.parentId) : undefined;
    const container = dropContainer(path, g.node.id) ?? (parent && (parent.layout === 'row' || parent.layout === 'column') ? parent : undefined);
    const target = container ? reorderTarget(container, g.node, p) : undefined;
    if (g.ghost) placeGhost(g.ghost, g.node.box, { x: p.x - g.p0.x, y: p.y - g.p0.y }, cam);
    return { ...g, p, container, target };
  };

  /** Pratinjau geser: elemen node absolute digeser lewat left/top (satuan board), board lewat kotak override. */
  const previewMove = (nodes: readonly GeoNode[], d: Point, saver: Saver) => {
    for (const n of nodes) {
      if (n.type === 'board') continue;
      const host = hostOf(n.id);
      const el = host && liveElement(host, n.id);
      if (!el) continue;
      saver.set(el, 'left', `${n.x + d.x}px`);
      saver.set(el, 'top', `${n.y + d.y}px`);
    }
  };
  /** `withHost` false: hanya elemen di shadow root (penerapan ulang pratinjau tertahan; host milik React). */
  const previewResize = (g: { members: readonly GeoNode[]; from: Box }, to: Box, s: Saver, withHost: boolean) => {
    for (const n of g.members) {
      const b = memberBox(g, n, to);
      const host = hostOf(n.id);
      const el = host && liveElement(host, n.id);
      if (!el) continue;
      s.set(el, 'width', `${b.w}px`);
      s.set(el, 'height', `${b.h}px`);
      if (n.type !== 'board') {
        s.set(el, 'flex', '0 0 auto');
        if (n.absolute) {
          s.set(el, 'left', `${n.x + b.x - n.box.x}px`);
          s.set(el, 'top', `${n.y + b.y - n.box.y}px`);
          s.set(el, 'right', 'auto');
          s.set(el, 'bottom', 'auto');
        }
      } else if (host && withHost) {
        s.set(host, 'width', `${b.w}px`);
        s.set(host, 'height', `${b.h}px`);
      }
    }
  };

  /** Kotak pratinjau per node selama gestur (koordinat halaman). */
  const previewBoxes = new Map<string, Box>();
  if (gesture?.kind === 'move') for (const n of gesture.nodes) previewBoxes.set(n.id, { ...n.box, x: n.box.x + gesture.d.x, y: n.box.y + gesture.d.y });
  if (gesture?.kind === 'resize') for (const n of gesture.members) previewBoxes.set(n.id, memberBox(gesture, n, gesture.to));
  const boxOf = (id: string): Box | undefined => previewBoxes.get(id) ?? held?.boxes.get(id) ?? index.get(id)?.box;
  /** Kotak board yang sedang digeser/di-resize (atau tertahan sesudah commit). */
  const boardBox = (id: string): Box | undefined => previewBoxes.get(id) ?? held?.boxes.get(id);

  /** Kandidat marquee dari geometri terkini (board bisa di-mount ulang oleh agen selama marquee): overlay = hasil lepas. */
  const marqueeCandidates = (g: { picked: GeoNode | undefined }): GeoNode[] => (g.picked ? (index.get(g.picked.id)?.children ?? []) : geo);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): boolean => {
    if (!active) return false;
    const target = e.target as HTMLElement;
    const p = toPage(e.clientX, e.clientY);
    const c0 = { x: e.clientX, y: e.clientY };
    const base = { pointer: e.pointerId, c0, p0: p, moved: false };
    const sel = selection.filter((id) => index.has(id));
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as Handle | undefined;
    if (handle && canEdit && sel.length) {
      const members = topMost(sel);
      const from = unionBox(members.map((n) => n.box));
      if (from) {
        setGesture({ ...base, kind: 'resize', handle, members, from, to: from, saver: styleSaver(), mounts: mountsOf(members.map((n) => n.id)) });
        return true;
      }
    }
    const labelId = target.closest<HTMLElement>('[data-board-label]')?.dataset.boardLabel;
    const selSet = new Set(selection);
    const scope = new Set(selection.flatMap((id) => index.get(id)?.parentId ?? []));
    // Dobel-klik dideteksi sendiri (detail pointerdown selalu 0 di Chromium): dua tekan ≤ 400ms dan ≤ 4px.
    const last = lastDown.current;
    const double = last !== undefined && e.timeStamp - last.t <= DOUBLE_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= 4;
    lastDown.current = double ? undefined : { t: e.timeStamp, x: e.clientX, y: e.clientY };
    const mode = e.ctrlKey || e.metaKey ? 'deep' : double ? 'enter' : 'scope';
    const picked = labelId ? index.get(labelId) : pickTarget(hitPath(geo, p), selSet, scope, mode);
    setHover(undefined);
    // Dobel-klik teks → edit inline. Dimulai sesudah event mouse bawaan (fokus mousedown tidak langsung mem-blur-nya).
    if (double && !labelId && picked?.type === 'text' && canEdit) {
      e.preventDefault();
      const id = picked.id;
      onSelectIds([id]);
      setTimeout(() => startTextRef.current(id), 0);
      return true;
    }
    // Dobel-klik path → mode edit titik (desain J7AmQi); path terpilih tunggal.
    if (double && !labelId && picked?.type === 'path' && canEdit && onEnterPath) {
      const id = picked.id;
      onSelectIds([id]);
      if (onEnterPath(id)) {
        e.preventDefault();
        return true;
      }
    }
    if (!picked || (picked.type === 'board' && !selSet.has(picked.id) && !labelId)) {
      setGesture({ ...base, kind: 'marquee', p, picked, candidates: picked ? picked.children : geo, base: e.shiftKey ? [...selection] : [], shift: e.shiftKey });
      return true;
    }
    let ids: string[];
    let collapse: string | undefined;
    if (e.shiftKey) {
      ids = toggleSelection(selection, picked.id);
      onSelectIds(ids);
      if (!ids.includes(picked.id)) ids = [];
    } else if (!selSet.has(picked.id)) {
      ids = [picked.id];
      onSelectIds(ids);
    } else {
      ids = [...selection];
      if (selection.length > 1) collapse = picked.id;
    }
    setGesture({ ...base, kind: 'press', picked, ids, collapse });
    return true;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>): boolean => {
    const g = gRef.current;
    if (!g) {
      // Hover (desain "Hover Outline"): target klik di bawah kursor.
      if (active && hoverable && e.pointerType !== 'touch' && e.buttons === 0) {
        const p = toPage(e.clientX, e.clientY);
        const scope = new Set(selection.flatMap((id) => index.get(id)?.parentId ?? []));
        const t = (e.target as HTMLElement).closest('.canvas-overlay-ui, [data-handle]') ? undefined : pickTarget(hitPath(geo, p), new Set(selection), scope, e.ctrlKey || e.metaKey ? 'deep' : 'scope');
        const id = t && !selection.includes(t.id) ? t.id : undefined;
        if (id !== hover) setHover(id);
      }
      return false;
    }
    // Pointer lain (mis. jari kedua) bukan milik gestur ini: diteruskan ke Canvas.
    if (g.pointer !== e.pointerId) return false;
    const p = toPage(e.clientX, e.clientY);
    const moved = g.moved || Math.hypot(e.clientX - g.c0.x, e.clientY - g.c0.y) > CLICK_SLOP;
    if (!moved) return true;
    switch (g.kind) {
      case 'press':
        if (canEdit && g.ids.includes(g.picked.id)) startDrag(g, p);
        else setGesture({ ...g, moved: true });
        break;
      case 'marquee':
        setGesture({ ...g, moved: true, p });
        break;
      case 'move': {
        let d = { x: p.x - g.p0.x, y: p.y - g.p0.y };
        // Snapping (desain bagian 11): union box node pada posisi kandidat menempel ke saudara/parent/board.
        const moved = unionBox(g.nodes.map((n) => ({ ...n.box, x: n.box.x + d.x, y: n.box.y + d.y })));
        let snap: Snap | undefined;
        if (moved) {
          snap = snapMove(moved, snapCandidates(g.nodes, index), SNAP_TOLERANCE_PX / cam.z);
          d = { x: d.x + snap.dx, y: d.y + snap.dy };
        }
        previewMove(g.nodes, d, g.saver);
        setGesture({ ...g, d, snap });
        break;
      }
      case 'reorder':
        setGesture(updateReorder(g, p));
        break;
      case 'resize': {
        const raw = resizeBox(g.from, g.handle, p.x - g.p0.x, p.y - g.p0.y);
        // Snap hanya pada tepi yang digerakkan handle (SNAP_RESIZE); dx/dy menyesuaikan tepi itu.
        const snap = snapResize(raw, g.handle, snapCandidates(g.members, index), SNAP_TOLERANCE_PX / cam.z);
        const to = applyResizeSnap(raw, g.handle, snap);
        previewResize(g, to, g.saver, true);
        setGesture({ ...g, moved: true, to, p, snap });
        break;
      }
    }
    return true;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>): boolean => {
    const g = gRef.current;
    if (!g) return false;
    if (g.pointer !== e.pointerId) return false;
    setGesture(null);
    endGhost(g);
    switch (g.kind) {
      case 'press':
        if (!g.moved && g.collapse) onSelectIds([g.collapse]);
        break;
      case 'marquee': {
        if (!g.moved) {
          // Klik tanpa gerak: latar board → pilih board (Shift: tambah/kurangi); area kosong → kosongkan.
          if (g.picked) onSelectIds(g.shift ? toggleSelection(selection, g.picked.id) : [g.picked.id]);
          else if (!g.shift) onSelectIds([]);
          break;
        }
        const hits = marqueeSelect(marqueeCandidates(g), boxFrom(g.p0, g.p));
        onSelectIds([...g.base, ...hits.filter((id) => !g.base.includes(id))]);
        break;
      }
      case 'move': {
        const ops = moveOps(g.nodes, g.d.x, g.d.y);
        const boxes = new Map(g.nodes.map((n) => [n.id, { ...n.box, x: n.box.x + g.d.x, y: n.box.y + g.d.y }] as const));
        commit(ops, g.nodes.length === 1 ? `Move ${g.nodes[0]!.name}` : `Move ${g.nodes.length} layers`, g.nodes.map((n) => n.id), boxes, g.saver, (s) => previewMove(g.nodes, g.d, s));
        break;
      }
      case 'reorder': {
        const t = g.target;
        if (!t || t.noop) {
          g.saver.restore();
          break;
        }
        // Asli tetap redup sampai board di-mount ulang dengan urutan baru (tanpa lompat balik); gagal → dipulihkan.
        commit([{ op: 'move', id: g.node.id, parentId: t.containerId, index: t.index }], `Reorder ${g.node.name}`, [g.node.id], new Map(), g.saver, (s) => dimNode(g.node.id, s));
        break;
      }
      case 'resize': {
        if (!g.moved) {
          g.saver.restore();
          break;
        }
        const boxes = new Map<string, Box>();
        const ops: DocOp[] = [];
        for (const n of g.members) {
          const b = memberBox(g, n, g.to);
          boxes.set(n.id, b);
          const op = resizeOp(n, n.box, b);
          if (op) ops.push(op);
        }
        commit(ops, g.members.length === 1 ? `Resize ${g.members[0]!.name}` : `Resize ${g.members.length} layers`, g.members.map((n) => n.id), boxes, g.saver, (s) => previewResize(g, g.to, s, false));
        break;
      }
    }
    return true;
  };
  const onPointerCancel = (e: ReactPointerEvent<HTMLElement>): boolean => {
    const g = gRef.current;
    if (!g || g.pointer !== e.pointerId) return false;
    cancel();
    return true;
  };
  const onPointerLeave = () => setHover(undefined);

  // ---- Menu konteks (story 6) ----
  /**
   * Klik kanan di (clientX, clientY): target dipilih seperti klik biasa (scope seleksi); node yang sudah terpilih
   * mempertahankan seleksi banyak. Mengembalikan seleksi untuk menu (kosong = tanpa menu).
   */
  const contextSelect = (clientX: number, clientY: number): string[] => {
    if (!active) return [...selection];
    cancel();
    const p = toPage(clientX, clientY);
    const scope = new Set(selection.flatMap((id) => index.get(id)?.parentId ?? []));
    const picked = pickTarget(hitPath(geo, p), new Set(selection), scope, 'scope');
    if (!picked) {
      if (selection.length) onSelectIds([]);
      return [];
    }
    if (selection.includes(picked.id)) return [...selection];
    onSelectIds([picked.id]);
    return [picked.id];
  };

  // ---- Edit teks inline (story 6, desain "Text editing" UHOWY) ----
  // Elemen teks live di shadow root dijadikan contentEditable: tata letak, wrap, dan font persis sama dengan canvas.
  // Enter/blur = commit satu op `update {content}`; Shift+Enter = baris baru; Escape = batal (isi asli dipulihkan).
  const textRef = useRef<{ id: string; name: string; board: string; mount: number; el: HTMLElement; host: HTMLElement; original: string; saver: Saver; style: HTMLStyleElement; abort: AbortController; latest: { text: string; br: boolean } } | null>(null);
  const [textId, setTextId] = useState<string | undefined>(undefined);
  const [, setTextTick] = useState(0);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const finishText = useCallback((commitIt: boolean) => {
    const t = textRef.current;
    if (!t) return;
    textRef.current = null;
    setTextId(undefined);
    t.abort.abort();
    // Elemen sudah terlepas (board di-mount ulang oleh agen): pakai isi terakhir yang diketik (dicatat tiap input).
    const src = t.el.isConnected ? { text: t.el.innerText, br: t.el.lastChild?.nodeName === 'BR' } : t.latest;
    const after = normalizeEditedText(src.text, src.br);
    t.el.removeAttribute('contenteditable');
    t.el.removeAttribute('data-lakar-editing');
    t.saver.restore();
    t.style.remove();
    if (t.el.isConnected) t.el.ownerDocument.getSelection()?.removeAllRanges();
    // Board di-mount ulang selama edit (agen menulis, story 3): teks yang sudah diketik di-commit di atas rev terbaru
    // (AD-7), tidak dibuang; edit inline selesai karena elemennya sudah diganti.
    const plan = commitIt ? textEditPlan(t.id, t.name, t.original, after) : undefined;
    const commitFn = onCommitRef.current;
    if (!plan || !commitFn) {
      t.el.textContent = t.original;
      return;
    }
    t.el.textContent = after;
    void commitFn(plan.ops, plan.label).then((rev) => {
      if (rev === undefined && t.el.isConnected) t.el.textContent = t.original;
    });
  }, []);
  useEffect(() => {
    const t = textRef.current;
    if (t && (mounts[t.board] ?? 0) !== t.mount) finishText(true);
  }, [mounts, finishText]);
  useEffect(() => () => finishText(false), [finishText]);

  /** Mulai edit teks `id` (teks live di halaman ini); false = tidak bisa (bukan teks, belum ter-mount, tidak editable). */
  const startTextEdit = (id: string): boolean => {
    if (!canEdit || textRef.current) return false;
    const n = index.get(id);
    const board = boardOf(id);
    const host = n?.type === 'text' ? hostOf(id) : undefined;
    const el = host && liveElement(host, id);
    if (!n || !board || !host || !el) return false;
    cancel();
    setHover(undefined);
    const saver = styleSaver();
    saver.set(host, 'pointer-events', 'auto');
    for (const [p, v] of [['pointer-events', 'auto'], ['user-select', 'text'], ['-webkit-user-select', 'text'], ['outline', 'none'], ['cursor', 'text']] as const) saver.set(el, p, v);
    const style = el.ownerDocument.createElement('style');
    // Highlight teks terseleksi dan caret sesuai desain (Text Selection #3B82F655, Caret accent).
    style.textContent = '[data-lakar-editing]::selection{background:#3B82F655}[data-lakar-editing]{caret-color:var(--accent,#3B82F6)}';
    host.shadowRoot?.appendChild(style);
    el.setAttribute('data-lakar-editing', '');
    try {
      el.contentEditable = 'plaintext-only';
    } catch {
      el.contentEditable = 'true';
    }
    const abort = new AbortController();
    const signal = abort.signal;
    // Tombol tidak diteruskan ke shortcut kanvas/Viewer (Delete, panah, Ctrl+A milik teks).
    el.addEventListener(
      'keydown',
      (e) => {
        // Kombo gaya teks Figma (Ctrl/⌘+B/I/U dan <> dengan Ctrl/⌘/Alt/Shift): diteruskan ke shortcut
        // kanvas — `textStyleOps` mem-patch properti node; kunci lain tetap milik kolom teks.
        const cs = e.ctrlKey || e.metaKey;
        const styleKey = (cs && !e.altKey && /^[biu]$/i.test(e.key)) || ((cs || e.altKey) && (e.code === 'Comma' || e.code === 'Period'));
        if (styleKey) return;
        e.stopPropagation();
        if (e.isComposing) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          finishText(false);
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finishText(true);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          el.ownerDocument.execCommand('insertText', false, '\n');
        }
      },
      { signal },
    );
    el.addEventListener('keyup', (e) => e.stopPropagation(), { signal });
    el.addEventListener('pointerdown', (e) => e.stopPropagation(), { signal });
    el.addEventListener(
      'input',
      () => {
        const cur = textRef.current;
        if (cur?.el === el) cur.latest = { text: el.innerText, br: el.lastChild?.nodeName === 'BR' };
        setTextTick((v) => v + 1);
      },
      { signal },
    );
    // Jendela kehilangan fokus (alt-tab): edit tetap berjalan; fokus kembali ke teks saat jendela aktif lagi.
    el.addEventListener('blur', () => el.ownerDocument.hasFocus() && finishText(true), { signal });
    textRef.current = { id, name: n.name, board, mount: mountsRef.current[board] ?? 0, el, host, original: el.textContent ?? '', saver, style, abort, latest: { text: el.innerText, br: el.lastChild?.nodeName === 'BR' } };
    setTextId(id);
    el.focus({ preventScroll: true });
    el.ownerDocument.execCommand('selectAll');
    return true;
  };
  startTextRef.current = startTextEdit;
  /** Kotak teks yang sedang diedit (ikut tumbuh saat mengetik), koordinat halaman. */
  const textBox = (): Box | undefined => {
    const t = textRef.current;
    if (!t) return undefined;
    const b = boards.find((x) => x.id === t.board);
    const boardEl = liveElement(t.host, t.board);
    if (!b || !boardEl) return index.get(t.id)?.box;
    const br = boardEl.getBoundingClientRect();
    const k = b.width > 0 && br.width > 0 ? br.width / b.width : 1;
    const r = t.el.getBoundingClientRect();
    return { x: b.x + (r.left - br.left) / k, y: b.y + (r.top - br.top) / k, w: r.width / k, h: r.height / k };
  };

  // ---- Overlay ----
  const scr = (b: Box) => ({ left: cam.x + b.x * cam.z, top: cam.y + b.y * cam.z, width: Math.max(1, b.w * cam.z), height: Math.max(1, b.h * cam.z) });
  /** Gaya smart guide (koordinat halaman → layar): garis 1px `danger` (desain Smart Guide `xUDJD`). */
  const guideStyle = (g: Guide): CSSProperties =>
    g.orientation === 'v'
      ? { left: cam.x + g.at * cam.z, top: cam.y + g.from * cam.z, width: 1, height: Math.max(1, (g.to - g.from) * cam.z) }
      : { left: cam.x + g.from * cam.z, top: cam.y + g.at * cam.z, width: Math.max(1, (g.to - g.from) * cam.z), height: 1 };
  /** Gaya label jarak (Distance Label `CVzUp`): pill di titik tengah segmen ukur. */
  const measureStyle = (m: Measure): CSSProperties =>
    m.axis === 'x'
      ? { left: cam.x + ((m.from + m.to) / 2) * cam.z, top: cam.y + m.at * cam.z }
      : { left: cam.x + m.at * cam.z, top: cam.y + ((m.from + m.to) / 2) * cam.z };
  const overlay: ReactNode[] = [];
  if (active && !pathEditing) {
    const reorder = gesture?.kind === 'reorder' ? gesture : undefined;
    const marquee = gesture?.kind === 'marquee' && gesture.moved ? gesture : undefined;
    const hoverBox = hover && hoverable && !gesture && !textId ? boxOf(hover) : undefined;
    if (hoverBox) overlay.push(<div key="hover" className="edit-hover" style={scr(hoverBox)} />);
    // Ukur jarak Alt+hover (desain GSpGv): seleksi tetap accent, target hover outline biasa, jarak danger + pill
    // "Measuring to <nama> · Alt". Seleksi kosong atau tanpa jarak → tidak ada overlay.
    if (hoverBox && measuring && hover) {
      const selBox = unionBox(
        selection.flatMap((id) => {
          const b = boxOf(id);
          return b ? [b] : [];
        }),
      );
      if (selBox) {
        measure(selBox, hoverBox).forEach((m, i) => {
          overlay.push(<div key={`mg:${i}`} className="snap-guide" style={guideStyle({ orientation: m.axis === 'x' ? 'h' : 'v', at: m.at, from: m.from, to: m.to })} />);
          overlay.push(
            <span key={`ml:${i}`} className="snap-label" style={measureStyle(m)}>
              {Math.round(m.value)}
            </span>,
          );
        });
        const hs = scr(hoverBox);
        overlay.push(
          <div key="measure-hint" className="measure-hint" style={{ left: hs.left + hs.width / 2, top: hs.top - 6 }}>
            Measuring to {index.get(hover)?.name ?? hover} · Alt
          </div>,
        );
      }
    }
    if (marquee) {
      const rect = boxFrom(marquee.p0, marquee.p);
      for (const id of marqueeSelect(marqueeCandidates(marquee), rect)) {
        const b = boxOf(id);
        if (b) overlay.push(<div key={`mq:${id}`} className="edit-hover" style={scr(b)} />);
      }
      overlay.push(<div key="marquee" className="edit-marquee" style={scr(rect)} />);
    }
    const members = selection.flatMap((id) => {
      const b = boxOf(id);
      return b ? [{ id, b }] : [];
    });
    const bound = unionBox(members.map((m) => m.b));
    const tb = textId ? textBox() : undefined;
    if (tb) {
      // Desain "Text Edit Box": garis 1.5px accent, 0.75px di luar kotak teks, tanpa handle dan badge.
      overlay.push(<div key="text-edit" className="edit-text-box" style={scr({ x: tb.x - 0.75 / cam.z, y: tb.y - 0.75 / cam.z, w: tb.w + 1.5 / cam.z, h: tb.h + 1.5 / cam.z })} />);
    } else if (reorder) {
      overlay.push(<div key="ghost" className="edit-ghost-slot" style={scr(reorder.node.box)} />);
      if (reorder.container && reorder.target) {
        const c = reorder.container.box;
        const t = reorder.target;
        const row = reorder.container.layout === 'row';
        overlay.push(<div key="target" className="edit-drop-target" style={scr({ x: c.x - 4 / cam.z, y: c.y - 4 / cam.z, w: c.w + 8 / cam.z, h: c.h + 8 / cam.z })} />);
        overlay.push(
          <div key="bar" className={`edit-drop-bar ${row ? 'row' : 'column'}`} style={scr(t.bar)}>
            <i />
            <i />
          </div>,
        );
        const bs = scr(t.bar);
        const cs = scr(c);
        overlay.push(
          <div key="hint" className="edit-drop-hint" style={row ? { left: bs.left + bs.width / 2, top: cs.top + cs.height + 10 } : { left: cs.left + cs.width / 2, top: bs.top + bs.height + 8 }}>
            <Icon name={row ? 'arrowLeftRight' : 'arrowUpDown'} size={10} />
            {reorderHint(t.position, reorder.container.name)}
          </div>,
        );
      }
    } else if (bound && members.length) {
      // Seleksi master/instance saja: kotak, handle, dan badge ungu (desain xTIr4 "Selection" $component).
      const tone = members.every((m) => kinds?.has(m.id)) ? 'component' : undefined;
      if (members.length > 1) for (const m of members) overlay.push(<div key={`member:${m.id}`} className={`edit-member${tone ? ' component' : ''}`} style={scr(m.b)} />);
      overlay.push(
        // Saat move badge menunjukkan posisi bulat yang akan di-commit (desain fvbjN "664, 64").
        <SelectionBox key="selection" style={scr(bound)} handles={canEdit && !(gesture?.kind === 'move')} label={gesture?.kind === 'move' ? posBadge(members.length, bound) : sizeBadge(members.length, bound)} tone={tone} />,
      );
    }
    // Smart guide + label jarak selama gestur move/resize (desain fvbjN): warna danger supaya beda dari accent.
    const snap = gesture && (gesture.kind === 'move' || gesture.kind === 'resize') ? gesture.snap : undefined;
    if (snap) {
      snap.guides.forEach((g, i) => overlay.push(<div key={`snap:${i}`} className="snap-guide" style={guideStyle(g)} />));
      snap.gaps.forEach((m, i) =>
        overlay.push(
          <span key={`gap:${i}`} className="snap-label" style={measureStyle(m)}>
            {Math.round(m.value)}
          </span>,
        ),
      );
    }
    if (components && !reorder && !marquee) overlay.push(...componentMarks(components, selection, index, boxOf, scr, onSelectIds));
    const pb = pastedTag && !gesture && selection.includes(pastedTag.id) ? boxOf(pastedTag.id) : undefined;
    if (pb) {
      const s = scr(pb);
      overlay.push(
        <span key="pasted-tag" className="change-tag pasted-tag" aria-hidden="true" style={{ left: s.left, top: s.top + s.height + 24 }}>
          <Icon name="clipboardPaste" size={10} />
          Pasted · {pastedTag!.label}
        </span>,
      );
    }
  }

  return {
    onMounted,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    cancel,
    overlay,
    boardBox,
    dragging: gesture !== null && gesture.moved && gesture.kind !== 'marquee',
    /** Pohon geometri halaman (aksi edit story 6, editActions.ts). */
    scene: () => geo,
    /** Berubah tiap board di-mount ulang (geometri `scene` baru): pemilik ketersediaan aksi menghitung ulang. */
    sceneKey: boards.map((b) => `${b.id}:${mounts[b.id] ?? 0}`).join(','),
    contextSelect,
    startTextEdit,
    textEditing: textId !== undefined,
    /** Geometri live node (edit titik path, pathTools.tsx). */
    nodeGeo: (id: string): GeoNode | undefined => index.get(id),
    /** Elemen live node di shadow root board-nya (pratinjau `d`). */
    liveEl: (id: string): HTMLElement | undefined => {
      const host = hostOf(id);
      return host ? liveElement(host, id) : undefined;
    },
  };
}

/** Tag komponen di atas node (desain Component Tag gNzrP): master = isi ungu, instance = latar `component-soft`. */
function ComponentTag({ kind, label, at }: { kind: 'master' | 'instance'; label: string; at: { left: number; top: number } }) {
  return (
    <div className={`component-tag ${kind}`} style={{ left: at.left, top: at.top - 18 }}>
      <Icon name={kind === 'master' ? 'component' : 'diamond'} size={10} />
      <span>{label}</span>
    </div>
  );
}

/**
 * Penanda komponen (desain bagian 08): master terpilih → tag master + tag di setiap instancenya; instance terpilih → tag
 * instance; seleksi komposit (isi instance) → outline putus-putus + tag "<instance> · <master>" di instance terluar dan
 * breadcrumb "Esc to exit instance" di kiri atas kanvas.
 */
function componentMarks(
  info: ComponentInfo,
  selection: readonly string[],
  index: ReadonlyMap<string, GeoNode>,
  boxOf: (id: string) => Box | undefined,
  scr: (b: Box) => { left: number; top: number; width: number; height: number },
  onSelectIds: (ids: string[]) => void,
): ReactNode[] {
  const out: ReactNode[] = [];
  const masterName = (instanceId: string) => info.masterById.get(info.instances.get(instanceId)?.componentId as string)?.name ?? 'Component';
  const tagged = new Set<string>();
  const tag = (id: string, kind: 'master' | 'instance', label: string) => {
    const b = boxOf(id);
    if (!b || tagged.has(id)) return;
    tagged.add(id);
    out.push(<ComponentTag key={`tag:${id}`} kind={kind} label={label} at={scr(b)} />);
  };
  const roots = [...new Set(selection.filter(isComposite).map(instanceRootOf))];
  for (const r of roots) {
    const b = boxOf(r);
    if (!b) continue;
    out.push(<div key={`inst:${r}`} className="edit-instance-outline" style={scr(b)} />);
    tag(r, 'instance', `${index.get(r)?.name ?? info.stored.get(r)?.name ?? ''} · ${masterName(r)}`);
  }
  for (const id of selection) {
    const kind = info.kinds.get(id);
    if (kind === 'instance') tag(id, 'instance', masterName(id));
    else if (kind === 'master') {
      const m = info.masterById.get(id);
      tag(id, 'master', m?.name ?? '');
      for (const i of m?.instances ?? []) tag(i, 'instance', m!.name);
    }
  }
  const primary = selection[selection.length - 1];
  if (primary && isComposite(primary) && index.has(primary)) {
    const root = instanceRootOf(primary);
    out.push(
      <div key="instance-breadcrumb" className="instance-breadcrumb canvas-overlay-ui" role="navigation" aria-label="Instance">
        <button type="button" className="instance-breadcrumb-root" title="Select instance" onClick={() => onSelectIds([root])}>
          <Icon name="diamond" size={12} />
          <span>{index.get(root)?.name ?? info.stored.get(root)?.name ?? root}</span>
        </button>
        <Icon name="chevronRight" size={12} className="instance-breadcrumb-sep" />
        <span className="instance-breadcrumb-child">{index.get(primary)?.name}</span>
        <i className="instance-breadcrumb-divider" aria-hidden="true" />
        <span className="instance-breadcrumb-hint">Esc to exit instance</span>
      </div>,
    );
  }
  return out;
}

/** Terapkan penyesuaian snap pada kotak `to` hasil `resizeBox`: `e`/`s` menambah sisi, `w`/`n` menggeser
 * sisi jangkar. `x`/`y` dihitung dari tepi jangkar (bukan delta mentah) supaya clamp `w`/`h` ≥ 1 tidak
 * membuat tepi yang tidak digerakkan ikut melayang. */
const applyResizeSnap = (to: Box, handle: Handle, s: Snap): Box => {
  const w = Math.max(1, to.w + (handle.includes('e') ? s.dx : 0) - (handle.includes('w') ? s.dx : 0));
  const h = Math.max(1, to.h + (handle.includes('s') ? s.dy : 0) - (handle.includes('n') ? s.dy : 0));
  return {
    x: handle.includes('w') ? to.x + to.w - w : to.x,
    y: handle.includes('n') ? to.y + to.h - h : to.y,
    w,
    h,
  };
};

/** Kotak akhir anggota resize sebagaimana di-commit (`committedBox`): tunggal = kotak handle, multi = diskalakan. */
const memberBox = (g: { members: readonly GeoNode[]; from: Box }, n: GeoNode, to: Box): Box => committedBox(n, g.members.length === 1 ? to : scaleBox(n.box, g.from, to));

/** Kotak seleksi (desain "Selection"): garis 1.5px accent, 8 handle putih, badge ukuran di bawah. */
export function SelectionBox({ style, handles, label, tone }: { style: CSSProperties; handles: boolean; label: string; tone?: 'component' | undefined }) {
  return (
    <div className={`selection${tone ? ` ${tone}` : ''}`} style={style}>
      {HANDLES.map((h) => (
        <i key={h} className={`handle ${h}${handles ? ' active' : ''}`} data-handle={handles ? h : undefined} style={handles ? { cursor: HANDLE_CURSOR[h] } : undefined} />
      ))}
      <span className="size-badge">{label}</span>
    </div>
  );
}

/** Klon node untuk pratinjau drag reorder (desain "Drag Preview": opacity 0.92 + bayangan), di shadow root sendiri. */
function dragGhost(el: HTMLElement, box: Box): HTMLElement {
  const wrap = el.ownerDocument.createElement('div');
  wrap.className = 'edit-drag-preview';
  const shadow = wrap.attachShadow({ mode: 'open' });
  const style = el.ownerDocument.createElement('style');
  style.textContent = ':host{all:initial;display:block}';
  const inner = el.ownerDocument.createElement('div');
  inner.style.cssText = `position:relative;width:${box.w}px;height:${box.h}px;transform-origin:0 0`;
  const clone = el.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, { position: 'absolute', left: '0', top: '0', right: 'auto', bottom: 'auto', margin: '0', width: `${box.w}px`, height: `${box.h}px`, opacity: '1' });
  inner.appendChild(clone);
  shadow.replaceChildren(style, inner);
  return wrap;
}
function placeGhost(ghost: HTMLElement, box: Box, d: Point, cam: Camera) {
  ghost.style.left = `${cam.x + (box.x + d.x) * cam.z}px`;
  ghost.style.top = `${cam.y + (box.y + d.y) * cam.z}px`;
  const inner = ghost.shadowRoot?.lastElementChild as HTMLElement | null;
  if (inner) inner.style.transform = `scale(${cam.z})`;
  ghost.style.width = `${box.w * cam.z}px`;
  ghost.style.height = `${box.h * cam.z}px`;
}
