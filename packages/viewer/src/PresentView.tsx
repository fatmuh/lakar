// Mode Present (spec-prototype-mode): route `#/p/<slug>[?f=<flowId>]`, satu board baca-saja penuh layar dari
// dokumen ter-resolve. Pointer pada elemen `[data-lakar-id]` di dalam shadow DOM board menjalankan interaksi
// (v13) sesuai trigger-nya — tap/press/hover/drag: navigate ke board target (transisi instant/dissolve/slide),
// back ke board sebelumnya, atau openLink di tab baru. Interaksi pada instance tersimpan dicocokkan lewat segmen
// terluar alamat (akar ekspansi memakai id instance polos, isinya `I/…`). Esc menutup; `?f=` memilih flow awal
// (default flow pertama / board pertama).
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveDocument, type Interaction, type InteractionTrigger, type LakarDocument, type ResolvedDocument } from '@lakar/schema';
import { api, errorText } from './api';
import { docHash } from './files';
import { boardDepKeys, ensureFaces, mountLive, RenderDepsCache } from './liveBoard';
import { Icon } from './icons';

const depsCache = new RenderDepsCache((keys) => api.renderDeps(keys));

type NodeEntry = { type?: string; name?: string; interactions?: Interaction[] };

/**
 * Alamat node → interaksi `trigger` yang cocok (tanpa argumen = semua trigger, dipakai rect hotspot): node
 * ter-resolve plus node instance tersimpan pada segmen terluar (akar ekspansi memakai id instance polos, jadi
 * segmen pertama selalu id instance terluar bila ada). Dedupe per `id` interaksi menjaga instance tersimpan dan
 * hasil resolve tidak menghasilkan aksi ganda.
 */
function interactionsAt(resolved: ReadonlyMap<string, NodeEntry>, stored: ReadonlyMap<string, NodeEntry>, id: string, trigger?: InteractionTrigger): Interaction[] {
  const out: Interaction[] = [...(resolved.get(id)?.interactions ?? [])];
  const s = stored.get(id.split('/')[0]!);
  if (s?.type === 'instance' && s.interactions) out.push(...s.interactions);
  const seen = new Set<string>();
  return out.filter((i) => (!trigger || i.trigger === trigger) && !seen.has(i.id) && seen.add(i.id));
}

/** Indeks id → node untuk dokumen (tersimpan atau ter-resolve): board dan semua turunannya termasuk slot instance. */
function nodeIndex(root: { pages: readonly { children: readonly unknown[] }[] }): Map<string, NodeEntry> {
  const m = new Map<string, NodeEntry>();
  const walk = (n: { id: string; type?: string; name?: string; children?: unknown[]; slots?: Record<string, unknown[]>; interactions?: Interaction[] }) => {
    m.set(n.id, n);
    for (const c of n.children ?? []) walk(c as never);
    for (const list of Object.values(n.slots ?? {})) for (const c of list) walk(c as never);
  };
  for (const p of root.pages) for (const b of p.children) walk(b as never);
  return m;
}

/** Board pertama dokumen ter-resolve (fallback saat flow menunjuk board yang sudah dihapus). */
function firstBoardId(doc: ResolvedDocument): string | undefined {
  for (const p of doc.pages) if (p.children.length) return p.children[0]!.id as string;
  return undefined;
}

type Active = { boardId: string; enter?: { kind: 'dissolve' | 'slide'; direction?: 'left' | 'right' | 'up' | 'down'; durationMs: number; easing: string } };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Ambang gerak pointerdown→pointermove sebelum gestur dihitung `drag` (piksel, jarak manhattan). */
const DRAG_PX = 8;

/**
 * Host satu board Present: shadow DOM live diskalakan agar muat di viewport (fit, boleh membesar). Board
 * `height:'hug'` diukur dari elemen hasil mount (`offsetHeight`) sebelum fit. Kelas `enter-*` baru dipasang
 * saat mount selesai supaya transisi memutar konten baru, bukan host kosong.
 */
function PresentBoard({ doc, boardId, enter, zoom = 'fit', onReady }: { doc: ResolvedDocument; boardId: string; enter?: Active['enter'] | undefined; zoom?: 'fit' | 'fill' | 'full' | undefined; onReady?: (() => void) | undefined }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [measured, setMeasured] = useState<number>();
  const board = doc.pages.flatMap((p) => p.children).find((b) => (b as { id: string }).id === boardId) as { id: string; name?: string; width: number; height: number | 'hug' } | undefined;
  const bh = isNum(board?.height) ? board.height : measured;
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!board) return;
    const fit = () => {
      const w = innerWidth / board.width;
      const h = innerHeight / (bh ?? 600);
      // Mode zoom Present (tombol Z): fit=seluruh board terlihat, fill=penuhi layar, full=ukuran asli.
      setScale(zoom === 'full' ? 1 : Math.max(0.05, zoom === 'fill' ? Math.max(w, h) : Math.min(w, h)));
    };
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, [board?.id, board?.width, bh, zoom]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !board) return;
    let live = true;
    setError(undefined);
    const deps = boardDepKeys(board as never);
    depsCache
      .ensure(deps)
      .then(async (d) => {
        await ensureFaces(host.ownerDocument, d.fonts);
        if (!live) return;
        const el = mountLive(host, doc, boardId, d);
        if (!isNum(board.height)) setMeasured(el.offsetHeight || undefined);
        setReady(true);
        onReady?.();
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [doc, boardId, board]);
  if (!board) return <div className="present-error">Board not found</div>;
  // Kelas enter-* dipasang sesudah mount (ready) — animasi menunggu konten baru, bukan host kosong.
  const cls = `present-board${ready && enter ? ` enter-${enter.kind}${enter.kind === 'slide' ? `-${enter.direction ?? 'left'}` : ''}` : ''}`;
  const style = { width: board.width, height: bh ?? 'auto', transform: `scale(${scale})`, ...(ready && enter ? { animationDuration: `${enter.durationMs}ms`, animationTimingFunction: enter.easing } : {}) };
  return (
    <div className={cls} style={style}>
      <div ref={hostRef} className="present-host" style={{ width: board.width, height: bh ?? 'auto' }} />
      {error && <div className="present-error">{error}</div>}
    </div>
  );
}

/** Siklus mode zoom Present (tombol Z): fit → fill → full → fit. */
const ZOOMS = ['fit', 'fill', 'full'] as const;

export function PresentView({ slug, flowId, onExit }: { slug: string; flowId?: string | undefined; onExit: () => void }) {
  const [doc, setDoc] = useState<LakarDocument>();
  const [resolved, setResolved] = useState<ResolvedDocument>();
  const [error, setError] = useState<string>();
  const [current, setCurrent] = useState<Active>();
  const [nav, setNav] = useState(0);
  const [hotspots, setHotspots] = useState(false);
  const [spots, setSpots] = useState<{ id: string; x: number; y: number; w: number; h: number }[]>([]);
  const stackRef = useRef<string[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(0);
  // Mode zoom Present (tombol Z): siklus fit → fill → full → fit.
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>('fit');
  const indexRef = useRef<{ resolved: Map<string, NodeEntry>; stored: Map<string, NodeEntry> } | undefined>(undefined);

  const pickStart = useCallback((d: LakarDocument, r: ResolvedDocument) => {
    const idx = indexRef.current!.resolved;
    const flow = flowId ? d.flows?.find((f) => f.id === flowId) : d.flows?.[0];
    return flow && idx.has(flow.startBoardId) ? flow.startBoardId : firstBoardId(r);
  }, [flowId]);

  useEffect(() => {
    let live = true;
    api
      .getDoc(slug)
      .then((d) => {
        if (!live) return;
        setDoc(d);
        const r = resolveDocument(d);
        setResolved(r);
        indexRef.current = { resolved: nodeIndex(r), stored: nodeIndex(d) };
        const start = pickStart(d, r);
        if (start) setCurrent({ boardId: start });
        else setError('This file has no boards to present.');
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [slug, flowId, pickStart]);

  const restart = useCallback(() => {
    stackRef.current = [];
    if (!resolved || !doc || !indexRef.current) return;
    const start = pickStart(doc, resolved);
    if (start) {
      setNav((n) => n + 1);
      setCurrent({ boardId: start });
    }
  }, [doc, resolved, pickStart]);

  const go = useCallback(
    (i: Interaction) => {
      const r = resolved;
      if (!r || !current) return;
      const t = i.transition;
      const anim = !t || t.kind === 'instant' ? undefined : { kind: t.kind as 'dissolve' | 'slide', direction: t.direction, durationMs: t.durationMs ?? 300, easing: t.easing ?? 'ease-in-out' };
      if (i.action.kind === 'navigate') {
        const target = i.action.boardId;
        if (!indexRef.current?.resolved.has(target)) return;
        stackRef.current.push(current.boardId);
        setNav((n) => n + 1);
        setCurrent({ boardId: target, enter: anim });
      } else if (i.action.kind === 'back') {
        const prev = stackRef.current.pop();
        if (prev) {
          setNav((n) => n + 1);
          setCurrent({ boardId: prev, enter: anim });
        }
      } else if (i.action.kind === 'openLink') {
        open(i.action.url, '_blank', 'noopener');
      }
    },
    [current, resolved],
  );

  // Delegasi trigger pada stage: jalan ke atas lewat `[data-lakar-id]` (shadow root ikut composedPath). tap=click,
  // press=pointerdown, hover=pointerover (sekali per masuk; pointerout melepas tandanya), drag=pointerdown lalu
  // geser > DRAG_PX — gestur drag yang memicu tidak dihitung tap saat click berikutnya.
  useEffect(() => {
    const stage = stageRef.current;
    const idx = indexRef.current;
    if (!stage || !idx) return;
    const hit = (e: Event, trigger: InteractionTrigger): { el: HTMLElement; i: Interaction } | undefined => {
      for (const el of e.composedPath() as HTMLElement[]) {
        if (!(el instanceof HTMLElement) || !el.dataset.lakarId) continue;
        const ints = interactionsAt(idx.resolved, idx.stored, el.dataset.lakarId, trigger);
        if (ints.length) return { el, i: ints[0]! };
      }
      return undefined;
    };
    const hovered = new Set<HTMLElement>();
    const onOver = (e: PointerEvent) => {
      const h = hit(e, 'hover');
      if (h && !hovered.has(h.el)) {
        hovered.add(h.el);
        go(h.i);
      }
    };
    const onOut = (e: PointerEvent) => {
      for (const el of e.composedPath()) if (el instanceof HTMLElement) hovered.delete(el);
    };
    let drag: { i: Interaction; x: number; y: number } | undefined;
    let dragFired = false;
    const onDown = (e: PointerEvent) => {
      const p = hit(e, 'press');
      if (p) go(p.i);
      const d = hit(e, 'drag');
      drag = d ? { i: d.i, x: e.clientX, y: e.clientY } : undefined;
      dragFired = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || dragFired || Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) <= DRAG_PX) return;
      dragFired = true;
      go(drag.i);
    };
    const onUp = () => {
      drag = undefined;
    };
    const onClick = (e: MouseEvent) => {
      if (dragFired) {
        dragFired = false;
        return;
      }
      const t = hit(e, 'tap');
      if (t) go(t.i);
    };
    stage.addEventListener('click', onClick);
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('pointerover', onOver);
    stage.addEventListener('pointerout', onOut);
    return () => {
      stage.removeEventListener('click', onClick);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('pointerover', onOver);
      stage.removeEventListener('pointerout', onOut);
    };
  }, [resolved, current, go]);

  // Navigasi keyboard Present (desain prototype Figma): →/Spasi/N board berikutnya dalam urutan dokumen,
  // ← kembali (riwayat navigasi dulu, lalu board sebelumnya), F fullscreen, Z siklus mode zoom.
  const orderedIds = useCallback((): string[] => {
    const r = resolved;
    return r ? r.pages.flatMap((p) => p.children).map((b) => (b as { id: string }).id) : [];
  }, [resolved]);
  const stepBoard = useCallback(
    (dir: 1 | -1) => {
      if (!current || !indexRef.current) return;
      if (dir === -1) {
        const prev = stackRef.current.pop();
        if (prev) {
          setNav((n) => n + 1);
          setCurrent({ boardId: prev });
          return;
        }
      }
      const ids = orderedIds();
      const i = ids.indexOf(current.boardId);
      const next = ids[i + dir];
      if (i === -1 || next === undefined || !indexRef.current.resolved.has(next)) return;
      stackRef.current.push(current.boardId);
      setNav((n) => n + 1);
      setCurrent({ boardId: next });
    },
    [current, orderedIds],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
      else if (e.key === 'r' || e.key === 'R') restart();
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        stepBoard(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepBoard(-1);
      } else if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      } else if (e.key === 'z' || e.key === 'Z') setZoom((z) => ZOOMS[(ZOOMS.indexOf(z) + 1) % ZOOMS.length] ?? 'fit');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onExit, restart, stepBoard]);

  // Rect hotspot diukur dari elemen live di dalam shadow root host (bukan light DOM) tiap ganti board / toggle.
  useEffect(() => {
    if (!hotspots || !indexRef.current) {
      setSpots([]);
      return;
    }
    const stage = stageRef.current;
    const host = stage?.querySelector('.present-host');
    if (!stage || !host?.shadowRoot) return;
    const sr = stage.getBoundingClientRect();
    const out: { id: string; x: number; y: number; w: number; h: number }[] = [];
    host.shadowRoot.querySelectorAll<HTMLElement>('[data-lakar-id]').forEach((el) => {
      const id = el.dataset.lakarId!;
      if (!interactionsAt(indexRef.current!.resolved, indexRef.current!.stored, id).length) return;
      const r = el.getBoundingClientRect();
      out.push({ id, x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height });
    });
    setSpots(out);
  }, [hotspots, current, resolved, mounted]);

  if (error) {
    return (
      <div className="present">
        <div className="present-empty">
          <strong>Cannot present this file</strong>
          <span>{error}</span>
          <button type="button" onClick={onExit}>
            Back to file
          </button>
        </div>
      </div>
    );
  }
  const boardName = current && indexRef.current?.resolved.get(current.boardId)?.name;
  return (
    <div className="present" role="application" aria-label="Present">
      <div ref={stageRef} className="present-stage">
        {/* key = boardId + nomor navigasi: remount per navigasi supaya animasi enter-* terulang tiap kali. */}
        {resolved && current && <PresentBoard key={`${current.boardId}:${nav}`} doc={resolved} boardId={current.boardId} enter={current.enter} zoom={zoom} onReady={() => setMounted((m) => m + 1)} />}
        {!resolved && <Icon name="loaderCircle" size={26} className="spin" />}
        {hotspots && spots.map((s) => <span key={s.id} className="present-hotspot" style={{ left: s.x, top: s.y, width: s.w, height: s.h }} />)}
      </div>
      <div className="present-bar">
        <button type="button" className="present-btn" onClick={onExit} title="Exit presentation (Esc)" aria-label="Exit presentation">
          <Icon name="x" size={14} />
        </button>
        <span className="present-title">{boardName ?? slug}</span>
        <button type="button" className={`present-btn${hotspots ? ' active' : ''}`} onClick={() => setHotspots((h) => !h)} aria-pressed={hotspots} title="Show hotspots">
          <Icon name="pointer" size={14} />
        </button>
        <button type="button" className="present-btn" onClick={restart} title="Restart (R)">
          <Icon name="rotateCcw" size={14} />
        </button>
        <a className="present-btn" href={docHash(slug)} title="Open in editor">
          <Icon name="pencil" size={14} />
        </a>
      </div>
    </div>
  );
}
