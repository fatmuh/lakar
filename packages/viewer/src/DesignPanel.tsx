// Panel Design (editor-canvas story 5, desain bagian 05 Editor: fdf6D/S7hYr, SuJOz/UHOWY, XlDGD/g6Mbir, XZif7/J02Cu;
// komponen Section 00 DESIGN PANEL: Segmented Control, Select Field, Paint Row). Menggantikan tab Inspect: nilai dibaca
// dari node tersimpan (ref token tampil sebagai chip) dan setiap edit yang di-commit (Enter/blur, lepas scrub, pilih
// segmen/select, tutup color picker) menjadi satu permintaan ops berisi op `update` untuk semua node terpilih (AD-7),
// lewat `onCommit` Viewer (History + undo, AD-8). Parsing/patch di designValues.ts dan designModel.ts (murni).
import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { gradientLayerCss } from '@lakar/render';
import { Blend, type DocOp, type LakarDocument } from '@lakar/schema';
import type { FontFamily, InspectNode } from './api';
import { groupOverrides, instancesText, markerLabel, resetGroupOps, type ComponentInfo } from './componentModel';
import { InstancePropsSlots, MasterComponentGroup, SlotFrameGroup, type ComponentEdit } from './ComponentPropsPanel';
import type { InstanceModel, MasterModel } from './componentProps';
import { copyText } from './Connections';
import { copyAs, type CopyFormat } from './copyas';
import { ALIGN_ACTIONS, DISTRIBUTE_ACTIONS, type EditAction } from './editActions';
import { ACTION_META, actionTitle } from './EditMenu';
import {
  addEffect,
  addFill,
  addStroke,
  axisGapOf,
  canEditXY,
  convertEffect,
  convertFill,
  CORNERS,
  describeEdit,
  designGroups,
  editFill,
  editShadow,
  editStop,
  effectKindsOf,
  enterGrid,
  fillRows,
  formatRowCount,
  GRID_TRACKS_MAX,
  keepsToken,
  layoutOf,
  moveFill,
  opsFor,
  paddingAxisState,
  paddingEdgeOf,
  parseColumnCount,
  parseRowCount,
  RADIUS_TYPES,
  radiusAll,
  readField,
  readSizing,
  removeEffect,
  removeFill,
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
  SIDES,
  solidAlpha,
  solidColor,
  strokeColor,
  strokeSides,
  toggleSide,
  formatDash,
  isVectorSelection,
  MITER_MAX,
  parseDash,
  parseMiter,
  setVector,
  vectorValue,
  trackCount,
  type Axis,
  type DesignTarget,
  type EffectKind,
  type Group as DesignGroup,
  type FieldState,
  type FillLike,
  type PadAxis,
  type PaintKind,
  type Raw,
  type Side,
  type Sizing,
} from './designModel';
import {
  formatNumber,
  formatPercent,
  changeColor,
  isTokenRef,
  parseHex,
  parseNumber,
  parsePercent,
  sameValue,
  splitHex,
  WEIGHT_NAMES,
} from './designValues';
import { CodeSection, ExportSection, type ExportSel } from './ExportSection';
import type { CodegenTarget } from './codeExport';
import { Menu, type Item } from './FileMenu';
import { ThemeSection } from './ThemeSection';
import { cellOf, newTokenName, themeModeOps, TYPE_META, type TokenMap } from './themeModel';
import {
  anyRef,
  applyTokenOps,
  createTokenOps,
  createValue,
  fillColorSpec,
  paddingAxisSpec,
  paddingEdgeSpec,
  propSpec,
  radiusSpec,
  stopColorSpec,
  strokeSpec,
  detachOps,
  pickerEmpty,
  pickerGroups,
  pickerHint,
  refAt,
  slotAccepts,
  specState,
  tokenValueText,
  type TokenSpec,
} from './tokenPicker';
import { Icon, NODE_ICON, type IconName } from './icons';
import type { PathEditPanel } from './pathTools';
import type { PointType } from './pathEdit';

type Commit = (ops: DocOp[], description: string) => Promise<boolean>;

const TYPE_LABEL: Record<string, string> = { board: 'Board', frame: 'Frame', text: 'Text', rect: 'Rectangle', ellipse: 'Ellipse', path: 'Path', icon: 'Icon' };
// Copy as CSS/Tailwind per node digantikan dialog Export code (epic kode story 5); JSON tetap untuk debug.
const COPY_FORMATS: readonly [CopyFormat, string][] = [['json', 'JSON']];
const JUSTIFY_OPTIONS = [
  ['start', 'Start'],
  ['center', 'Center'],
  ['end', 'End'],
  ['space-between', 'Space between'],
] as const;
const BLEND_OPTIONS = Blend.options.map((b) => [b, b.replace(/(^|-)([a-z])/g, (_, s: string, c: string) => (s ? ' ' : '') + c.toUpperCase())] as const);
const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/** Pembangun op dari target terbaru (dievaluasi saat giliran commit-nya tiba). */
type Build = (targets: DesignTarget[]) => DocOp[];
/** Kontrol non-aktif bila panel baca-saja (pratinjau versi/offline); `run` mengantre satu edit (satu commit). */
type Ctx = {
  disabled: boolean;
  run: (build: Build, label: string) => void;
  /** Target terpilih saat ini (saringan slot, nilai picker). */
  targets: DesignTarget[];
  /** Token dan mode dokumen tampil (epic token-tema story 4). */
  tokens: TokenMap;
  modes: readonly string[];
  /** Kunci spec yang picker-nya sedang terbuka (status "open" Token Field). */
  pickerKey: string | undefined;
  openPicker: (anchor: HTMLElement, spec: TokenSpec) => void;
  /** Token dan mode dokumen terbaru (dibaca pembangun op saat gilirannya tiba, bukan salinan saat klik). */
  latest: () => { tokens: TokenMap; modes: readonly string[] };
};
/** Batas tunggu rev commit sebelumnya sebelum antrean edit dilanjutkan (dokumen gagal dimuat ulang). */
const PENDING_MAX_MS = 3000;

// ---------------------------------------------------------------------------
// Komponen dasar (Section 00 DESIGN PANEL)
// ---------------------------------------------------------------------------

function TokenChip({ name, onClick, disabled }: { name: string; onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" className="dp-token" title={`Token ${name}. Edit the value to detach it.`} disabled={disabled} onClick={onClick}>
      {name}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Token Field dan Token Picker (epic token-tema story 4, desain 07 u5v2n/XvZQy, komponen Token Field zjtyn)
// ---------------------------------------------------------------------------

/** Kunci spec (status open Token Field / tombol token). */
const specKey = (s: TokenSpec) => `${s.label}:${s.propPath.join('.')}`;
/** Jangkar posisi picker: kotak field terdekat. */
const anchorOf = (el: HTMLElement) => el.closest<HTMLElement>('.dp-tokenfield, .dp-paint-box, .dp-field, .dp-select') ?? el;

/** Detach slot `spec` di semua node terpilih: literal nilai mode efektif board masing-masing (satu commit). */
function runDetach(ctx: Ctx, spec: TokenSpec) {
  const now = detachOps(ctx.targets, spec, ctx.tokens, ctx.modes);
  if ('error' in now || now.ops.length === 0) return;
  ctx.run((ts) => {
    const { tokens, modes } = ctx.latest();
    const b = detachOps(ts, spec, tokens, modes);
    return 'error' in b ? [] : b.ops;
  }, now.label);
}

/** Tombol ikon diamond di ujung field literal: membuka picker (title "Apply token"). Tanpa slot token → tidak tampil. */
function TokenButton({ spec, ctx, disabled }: { spec: TokenSpec; ctx: Ctx; disabled?: boolean | undefined }) {
  if (!slotAccepts(ctx.targets, spec.propPath)) return null;
  const open = ctx.pickerKey === specKey(spec);
  return (
    <button
      type="button"
      className={`dp-token-btn${open ? ' open' : ''}`}
      title="Apply token"
      aria-label={`Apply token to ${spec.label}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={ctx.disabled || disabled}
      onClick={(e) => {
        e.preventDefault();
        ctx.openPicker(anchorOf(e.currentTarget), spec);
      }}
    >
      <Icon name="diamond" size={12} />
    </button>
  );
}

/** Isi Token Field: pill nama (klik = picker), nilai mode aktif (dobel-klik = ketik literal), tombol Detach. */
function TokenParts({ name, spec, ctx, text, onEditValue }: { name: string; spec: TokenSpec; ctx: Ctx; text: string; onEditValue?: (() => void) | undefined }) {
  const open = ctx.pickerKey === specKey(spec);
  return (
    <>
      <button
        type="button"
        className="dp-tokenfield-pill"
        title={`Token ${name}`}
        aria-label={`${spec.label}: token ${name}. Change token`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={ctx.disabled}
        onClick={(e) => ctx.openPicker(anchorOf(e.currentTarget), spec)}
      >
        <Icon name="diamond" size={10} />
        <span>{name}</span>
      </button>
      <span
        className="dp-tokenfield-value"
        title={onEditValue && !ctx.disabled ? 'Double-click to type a value (detaches the token)' : undefined}
        {...(onEditValue && !ctx.disabled ? { role: 'button', tabIndex: 0, 'aria-label': `Type a value for ${spec.label} (detaches the token)` } : {})}
        onDoubleClick={() => !ctx.disabled && onEditValue?.()}
        onKeyDown={(e) => {
          if (!ctx.disabled && onEditValue && (e.key === 'Enter' || e.key === 'F2')) {
            e.preventDefault();
            onEditValue();
          }
        }}
      >
        {text}
      </span>
      <button type="button" className="dp-tokenfield-detach" title="Detach token" aria-label={`Detach token ${name}`} disabled={ctx.disabled} onClick={() => runDetach(ctx, spec)}>
        <Icon name="unlink" size={13} />
      </button>
    </>
  );
}

/** Token Field (zjtyn): ikon jenis menggantikan label (desain Gap/Radius), lalu pill, nilai, Detach. `lead`/`trailing` = elemen di tepi field (desain E1: label W + chip resize). */
function TokenField({ name, spec, ctx, text, className, lead, trailing, onEditValue }: { name: string; spec: TokenSpec; ctx: Ctx; text: string; className?: string | undefined; lead?: ReactNode; trailing?: ReactNode; onEditValue?: (() => void) | undefined }) {
  const def = ctx.tokens[name];
  const open = ctx.pickerKey === specKey(spec);
  return (
    <div className={`dp-tokenfield${open ? ' open' : ''}${ctx.disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`} title={spec.label}>
      {lead}
      {def?.type === 'color' ? (
        <i className="dp-tokenfield-swatch" style={{ background: swatchCss(cellOf(def, ctx.targets[0]?.mode, ctx.modes).value) }} />
      ) : (
        <Icon name={def ? TYPE_META[def.type].icon : 'diamond'} size={13} className="dp-tokenfield-icon" />
      )}
      <TokenParts name={name} spec={spec} ctx={ctx} text={text} onEditValue={onEditValue} />
      {trailing}
    </div>
  );
}

const PICKER_W = 300;

/**
 * Token Picker (ISYSp): pencarian, token bertipe cocok slot per grup (nilai mode efektif node pertama), Detach token,
 * Create token from value. ↑/↓ + Enter memilih, Escape/klik luar menutup. Setiap aksi = satu `ctx.run` (satu commit).
 */
function TokenPicker({ anchor, trigger, spec, ctx, onClose }: { anchor: HTMLElement; trigger: HTMLElement | undefined; spec: TokenSpec; ctx: Ctx; onClose: () => void }) {
  const targets = ctx.targets;
  const slot = slotAccepts(targets, spec.propPath);
  const state = specState(targets, spec);
  const current = refAt(state);
  const mode = targets[0]?.mode;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<number | undefined>(undefined);
  const [naming, setNaming] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | undefined>(undefined);
  const groups = slot ? pickerGroups(ctx.tokens, slot.accepts, query, mode, ctx.modes) : [];
  const rows = groups.flatMap((g) => g.rows);
  // Fokus kembali ke pemicu saat picker ditutup (pola Menu). Pemicu direkam saat dibuka: autoFocus pencarian sudah
  // memindah fokus sebelum efek ini jalan. Pemicu yang sudah hilang (Token Field ↔ Field) → jangkar.
  useLayoutEffect(
    () => () => {
      const back = trigger?.isConnected ? trigger : anchor.isConnected ? anchor.querySelector<HTMLElement>('button, input') : null;
      back?.focus({ preventScroll: true });
    },
    [],
  );
  // Kiri panel Design (jarak 12) sejajar atas field; tidak muat (bottom sheet) → di bawah field. Dijepit ke viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const panel = anchor.closest('.design-panel')?.getBoundingClientRect();
    const h = el.offsetHeight;
    const side = panel ? panel.left - PICKER_W - 12 : -1;
    const left = side >= 8 ? side : Math.max(8, Math.min(a.left, window.innerWidth - PICKER_W - 8));
    const top0 = side >= 8 ? a.top - 10 : a.bottom + 4;
    setPos({ left, top: Math.max(8, Math.min(top0, window.innerHeight - h - 8)) });
  }, [anchor, rows.length, naming !== undefined, error]);
  const activeId = (i: number) => `token-picker-opt-${i}`;
  useEffect(() => {
    ref.current?.querySelector('.token-picker-item.active')?.scrollIntoView({ block: 'nearest' });
  });
  if (!slot) return null;
  const at = active !== undefined && active < rows.length ? active : Math.max(0, rows.findIndex((r) => r.name === current));
  const pick = (name: string) => {
    onClose();
    const now = applyTokenOps(targets, spec, name);
    if ('error' in now || now.ops.length === 0) return;
    ctx.run((ts) => {
      const b = applyTokenOps(ts, spec, name);
      return 'error' in b ? [] : b.ops;
    }, now.label);
  };
  const create = (name: string) => {
    const now = createTokenOps(ctx.tokens, name, slot.primary, state, targets, spec);
    if ('error' in now) return setError(now.error);
    onClose();
    ctx.run((ts) => {
      const b = createTokenOps(ctx.latest().tokens, name, slot.primary, specState(ts, spec), ts, spec);
      return 'error' in b ? [] : b.ops;
    }, now.label);
  };
  const detachable = anyRef(targets, spec.read);
  const curDef = current ? ctx.tokens[current] : undefined;
  const value = createValue(state, slot.primary);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <div className="menu-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        ref={ref}
        className="token-picker"
        role="dialog"
        aria-label={`${spec.label} tokens`}
        style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
        onKeyDown={onKey}
      >
        <div className="token-picker-search">
          <label className="token-picker-input">
            <Icon name="search" size={13} />
            <input
              autoFocus
              value={query}
              placeholder="Search tokens"
              aria-label="Search tokens"
              spellCheck={false}
              role="combobox"
              aria-expanded
              aria-controls="token-picker-list"
              aria-activedescendant={rows.length ? activeId(at) : undefined}
              onChange={(e) => {
                setQuery(e.currentTarget.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (rows.length) setActive((at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const r = rows[at];
                  if (r) pick(r.name);
                }
              }}
            />
          </label>
          <div className="token-picker-meta">
            <Icon name={slot.accepts.length === 1 ? TYPE_META[slot.accepts[0]!].icon : 'diamond'} size={12} />
            <span>{pickerHint(slot.accepts, mode, ctx.modes)}</span>
          </div>
        </div>
        <div className="token-picker-list" id="token-picker-list" role="listbox" aria-label="Tokens">
          {rows.length === 0 && <div className="token-picker-empty">{pickerEmpty(slot.accepts, query)}</div>}
          {groups.map((g) => (
            <Fragment key={g.group}>
              {g.group && <div className="token-picker-group">{g.group}</div>}
              {g.rows.map((r) => {
                const i = rows.indexOf(r);
                const on = r.name === current;
                return (
                  <button
                    key={r.name}
                    id={activeId(i)}
                    type="button"
                    tabIndex={-1}
                    role="option"
                    aria-selected={on}
                    className={`token-picker-item${on ? ' current' : ''}${i === at ? ' active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(r.name)}
                  >
                    {r.type === 'color' ? <i className="token-picker-swatch" style={{ background: swatchCss(r.value) }} /> : <Icon name={TYPE_META[r.type].icon} size={13} className="token-picker-icon" />}
                    <span className="token-picker-name">{r.name}</span>
                    <span className="token-picker-value">{r.text}</span>
                    {on && <Icon name="check" size={13} className="token-picker-check" />}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
        <div className="token-picker-footer">
          {detachable && (
            <button type="button" className="token-picker-action" onClick={() => { onClose(); runDetach(ctx, spec); }}>
              <Icon name="unlink" size={13} />
              <span className="token-picker-name">Detach token</span>
              {curDef && <span className="token-picker-value">{`keeps ${tokenValueText(curDef, mode, ctx.modes)}`}</span>}
            </button>
          )}
          {naming === undefined ? (
            <button
              type="button"
              className="token-picker-action"
              disabled={value === undefined}
              title={value === undefined ? (state.mixed ? 'Selected layers have different values' : `This value can't be a ${TYPE_META[slot.primary].label.toLowerCase()} token`) : undefined}
              onClick={() => {
                setError(undefined);
                setNaming(newTokenName(ctx.tokens, slot.primary));
              }}
            >
              <Icon name="plus" size={13} />
              <span className="token-picker-name">Create token from value</span>
            </button>
          ) : (
            <div className="token-picker-create">
              <Icon name="plus" size={13} />
              <input
                autoFocus
                value={naming}
                aria-label="New token name"
                spellCheck={false}
                className={error ? 'invalid' : undefined}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  setNaming(e.currentTarget.value);
                  setError(undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    create(naming);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setNaming(undefined);
                    setError(undefined);
                  }
                }}
              />
              <span className="token-picker-value">{value === undefined ? '' : TYPE_META[slot.primary].format(value)}</span>
            </div>
          )}
          {error && <div className="token-picker-error" role="alert">{error}</div>}
        </div>
      </div>
    </div>
  );
}

type FieldProps = {
  label: string;
  /** Ikon 12px menggantikan label teks (mis. move-horizontal untuk Pad H); tetap target scrub. */
  icon?: IconName | undefined;
  state: FieldState;
  /** Nilai tersimpan → teks kolom (bukan token). */
  format: (v: unknown, resolved: unknown) => string;
  /** Teks kolom → nilai skema; undefined = tidak valid (kolom kembali). */
  parse: (text: string) => unknown;
  onCommit: (v: unknown) => void;
  disabled: boolean;
  /** Scrub label: langkah per px, batas, dan nilai numerik awal. */
  scrub?: { step: number; min?: number; max?: number; base?: number | undefined; toValue?: (n: number) => unknown } | undefined;
  /** Teks redup saat kosong (mis. ukuran terukur, "Auto"). */
  placeholder?: string | undefined;
  /** Teks redup di ujung field (mis. "wrap only" pada Row gap). */
  hint?: string | undefined;
  /** Elemen di ujung field sesudah nilai (mis. chip resize Fixed/Hug/Fill pada W/H). */
  trailing?: ReactNode;
  className?: string | undefined;
  title?: string | undefined;
  /** Slot token field (story 4): ref = Token Field, literal = tombol token. */
  token?: { spec: TokenSpec; ctx: Ctx } | undefined;
};

/**
 * Kolom angka/teks (komponen Field): Enter/blur commit, Escape batal, ref token = chip (klik → input berisi nilai
 * resolve; nilai sama = ref tetap). Scrub: drag horizontal pada label, pratinjau hanya di kolom, commit saat lepas.
 */
function Field({ label, icon, state, format, parse, onCommit, disabled, scrub, placeholder, hint, trailing, className, title, token: slot }: FieldProps) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [scrubText, setScrubText] = useState<string | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const token = !state.mixed && isTokenRef(state.value) ? state.value.$token : undefined;
  const [tokenOpen, setTokenOpen] = useState(false);
  useEffect(() => setTokenOpen(false), [token]);
  const shown = state.mixed ? '' : token ? format(state.resolved, state.resolved) : format(state.value, state.resolved);
  const finish = (text: string) => {
    setDraft(undefined);
    setTokenOpen(false);
    if (text === shown && !state.mixed) return;
    if (state.mixed && text.trim() === '') return;
    const v = parse(text);
    if (v === undefined) return;
    if (keepsToken(state, v)) return;
    if (!state.mixed && sameValue(state.value, v)) return;
    onCommit(v);
  };
  useEffect(() => {
    if (tokenOpen) input.current?.select();
  }, [tokenOpen]);
  const startScrub = (e: React.PointerEvent) => {
    if (!scrub || disabled || state.mixed || e.button !== 0) return;
    // Hanya angka: tuple padding/teks tidak di-scrub (akan runtuh jadi satu angka); kosong → `scrub.base`.
    const raw = token ? state.resolved : state.value;
    const base = typeof raw === 'number' ? raw : raw === undefined ? scrub.base : undefined;
    if (base === undefined) return;
    const x0 = e.clientX;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let last: number | undefined;
    let done = false;
    const clamp = (n: number) => Math.min(scrub.max ?? Infinity, Math.max(scrub.min ?? -Infinity, n));
    const onMove = (ev: PointerEvent) => {
      const n = clamp(Math.round((base + (ev.clientX - x0) * scrub.step * (ev.shiftKey ? 10 : 1)) * 100) / 100);
      last = n;
      setScrubText(format(scrub.toValue ? scrub.toValue(n) : n, undefined));
    };
    const end = (commit: boolean) => {
      if (done) return;
      done = true;
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      setScrubText(undefined);
      if (commit && last !== undefined && last !== base) onCommit(scrub.toValue ? scrub.toValue(last) : last);
    };
    const onUp = () => end(true);
    const onCancel = () => end(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      end(false);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  };
  const lead = (
    <span
      className={`dp-field-label${scrub && !disabled ? ' scrub' : ''}`}
      onPointerDown={(e) => {
        e.preventDefault();
        startScrub(e);
      }}
    >
      {icon ? <Icon name={icon} size={12} /> : label}
    </span>
  );
  if (token && slot && !tokenOpen && draft === undefined && scrubText === undefined) {
    return <TokenField name={token} spec={slot.spec} ctx={slot.ctx} text={shown} className={className} lead={lead} trailing={trailing} onEditValue={() => setTokenOpen(true)} />;
  }
  return (
    // div (bukan label): klik label untuk scrub tidak boleh memfokuskan input (draft lama akan tertahan).
    <div className={`dp-field${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`} title={title}>
      {lead}
      {token && !tokenOpen && draft === undefined && scrubText === undefined ? (
        <TokenChip name={token} disabled={disabled} onClick={() => setTokenOpen(true)} />
      ) : (
        <input
          ref={input}
          className="dp-field-value"
          aria-label={label}
          value={scrubText ?? draft ?? shown}
          placeholder={state.mixed ? 'Mixed' : placeholder}
          disabled={disabled}
          spellCheck={false}
          autoFocus={tokenOpen}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') {
              e.stopPropagation();
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            if (cancelled.current) {
              cancelled.current = false;
              setDraft(undefined);
              setTokenOpen(false);
              return;
            }
            // Tanpa ketikan (draft kosong) tidak ada commit: nilai yang berubah dari luar selama fokus tidak ditimpa.
            if (draft === undefined) return setTokenOpen(false);
            finish(e.currentTarget.value);
          }}
        />
      )}
      {hint !== undefined && <span className="dp-field-hint">{hint}</span>}
      {trailing}
      {slot && !token && scrubText === undefined && <TokenButton spec={slot.spec} ctx={slot.ctx} disabled={disabled} />}
    </div>
  );
}

type SegOption<T> = { value: T; label?: string; icon?: IconName; title?: string; disabled?: boolean };

/** Segmented Control: satu pilihan (`value`) atau beberapa (`active`). */
function Segmented<T extends string>({
  options,
  value,
  active,
  onPick,
  disabled,
  className,
  label,
}: {
  options: readonly SegOption<T>[];
  value?: T | undefined;
  active?: ((v: T) => boolean) | undefined;
  onPick: (v: T) => void;
  disabled: boolean;
  className?: string;
  label: string;
}) {
  return (
    <div className={`dp-seg${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      {options.map((o) => {
        const on = active ? active(o.value) : value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            className={`dp-seg-item${on ? ' active' : ''}`}
            aria-pressed={on}
            title={o.title ?? o.label}
            aria-label={o.title ?? o.label}
            disabled={disabled || o.disabled}
            onClick={() => !on || active ? onPick(o.value) : undefined}
          >
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Select Field: label + nilai + chevron di atas `<select>` native. Mixed/token tampil sebagai opsi non-aktif. */
function SelectField({
  label,
  ariaLabel,
  state,
  options,
  onPick,
  disabled,
  className,
  token: slot,
}: {
  label?: string;
  /** aria-label bila tanpa label teks tampak (dropdown polos, mis. posisi Stroke). */
  ariaLabel?: string;
  state: FieldState;
  options: readonly (readonly [string, string])[];
  onPick: (v: string) => void;
  disabled: boolean;
  className?: string;
  /** Slot token (story 4): ref = Token Field, literal = tombol token di dalam kotak select. */
  token?: { spec: TokenSpec; ctx: Ctx } | undefined;
}) {
  const token = !state.mixed && isTokenRef(state.value) ? state.value.$token : undefined;
  if (token && slot) return <TokenField name={token} spec={slot.spec} ctx={slot.ctx} text={state.mixed ? '' : String(state.resolved ?? '')} className={className} />;
  const cur = state.mixed ? '__mixed' : token ? '__token' : state.value === undefined ? '__unset' : String(state.value);
  const known = options.some(([v]) => v === cur);
  return (
    <label className={`dp-select${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`}>
      {label && <span className="dp-field-label">{label}</span>}
      <select
        value={cur}
        disabled={disabled}
        aria-label={label ?? ariaLabel}
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (!v.startsWith('__')) onPick(v);
        }}
      >
        {state.mixed && (
          <option value="__mixed" disabled>
            Mixed
          </option>
        )}
        {token && (
          <option value="__token" disabled>
            {`$${token}`}
          </option>
        )}
        {cur === '__unset' && (
          <option value="__unset" disabled>
            Default
          </option>
        )}
        {!known && !cur.startsWith('__') && <option value={cur}>{cur}</option>}
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={12} className="dp-select-chevron" />
      {slot && !token && <TokenButton spec={slot.spec} ctx={slot.ctx} disabled={disabled} />}
    </label>
  );
}

/** Swatch: dengan `pick` membuka color picker native (commit sekali saat picker ditutup, event `change`). `mixed` = pola stripe (E2 "Mixed fills"). */
function Swatch({ background, pick, onClick, disabled, title, mixed }: { background: string; pick?: ((hex: string) => void) | undefined; onClick?: (() => void) | undefined; disabled: boolean; title: string; mixed?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const solid = /^#[0-9a-f]{6}/i.test(background) ? background.slice(0, 7).toLowerCase() : '#000000';
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => pickRef.current?.(el.value);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, [pick !== undefined, solid]);
  const sw = mixed ? <i className="dp-swatch-mixed" /> : <i style={{ background }} />;
  if (pick) {
    return (
      <label className={`dp-swatch${disabled ? ' disabled' : ''}`} title={title}>
        {sw}
        <input ref={ref} type="color" defaultValue={solid} key={solid} disabled={disabled} aria-label={title} />
      </label>
    );
  }
  return (
    <button type="button" className="dp-swatch" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {sw}
    </button>
  );
}

/** Nilai warna di Paint Row: hex yang bisa diketik; ref token = chip, klik → input berisi hex resolve (detach). */
function ColorValue({ stored, resolved, onHex, disabled, mixed, placeholder, label, token: slot }: { stored: unknown; resolved: unknown; onHex: (hex: string) => void; disabled: boolean; mixed?: boolean; placeholder?: string; label: string; token?: { spec: TokenSpec; ctx: Ctx } | undefined }) {
  const [open, setOpen] = useState(false);
  const token = !mixed && isTokenRef(stored) ? stored.$token : undefined;
  useEffect(() => setOpen(false), [token]);
  if (token && slot && !open) {
    return <TokenParts name={token} spec={slot.spec} ctx={slot.ctx} text={hexText(resolved).replace(/^#/, '')} onEditValue={() => setOpen(true)} />;
  }
  if (token && !open) {
    return <TokenChip name={token} disabled={disabled} onClick={() => setOpen(true)} />;
  }
  return (
    <InlineInput
      label={label}
      autoFocus={open}
      value={mixed ? '' : hexText(resolved)}
      placeholder={mixed ? 'Mixed' : (placeholder ?? '')}
      disabled={disabled}
      onDone={() => setOpen(false)}
      onCommit={(t) => parseHex(t) && onHex(t)}
    />
  );
}

/** Paint Row (desain bagian 06): grip drag saat hover, kotak (swatch + nilai), kotak opacity 52px, tombol hapus. */
function PaintRow({ swatch, value, opacity, extra, onRemove, disabled, removeTitle, drag, grip }: { swatch: ReactNode; value: ReactNode; opacity?: ReactNode; extra?: ReactNode; onRemove?: (() => void) | undefined; disabled: boolean; removeTitle?: string; drag?: DragProps | undefined; grip?: boolean }) {
  return (
    <div className={`dp-paint${drag?.over ? ' drop-over' : ''}`} {...(drag ? { draggable: !disabled, onDragStart: drag.onDragStart, onDragOver: drag.onDragOver, onDragLeave: drag.onDragLeave, onDrop: drag.onDrop, onDragEnd: drag.onDragEnd } : {})}>
      {grip && <Icon name="gripVertical" size={12} className="dp-grip" />}
      <div className="dp-paint-box">
        {swatch}
        <div className="dp-paint-value">{value}</div>
        {extra}
      </div>
      {opacity !== undefined && <div className="dp-paint-op">{opacity}<span className="dp-op-pct">%</span></div>}
      {onRemove && (
        <button type="button" className="dp-icon-btn" title={removeTitle ?? 'Remove'} aria-label={removeTitle ?? 'Remove'} disabled={disabled} onClick={onRemove}>
          <Icon name="minus" size={14} />
        </button>
      )}
    </div>
  );
}

type DragProps = {
  over: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
};

/** Input teks polos di dalam Paint Row (hex, opacity, shadow): Enter/blur commit, Escape batal. */
function InlineInput({ value, onCommit, disabled, placeholder, label, className, autoFocus, onDone }: { value: string; onCommit: (text: string) => void; disabled: boolean; placeholder?: string | undefined; label: string; className?: string; autoFocus?: boolean; onDone?: () => void }) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const cancelled = useRef(false);
  return (
    <input
      className={`dp-inline${className ? ` ${className}` : ''}`}
      value={draft ?? value}
      placeholder={placeholder}
      aria-label={label}
      disabled={disabled}
      spellCheck={false}
      autoFocus={autoFocus}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const text = e.currentTarget.value;
        const typed = draft !== undefined;
        setDraft(undefined);
        onDone?.();
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (typed && text !== value) onCommit(text);
      }}
    />
  );
}

/** Grup panel per judul (Override Marker per grup, epic komponen story 4). */
const TITLE_GROUP: Record<string, DesignGroup> = {
  Position: 'position',
  'Auto layout': 'autoLayout',
  Typography: 'typography',
  Icon: 'icon',
  Appearance: 'appearance',
  Fill: 'fill',
  Stroke: 'stroke',
  Effects: 'effects',
};
/** Target + antrean edit untuk Override Marker di header grup (tanpa mengubah tanda tangan tiap grup). */
const OverrideContext = createContext<Ctx | undefined>(undefined);

/**
 * Override Marker (desain X826b0): titik + "Overridden" + Reset, tampil bila salah satu target (instance/isi instance)
 * meng-override properti grup ini. Reset = satu permintaan `resetOverride(alamat, props grup)` per target.
 */
function OverrideMarker({ group }: { group: DesignGroup }) {
  const ctx = useContext(OverrideContext);
  if (!ctx) return null;
  const props = groupOverrides(ctx.targets, group);
  if (!props.length) return null;
  return (
    <div className="override-marker">
      <i className="override-dot" aria-hidden="true" />
      <span>{markerLabel(props)}</span>
      <button type="button" title="Reset to component" aria-label="Reset to component" disabled={ctx.disabled} onClick={() => ctx.run((ts) => resetGroupOps(ts, group), 'Reset override')}>
        <Icon name="rotateCcw" size={12} />
      </button>
    </div>
  );
}

function Group({ title, action, children, empty, summary }: { title: string; action?: ReactNode; children?: ReactNode; empty?: boolean; summary?: string }) {
  const key = TITLE_GROUP[title];
  return (
    <section className={`dp-group${empty ? ' empty' : ''}`}>
      <div className="dp-group-header">
        <h3>{title}</h3>
        {summary && (
          <span className="dp-group-summary" title={summary}>
            {summary}
          </span>
        )}
        {action}
      </div>
      {key && <OverrideMarker group={key} />}
      {children}
    </section>
  );
}

function HeaderButton({ icon, title, onClick, disabled }: { icon: IconName; title: string; onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" className="dp-header-btn" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={13} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Format/parse kolom
// ---------------------------------------------------------------------------

const num = (v: unknown) => (typeof v === 'number' ? formatNumber(v) : '');
const parseSize = (t: string) => parseNumber(t, { min: 0 });
const parsePositive = (t: string) => {
  const n = parseNumber(t);
  return n !== undefined && n > 0 ? n : undefined;
};
const hexText = (c: unknown) => splitHex(c)?.hex ?? '';
const alphaText = (c: unknown) => {
  const s = splitHex(c);
  return s ? formatPercent(s.alpha) : '';
};
/** Warna (literal atau resolve) → CSS swatch. */
const swatchCss = (c: unknown) => (typeof c === 'string' && splitHex(c) ? c : 'transparent');
const fillCss = (f: FillLike) => gradientLayerCss(f as never) ?? 'repeating-conic-gradient(#8080804d 0 25%, transparent 0 50%) 0 0 / 8px 8px';
const FILL_LABEL: Record<string, string> = { linear: 'Linear gradient', radial: 'Radial gradient', conic: 'Conic gradient', noise: 'Noise', mesh: 'Mesh gradient', image: 'Image' };

// ---------------------------------------------------------------------------
// Kelompok
// ---------------------------------------------------------------------------

/**
 * Grup Point mode edit titik path (desain J7AmQi/S8w37 "Group Point"): X/Y titik tunggal (px relatif kotak node), tipe
 * titik untuk semua titik terpilih, Delete point, Open path. Setiap aksi = satu commit lewat pathTools.tsx.
 */
function PointGroup({ edit, disabled }: { edit: PathEditPanel; disabled: boolean }) {
  const none = edit.selected === 0;
  const xy = (axis: 'x' | 'y') => (
    <Field
      label={axis.toUpperCase()}
      state={{ mixed: false, value: edit.point?.[axis], resolved: undefined }}
      format={num}
      parse={(t) => parseNumber(t)}
      placeholder={none ? '–' : edit.point ? undefined : 'Mixed'}
      disabled={disabled || !edit.point}
      onCommit={(v) => (axis === 'x' ? edit.setX(Number(v)) : edit.setY(Number(v)))}
    />
  );
  return (
    <Group title="Point">
      <div className="dp-row">
        {xy('x')}
        {xy('y')}
      </div>
      <Segmented<PointType>
        label="Point type"
        options={[
          { value: 'corner', label: 'Corner' },
          { value: 'smooth', label: 'Smooth' },
          { value: 'mirrored', label: 'Mirrored' },
        ]}
        active={(v) => edit.type === v}
        disabled={disabled || none}
        onPick={(t) => edit.setType(t)}
      />
      <div className="dp-row dp-point-actions">
        <button type="button" className="btn small" disabled={disabled || none} onClick={edit.remove}>
          <Icon name="trash" size={13} /> Delete point
        </button>
        <button type="button" className="btn small" disabled={disabled || !edit.canOpen} title={edit.canOpen ? undefined : 'Select one point with a segment after it'} onClick={edit.open}>
          <Icon name="scissors" size={13} /> Open path
        </button>
      </div>
    </Group>
  );
}

const SIZING_OPTIONS: { value: Sizing; label: string }[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'hug', label: 'Hug' },
  { value: 'fill', label: 'Fill' },
];
const BOARD_HEIGHT_SIZING: { value: Sizing; label: string }[] = SIZING_OPTIONS.slice(0, 2);

type AlignCtl = NonNullable<DesignPanelProps['align']>;

/** Tombol ikon yang membuka `Menu` di bawah dirinya sendiri (chip sizing, sides stroke, blend, "+", overflow align). */
function MenuButton({ icon, title, items, disabled, className, label }: { icon: IconName; title: string; items: () => Item[]; disabled: boolean; className?: string; label?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | undefined>(undefined);
  return (
    <>
      <button
        type="button"
        className={className ?? 'dp-icon-btn boxed'}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={pos !== undefined}
        disabled={disabled}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <Icon name={icon} size={13} />
        {label}
      </button>
      {pos && <Menu x={pos.x} y={pos.y} items={items()} onClose={() => setPos(undefined)} />}
    </>
  );
}

/** Chip sizing per sumbu di ujung field W/H (desain Position: "Fill ▾" dalam field) — menggantikan segmented Fixed/Hug/Fill. */
function SizingChip({ axis, mode, options, disabled, onPick }: { axis: Axis; mode: Sizing | undefined; options: readonly { value: Sizing; label: string }[]; disabled: boolean; onPick: (m: Sizing) => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | undefined>(undefined);
  const text = mode === undefined ? 'Mixed' : (options.find((o) => o.value === mode)?.label ?? 'Fixed');
  return (
    <>
      <button
        type="button"
        className="dp-chip"
        title={`${axis === 'width' ? 'Width' : 'Height'} sizing`}
        aria-label={`${axis === 'width' ? 'Width' : 'Height'} sizing`}
        aria-haspopup="menu"
        aria-expanded={pos !== undefined}
        disabled={disabled}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ x: r.left, y: r.bottom + 4 });
        }}
      >
        {text}
        <Icon name="chevronDown" size={10} />
      </button>
      {pos && (
        <Menu
          x={pos.x}
          y={pos.y}
          items={options.map((o) => ({
            label: o.label,
            checked: mode === o.value,
            run: () => {
              setPos(undefined);
              onPick(o.value);
            },
          }))}
          onClose={() => setPos(undefined)}
        />
      )}
    </>
  );
}

/**
 * Bilah Align & distribute di atas bagian Position (desain badge 1): 6 align + 2 distribute. Di panel sempit
 * (≤ 260px, E5) dua tombol distribute disembunyikan CSS dan masuk menu "···" — menyusut, bukan scroll.
 */
function AlignBar({ align, disabled }: { align: AlignCtl; disabled: boolean }) {
  const [more, setMore] = useState<{ x: number; y: number } | undefined>(undefined);
  const btn = (a: EditAction, cls = '') => (
    <button key={a} type="button" className={`dp-icon-btn${cls}`} title={actionTitle(a)} aria-label={ACTION_META[a].label} disabled={disabled || !align.enabled[a]} onClick={() => align.run(a)}>
      <Icon name={ACTION_META[a].icon} size={15} />
    </button>
  );
  return (
    <div className="dp-align-bar">
      {ALIGN_ACTIONS.map((a) => btn(a))}
      {DISTRIBUTE_ACTIONS.map((a) => btn(a, ' dp-align-dist'))}
      <button
        type="button"
        className="dp-icon-btn dp-align-more"
        title="More alignment actions"
        aria-label="More alignment actions"
        aria-haspopup="menu"
        aria-expanded={more !== undefined}
        disabled={disabled}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMore({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <Icon name="ellipsis" size={15} />
      </button>
      {more && (
        <Menu
          x={more.x}
          y={more.y}
          items={DISTRIBUTE_ACTIONS.map((a) => ({
            label: actionTitle(a),
            icon: ACTION_META[a].icon,
            disabled: !align.enabled[a],
            run: () => {
              setMore(undefined);
              align.run(a);
            },
          }))}
          onClose={() => setMore(undefined)}
        />
      )}
    </div>
  );
}

/**
 * Grid alignment 3×3 (desain Auto layout, E4): sel = align (baris) × justify (kolom), start/center/end. Klik
 * menulis kedua properti dalam satu commit; nilai lain (stretch, space-between) tidak punya sel aktif.
 */
function AlignGrid({ targets, ctx }: { targets: DesignTarget[]; ctx: Ctx }) {
  const align = readField(targets, (n) => n.align ?? 'start');
  const justify = readField(targets, (n) => n.justify ?? 'start');
  const AXES = ['start', 'center', 'end'] as const;
  const on = (a: string, j: string) => !align.mixed && !justify.mixed && align.value === a && justify.value === j;
  return (
    <div className="dp-agrid" role="group" aria-label="Alignment">
      {AXES.map((a) =>
        AXES.map((j) => (
          <button
            key={`${a}-${j}`}
            type="button"
            className={`dp-agrid-cell${on(a, j) ? ' active' : ''}`}
            aria-label={`Align ${a}, justify ${j}`}
            aria-pressed={on(a, j)}
            disabled={ctx.disabled}
            onClick={() => ctx.run((ts) => opsFor(ts, () => ({ align: a, justify: j })), 'Change alignment')}
          />
        )),
      )}
    </div>
  );
}

function PositionGroup({ targets, ctx, bounds, align }: { targets: DesignTarget[]; ctx: Ctx; bounds: [number, number, number, number] | undefined; align: AlignCtl | undefined }) {
  const xyEditable = targets.every(canEditXY);
  const board = targets.every((t) => t.type === 'board');
  const icon = targets.every((t) => t.type === 'icon');
  const xy = (axis: 'x' | 'y', i: 0 | 1) => {
    const state: FieldState = xyEditable
      ? readField(targets, (n) => n[axis] ?? 0)
      : { mixed: false, value: targets.length === 1 && bounds ? bounds[i] : undefined, resolved: undefined };
    return (
      <Field
        label={axis.toUpperCase()}
        state={state}
        format={num}
        parse={(t) => parseNumber(t)}
        placeholder="–"
        disabled={ctx.disabled || !xyEditable}
        title={xyEditable ? undefined : 'Position comes from the parent auto layout'}
        scrub={{ step: 1 }}
        onCommit={(v) => ctx.run((ts) => setProp(ts, axis, Math.round(Number(v))), `Change ${axis.toUpperCase()}`)}
      />
    );
  };
  // Field W/H + chip sizing per sumbu di ujung kanan (desain: "W 1440 · Fill ▾"), menggantikan segmented Fixed/Hug/Fill.
  const dim = (axis: Axis) => {
    const label = axis === 'width' ? 'W' : 'H';
    const state = readField(targets, (n) => n[axis]);
    const mode = readSizing(targets, axis);
    const measured = targets.length === 1 ? targets[0]!.measured?.[axis === 'width' ? 'w' : 'h'] : undefined;
    const numeric: FieldState = state.mixed || typeof state.value === 'number' || isTokenRef(state.value) ? state : { mixed: false, value: undefined, resolved: undefined };
    return (
      <div className="dp-row">
        <Field
          label={label}
          state={numeric}
          format={num}
          parse={parseSize}
          placeholder={measured !== undefined ? formatNumber(measured) : mode === 'fill' ? 'Fill' : 'Hug'}
          disabled={ctx.disabled}
          scrub={{ step: 1, min: 0, base: measured }}
          token={{ spec: propSpec(axis, axis === 'width' ? 'Width' : 'Height'), ctx }}
          trailing={
            /* Board: hanya tinggi yang bisa Hug (v8, spec-board-hug-height); lebar board selalu angka, tanpa Fill. */
            (!board || axis === 'height') && (
              <SizingChip axis={axis} mode={mode} options={board ? BOARD_HEIGHT_SIZING : SIZING_OPTIONS} disabled={ctx.disabled} onPick={(m) => ctx.run((ts) => setSizing(ts, axis, m), `Change ${axis} sizing`)} />
            )
          }
          onCommit={(v) => ctx.run((ts) => setProp(ts, axis, Math.round(Number(v) * 100) / 100), `Change ${axis}`)}
        />
      </div>
    );
  };
  return (
    <Group title="Position">
      {align && <AlignBar align={align} disabled={ctx.disabled} />}
      <div className="dp-row">
        {xy('x', 0)}
        {xy('y', 1)}
      </div>
      {!icon && dim('width')}
      {!icon && dim('height')}
    </Group>
  );
}

function AutoLayoutGroup({ targets, ctx }: { targets: DesignTarget[]; ctx: Ctx }) {
  const dir = readField(targets, layoutOf);
  const layout = dir.mixed ? undefined : (dir.value as 'none' | 'row' | 'column' | 'grid');
  const grid = layout === 'grid';
  const on = layout === 'row' || layout === 'column' || grid;
  const wrap = readField(targets, (n) => n.wrap === true);
  const wrapOn = !wrap.mixed && wrap.value === true;
  const align = readField(targets, (n) => n.align ?? 'start');
  const stretched = !align.mixed && align.value === 'stretch';
  // Independent padding: tuple 4 sisi membuka mode ini otomatis (E4); toggle square-dashed di ujung baris Pad.
  const padRaw = readField(targets, (n) => n.padding);
  const pad4 = !padRaw.mixed && Array.isArray(padRaw.value) && (padRaw.value as unknown[]).length === 4;
  const [padInd, setPadInd] = useState(pad4);
  useEffect(() => {
    if (pad4) setPadInd(true);
  }, [pad4]);
  const axisGap = (key: 'columnGap' | 'rowGap', label: string, icon: IconName, hint?: string, gapDisabled?: boolean) => (
    <Field
      label={label}
      icon={icon}
      state={readField(targets, (n) => axisGapOf(n, key))}
      format={num}
      parse={parseSize}
      scrub={{ step: 1, min: 0 }}
      disabled={ctx.disabled || gapDisabled === true}
      {...(hint ? { hint } : {})}
      onCommit={(v) => ctx.run((ts) => setProp(ts, key, v), `Change ${label.toLowerCase()}`)}
      token={{ spec: propSpec(key, label, (n) => axisGapOf(n, key)), ctx }}
    />
  );
  // Padding per sumbu (Pad H/V); mode independent menampilkan 4 sisi T/R/B/L (tuple [t,r,b,l]).
  const padAxis = (axis: PadAxis, icon: IconName, label: string) => (
    <Field
      label={label}
      icon={icon}
      title={label}
      state={paddingAxisState(targets, axis)}
      format={num}
      parse={parseSize}
      scrub={{ step: 1, min: 0 }}
      disabled={ctx.disabled}
      onCommit={(v) => ctx.run((ts) => setPaddingAxis(ts, axis, v), 'Change padding')}
      token={{ spec: paddingAxisSpec(axis, label), ctx }}
    />
  );
  const PAD_EDGES: { label: string; icon: IconName }[] = [
    { label: 'Top padding', icon: 'arrowUp' },
    { label: 'Right padding', icon: 'arrowRight' },
    { label: 'Bottom padding', icon: 'arrowDown' },
    { label: 'Left padding', icon: 'arrowLeft' },
  ];
  const justify = <SelectField ariaLabel="Justify" state={readField(targets, (n) => n.justify ?? 'start')} options={JUSTIFY_OPTIONS} disabled={ctx.disabled} onPick={(v) => ctx.run((ts) => setProp(ts, 'justify', v), 'Change justify')} />;
  const padRow = (
    <>
      <div className="dp-row">
        {padAxis('h', 'moveHorizontal', 'Horizontal padding')}
        {padAxis('v', 'moveVertical', 'Vertical padding')}
        <button
          type="button"
          className={`dp-icon-btn boxed${padInd ? ' filled' : ''}`}
          title="Independent padding"
          aria-label="Independent padding"
          aria-pressed={padInd}
          disabled={ctx.disabled}
          onClick={() => setPadInd((p) => !p)}
        >
          <Icon name="squareDashed" size={13} />
        </button>
      </div>
      {padInd && (
        <div className="dp-row dp-pad4">
          {PAD_EDGES.map((e, i) => (
            <Field key={e.label} label={e.label} icon={e.icon} title={e.label} state={readField(targets, (n) => paddingEdgeOf(n, i))} format={num} parse={parseSize} scrub={{ step: 1, min: 0 }} disabled={ctx.disabled} onCommit={(v) => ctx.run((ts) => setPaddingEdge(ts, i, v), 'Change padding')} token={{ spec: paddingEdgeSpec(i, e.label), ctx }} />
          ))}
        </div>
      )}
    </>
  );
  return (
    <Group
      title="Auto layout"
      action={
        on ? (
          <HeaderButton icon="minus" title="Remove auto layout" disabled={ctx.disabled} onClick={() => ctx.run((ts) => setLayout(ts, null), 'Remove auto layout')} />
        ) : (
          <HeaderButton icon="plus" title="Add auto layout" disabled={ctx.disabled} onClick={() => ctx.run((ts) => setLayout(ts, 'column'), 'Add auto layout')} />
        )
      }
    >
      {/* Arah (desain badge 2): 3 ikon — vertical/horizontal/grid; keluar dari auto layout lewat "−" di header. */}
      <div className="dp-row">
        <Segmented<'row' | 'column' | 'grid'>
          label="Direction"
          className="dp-grow"
          options={[
            { value: 'column', icon: 'arrowDown', title: 'Vertical' },
            { value: 'row', icon: 'arrowRight', title: 'Horizontal' },
            { value: 'grid', icon: 'layoutGrid', title: 'Grid' },
          ]}
          value={layout === 'none' ? undefined : layout}
          disabled={ctx.disabled}
          onPick={(v) => ctx.run((ts) => (v === 'grid' ? enterGrid(ts) : setLayout(ts, v)), 'Change layout direction')}
        />
        {/* Wrap (v9): toggle terpisah, hanya flex. Stretch = align stretch container (desain badge 2). */}
        {!grid && (on || dir.mixed) && (
          <button
            type="button"
            className={`dp-icon-btn boxed${wrapOn ? ' filled' : ''}`}
            title="Wrap"
            aria-label="Wrap"
            aria-pressed={wrapOn}
            disabled={ctx.disabled}
            onClick={() => ctx.run((ts) => setProp(ts, 'wrap', wrapOn ? null : true), 'Change wrap')}
          >
            <Icon name="wrapText" size={13} />
          </button>
        )}
        {on && (
          <button
            type="button"
            className={`dp-icon-btn boxed${stretched ? ' filled' : ''}`}
            title="Stretch"
            aria-label="Stretch"
            aria-pressed={stretched}
            disabled={ctx.disabled}
            onClick={() => ctx.run((ts) => setProp(ts, 'align', stretched ? 'start' : 'stretch'), 'Change align')}
          >
            <Icon name="stretchVertical" size={13} />
          </button>
        )}
      </div>
      {(on || dir.mixed) && (
        <div className="dp-row dp-auto-grid">
          <AlignGrid targets={targets} ctx={ctx} />
          <div className="dp-col">
            {grid ? axisGap('columnGap', 'Column gap', 'betweenHorizontalStart') : <Field label="Gap" icon={layout === 'row' ? 'betweenHorizontalStart' : 'betweenVerticalStart'} state={readField(targets, (n) => n.gap ?? 0)} format={num} parse={(t) => parseNumber(t)} scrub={{ step: 1 }} disabled={ctx.disabled} onCommit={(v) => ctx.run((ts) => setProp(ts, 'gap', v), 'Change gap')} token={{ spec: propSpec('gap', 'Gap', (n) => n.gap ?? 0), ctx }} />}
            {axisGap('rowGap', 'Row gap', 'betweenVerticalStart', !grid && !wrapOn ? 'wrap only' : undefined, !grid && !wrapOn)}
            {justify}
          </div>
        </div>
      )}
      {grid && (
        <div className="dp-row">
          <Field
            label="Columns"
            state={readField(targets, (n) => Math.max(1, trackCount(n, 'gridTemplateColumns')))}
            format={num}
            parse={parseColumnCount}
            scrub={{ step: 0.1, min: 1, max: GRID_TRACKS_MAX, toValue: Math.round }}
            disabled={ctx.disabled}
            onCommit={(v) => ctx.run((ts) => setTrackCount(ts, 'gridTemplateColumns', v as number), 'Change grid columns')}
          />
          <Field
            label="Rows"
            state={readField(targets, (n) => trackCount(n, 'gridTemplateRows'))}
            format={formatRowCount}
            parse={parseRowCount}
            placeholder="Auto"
            disabled={ctx.disabled}
            onCommit={(v) => ctx.run((ts) => setTrackCount(ts, 'gridTemplateRows', v as number), 'Change grid rows')}
          />
        </div>
      )}
      {(on || dir.mixed) && padRow}
    </Group>
  );
}

/** Paint row warna tunggal (warna teks/ikon/stroke/shadow): swatch picker, hex, alpha. */
function ColorRow({
  state,
  onColor,
  disabled,
  onRemove,
  removeTitle,
  value,
  placeholder,
  token,
}: {
  /** Slot token warna (story 4): ref = pill + Detach (opacity disembunyikan), literal = tombol token. */
  token?: { spec: TokenSpec; ctx: Ctx } | undefined;
  state: FieldState;
  /** Warna baru lengkap `#RRGGBB[AA]` (alpha lama sudah dipertahankan pemanggil bila perlu). */
  onColor: (next: { hex?: string; alpha?: number }) => void;
  disabled: boolean;
  onRemove?: (() => void) | undefined;
  removeTitle?: string;
  value?: ReactNode;
  placeholder?: string;
}) {
  const resolved = state.mixed ? undefined : state.resolved;
  const ref = token && refAt(state) !== undefined;
  return (
    <PaintRow
      disabled={disabled}
      onRemove={onRemove}
      {...(removeTitle ? { removeTitle } : {})}
      swatch={<Swatch background={swatchCss(resolved)} disabled={disabled} title="Pick color" pick={(hex) => onColor({ hex })} />}
      value={value ?? <ColorValue label="Hex color" stored={state.mixed ? undefined : state.value} resolved={resolved} mixed={state.mixed} placeholder={placeholder} disabled={disabled} onHex={(hex) => onColor({ hex })} token={token} />}
      extra={token && !ref ? <TokenButton spec={token.spec} ctx={token.ctx} disabled={disabled} /> : undefined}
      opacity={ref ? undefined : <InlineInput label="Opacity" className="dp-opacity" value={state.mixed ? '' : alphaText(resolved)} disabled={disabled || state.mixed || !splitHex(resolved)} onCommit={(t) => { const a = parsePercent(t); if (a !== undefined) onColor({ alpha: a }); }} />}
    />
  );
}

function TypographyGroup({ targets, ctx, fonts }: { targets: DesignTarget[]; ctx: Ctx; fonts: FontFamily[] }) {
  const family = readField(targets, (n) => n.family ?? 'Inter');
  const famName = !family.mixed && typeof family.resolved === 'string' ? family.resolved : undefined;
  const famEntry = fonts.find((f) => f.family.toLowerCase() === famName?.toLowerCase());
  const familyOptions = fonts.map((f) => [f.family, f.family] as const);
  const weights = famEntry?.weights.length ? famEntry.weights : ALL_WEIGHTS;
  const weightOptions = weights.map((w) => [String(w), `${WEIGHT_NAMES[w] ?? w}`] as const);
  const weight = readField(targets, (n) => n.weight ?? 400);
  const weightState: FieldState = weight.mixed || isTokenRef(weight.value) ? weight : { mixed: false, value: String(weight.value), resolved: weight.resolved };
  const align = readField(targets, (n) => n.align ?? 'left');
  const color = readField(targets, (n) => n.color);
  return (
    <Group title="Typography">
      <div className="dp-row">
        <SelectField state={family} options={familyOptions} className="dp-grow" disabled={ctx.disabled} onPick={(v) => ctx.run((ts) => setProp(ts, 'family', v), 'Change font family')} token={{ spec: propSpec('family', 'Font family', (n) => n.family ?? 'Inter'), ctx }} />
      </div>
      <div className="dp-row">
        <SelectField state={weightState} options={weightOptions} className="dp-grow" disabled={ctx.disabled} onPick={(v) => ctx.run((ts) => setProp(ts, 'weight', Number(v)), 'Change font weight')} token={{ spec: propSpec('weight', 'Font weight', (n) => n.weight ?? 400), ctx }} />
        <Field className="dp-w96" label="Size" state={readField(targets, (n) => n.size)} format={num} parse={parsePositive} scrub={{ step: 1, min: 1 }} disabled={ctx.disabled} onCommit={(v) => ctx.run((ts) => setProp(ts, 'size', v), 'Change font size')} token={{ spec: propSpec('size', 'Font size'), ctx }} />
      </div>
      <div className="dp-row">
        <Field label="Line height" state={readField(targets, (n) => n.lineHeight)} format={num} parse={parsePositive} placeholder="Auto" scrub={{ step: 1, min: 1 }} disabled={ctx.disabled} onCommit={(v) => ctx.run((ts) => setProp(ts, 'lineHeight', v), 'Change line height')} token={{ spec: propSpec('lineHeight', 'Line height'), ctx }} />
        <Field
          label="Letter spacing"
          title="Letter spacing as a fraction of the font size (em)"
          state={readField(targets, (n) => n.letterSpacing ?? 0)}
          format={num}
          parse={(t) => parseNumber(t)}
          scrub={{ step: 0.01 }}
          disabled={ctx.disabled}
          onCommit={(v) => ctx.run((ts) => setProp(ts, 'letterSpacing', v), 'Change letter spacing')}
          token={{ spec: propSpec('letterSpacing', 'Letter spacing', (n) => n.letterSpacing ?? 0), ctx }}
        />
      </div>
      <div className="dp-row">
        <Segmented<'left' | 'center' | 'right' | 'justify'>
          label="Text align"
          className="dp-grow"
          options={[
            { value: 'left', icon: 'textAlignStart', title: 'Align left' },
            { value: 'center', icon: 'textAlignCenter', title: 'Align center' },
            { value: 'right', icon: 'textAlignEnd', title: 'Align right' },
            { value: 'justify', icon: 'textAlignJustify', title: 'Justify' },
          ]}
          value={align.mixed ? undefined : (align.value as 'left')}
          disabled={ctx.disabled}
          onPick={(v) => ctx.run((ts) => setProp(ts, 'align', v), 'Change text align')}
        />
      </div>
      <ColorRow
        state={color}
        token={{ spec: propSpec('color', 'Color'), ctx }}
        placeholder="Default"
        disabled={ctx.disabled}
        onColor={(c) => {
          const next = changeColor(color.mixed ? undefined : color.resolved, c);
          if (next) ctx.run((ts) => setProp(ts, 'color', next), 'Change text color');
        }}
      />
    </Group>
  );
}

function IconGroup({ targets, ctx }: { targets: DesignTarget[]; ctx: Ctx }) {
  const color = readField(targets, (n) => n.color);
  return (
    <Group title="Icon">
      <div className="dp-row">
        <Field label="Size" state={readField(targets, (n) => n.size)} format={num} parse={parsePositive} scrub={{ step: 1, min: 1 }} disabled={ctx.disabled} onCommit={(v) => ctx.run((ts) => setProp(ts, 'size', v), 'Change icon size')} token={{ spec: propSpec('size', 'Icon size'), ctx }} />
      </div>
      <ColorRow
        state={color}
        token={{ spec: propSpec('color', 'Color'), ctx }}
        placeholder="Default"
        disabled={ctx.disabled}
        onColor={(c) => {
          const next = changeColor(color.mixed ? undefined : color.resolved, c);
          if (next) ctx.run((ts) => setProp(ts, 'color', next), 'Change icon color');
        }}
      />
    </Group>
  );
}

/** Editor sebaris fill (klik swatch): jenis Solid/Linear/Radial, sudut, stop. */
function FillEditor({ index, fill, resolved, ctx }: { index: number; fill: FillLike; resolved: FillLike; ctx: Ctx }) {
  const kind = fill.type === 'solid' || fill.type === 'linear' || fill.type === 'radial' ? (fill.type as PaintKind) : undefined;
  const stops = Array.isArray(fill.stops) ? (fill.stops as Raw[]) : [];
  const rStops = Array.isArray(resolved.stops) ? (resolved.stops as Raw[]) : stops;
  const edit = (fn: (f: FillLike, r: FillLike) => FillLike | undefined, label: string) => ctx.run((ts) => editFill(ts, index, fn), label);
  return (
    <div className="dp-fill-editor">
      <Segmented<PaintKind>
        label="Fill type"
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'linear', label: 'Linear' },
          { value: 'radial', label: 'Radial' },
        ]}
        value={kind}
        disabled={ctx.disabled || !kind}
        onPick={(k) => edit((f, r) => convertFill(f, r, k), 'Change fill type')}
      />
      {fill.type === 'solid' && (
        <PaintRow
          disabled={ctx.disabled}
          swatch={<Swatch background={swatchCss(resolved.color)} title="Pick color" disabled={ctx.disabled} pick={(hex) => edit((f, r) => solidColor(f, r, hex), 'Change fill')} />}
          value={<ColorValue label="Fill color" stored={fill.color} resolved={resolved.color} disabled={ctx.disabled} onHex={(hex) => edit((f, r) => solidColor(f, r, hex), 'Change fill')} token={{ spec: fillColorSpec(index), ctx }} />}
          extra={isTokenRef(fill.color) ? undefined : <TokenButton spec={fillColorSpec(index)} ctx={ctx} />}
        />
      )}
      {fill.type === 'linear' && (
        <div className="dp-row">
          <Field
            label="Angle"
            state={{ mixed: false, value: fill.angle, resolved: fill.angle }}
            format={num}
            parse={(t) => parseNumber(t.replace(/°$/, ''))}
            scrub={{ step: 1 }}
            disabled={ctx.disabled}
            onCommit={(v) => edit((f) => ({ ...f, angle: v }), 'Change gradient angle')}
          />
        </div>
      )}
      {stops.map((s, k) => (
        <PaintRow
          key={k}
          disabled={ctx.disabled}
          swatch={<Swatch background={swatchCss(rStops[k]?.color)} title="Pick stop color" disabled={ctx.disabled} pick={(hex) => edit((f, r) => editStop(f, r, k, { hex }), 'Change gradient stop')} />}
          value={<ColorValue label="Stop color" stored={s.color} resolved={rStops[k]?.color} disabled={ctx.disabled} onHex={(hex) => edit((f, r) => editStop(f, r, k, { hex }), 'Change gradient stop')} token={{ spec: stopColorSpec(index, k), ctx }} />}
          extra={isTokenRef(s.color) ? undefined : <TokenButton spec={stopColorSpec(index, k)} ctx={ctx} />}
          opacity={
            <InlineInput
              label="Stop position"
              className="dp-opacity"
              value={typeof s.offset === 'number' ? formatPercent(s.offset) : ''}
              disabled={ctx.disabled}
              onCommit={(t) => {
                const n = parseNumber(t.replace(/%$/, ''));
                if (n !== undefined) edit((f, r) => editStop(f, r, k, { offset: n / 100 }), 'Change gradient stop');
              }}
            />
          }
        />
      ))}
    </div>
  );
}

function FillGroup({ targets, ctx }: { targets: DesignTarget[]; ctx: Ctx }) {
  const all = readField(targets, (n) => n.fills);
  const [open, setOpen] = useState<number | undefined>(undefined);
  const [drag, setDrag] = useState<{ from: number; over?: number } | undefined>(undefined);
  const add = <HeaderButton icon="plus" title="Add fill" disabled={ctx.disabled} onClick={() => ctx.run((ts) => addFill(ts), 'Add fill')} />;
  if (all.mixed) {
    return (
      <Group title="Fill" action={add}>
        {/* Baris "Mixed fills" (E2): swatch stripe, nilai redup; klik swatch tetap memilih satu solid untuk semua. */}
        <PaintRow
          disabled={ctx.disabled}
          onRemove={() => ctx.run((ts) => setAllFills(ts, null), 'Remove fills')}
          removeTitle="Remove fills"
          swatch={
            <Swatch
              background=""
              mixed
              title="Pick color"
              disabled={ctx.disabled}
              pick={(hex) => {
                const next = changeColor(undefined, { hex });
                if (next) ctx.run((ts) => setAllFills(ts, [{ type: 'solid', color: next }]), 'Change fill');
              }}
            />
          }
          value={<span className="dp-muted">Mixed fills</span>}
        />
      </Group>
    );
  }
  const rows = fillRows(targets[0]!);
  return (
    <Group title="Fill" action={add} empty={rows.length === 0}>
      {rows.map(({ index, fill, resolved }) => {
        const dragProps: DragProps = {
          over: drag?.over === index && drag.from !== index,
          onDragStart: (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
            setDrag({ from: index });
          },
          onDragOver: (e) => {
            if (!drag) return;
            e.preventDefault();
            if (drag.over !== index) setDrag({ ...drag, over: index });
          },
          onDragLeave: () => drag && setDrag({ from: drag.from }),
          onDrop: (e) => {
            e.preventDefault();
            if (drag && drag.from !== index) {
              setOpen(undefined);
              ctx.run((ts) => moveFill(ts, drag.from, index), 'Reorder fills');
            }
            setDrag(undefined);
          },
          onDragEnd: () => setDrag(undefined),
        };
        const remove = () => {
          setOpen(undefined);
          ctx.run((ts) => removeFill(ts, index), 'Remove fill');
        };
        const toggle = () => setOpen((o) => (o === index ? undefined : index));
        const isSolid = fill.type === 'solid';
        const editable = isSolid || fill.type === 'linear' || fill.type === 'radial';
        const label =
          fill.type === 'image' ? `Image · ${String(fill.fit ?? '')}` : FILL_LABEL[String(fill.type)] ?? String(fill.type);
        return (
          <div key={index} className="dp-fill">
            <PaintRow
              drag={dragProps}
              grip
              disabled={ctx.disabled}
              onRemove={remove}
              removeTitle="Remove fill"
              swatch={<Swatch background={isSolid ? swatchCss(resolved.color) : fillCss(resolved)} title={editable ? 'Edit fill' : label} disabled={!editable} onClick={toggle} />}
              value={
                isSolid ? (
                  <ColorValue label="Hex color" stored={fill.color} resolved={resolved.color} disabled={ctx.disabled} onHex={(hex) => ctx.run((ts) => editFill(ts, index, (f, r) => solidColor(f, r, hex)), 'Change fill')} token={{ spec: fillColorSpec(index), ctx }} />
                ) : (
                  <span className="dp-muted">{label}</span>
                )
              }
              extra={isSolid && !isTokenRef(fill.color) ? <TokenButton spec={fillColorSpec(index)} ctx={ctx} /> : undefined}
              opacity={
                isSolid && isTokenRef(fill.color) ? undefined : isSolid ? (
                  <InlineInput
                    label="Fill opacity"
                    className="dp-opacity"
                    value={alphaText(resolved.color)}
                    disabled={ctx.disabled}
                    onCommit={(t) => {
                      const a = parsePercent(t);
                      if (a !== undefined) ctx.run((ts) => editFill(ts, index, (f, r) => solidAlpha(f, r, a)), 'Change fill opacity');
                    }}
                  />
                ) : (
                  <span className="dp-muted">100</span>
                )
              }
            />
            {open === index && editable && <FillEditor index={index} fill={fill} resolved={resolved} ctx={ctx} />}
          </div>
        );
      })}
      {rows.length > 0 && isVectorSelection(targets) && (
        <SelectField
          label="Fill rule"
          state={readField(targets, (n) => vectorValue(n, 'fillRule'))}
          options={[
            ['nonzero', 'Nonzero'],
            ['evenodd', 'Evenodd'],
          ]}
          disabled={ctx.disabled}
          onPick={(v) => ctx.run((ts) => setVector(ts, 'fillRule', v), 'Change fill rule')}
        />
      )}
    </Group>
  );
}

/**
 * Bagian Stroke (desain badge 5): baris paint, lalu satu baris — select posisi (Inside/Center/Outside, menggantikan
 * segmented), field lebar, sides sebagai tombol menu (non-vektor; disabled pada path, E3), dan tombol settings yang
 * membuka blok lanjutan Cap/Join/Dash/Miter (hanya path). Settings disabled pada non-vektor.
 */
function StrokeGroup({ targets, ctx }: { targets: DesignTarget[]; ctx: Ctx }) {
  const has = targets.every((t) => t.stored.stroke !== undefined);
  const any = targets.some((t) => t.stored.stroke !== undefined);
  const color = readField(targets, (n) => (n.stroke as Raw | undefined)?.color);
  const width = readField(targets, (n) => (n.stroke as Raw | undefined)?.width);
  const align = readField(targets, (n) => (n.stroke as Raw | undefined)?.align);
  const sides = readField(targets, (n) => strokeSides(n.stroke));
  const vector = isVectorSelection(targets);
  const [adv, setAdv] = useState(false);
  const sideActive = (s: Side) => !sides.mixed && (sides.value as Side[]).includes(s);
  return (
    <Group
      title="Stroke"
      empty={!any}
      action={!has && <HeaderButton icon="plus" title="Add stroke" disabled={ctx.disabled} onClick={() => ctx.run((ts) => addStroke(ts), 'Add stroke')} />}
    >
      {any && (
        <>
          <ColorRow
            state={color}
            token={{ spec: strokeSpec('color', 'Stroke color'), ctx }}
            disabled={ctx.disabled || !has}
            onRemove={() => ctx.run((ts) => removeStroke(ts), 'Remove stroke')}
            removeTitle="Remove stroke"
            onColor={(c) => {
              const hex = c.hex;
              if (hex !== undefined) return ctx.run((ts) => strokeColor(ts, hex), 'Change stroke color');
              const next = changeColor(color.mixed ? undefined : color.resolved, c);
              if (next) ctx.run((ts) => setStroke(ts, { color: next }), 'Change stroke opacity');
            }}
          />
          <div className="dp-row">
            <SelectField
              ariaLabel="Stroke position"
              className="dp-grow"
              state={align}
              options={[
                ['inside', 'Inside'],
                ['center', 'Center'],
                ['outside', 'Outside'],
              ]}
              disabled={ctx.disabled || !has}
              onPick={(v) => ctx.run((ts) => setStroke(ts, { align: v }), 'Change stroke align')}
            />
            <Field className="dp-w64" label="W" state={width} format={num} parse={parseSize} scrub={{ step: 1, min: 0 }} disabled={ctx.disabled || !has} onCommit={(v) => ctx.run((ts) => setStroke(ts, { width: v }), 'Change stroke width')} token={{ spec: strokeSpec('width', 'Stroke width'), ctx }} />
            <MenuButton
              icon="square"
              title="Stroke sides"
              disabled={ctx.disabled || !has || vector}
              items={() =>
                SIDES.map((s) => ({
                  label: `${s[0]!.toUpperCase()}${s.slice(1)}`,
                  icon: `panel${s[0]!.toUpperCase()}${s.slice(1)}` as IconName,
                  checked: sideActive(s) ? true : undefined,
                  run: () => ctx.run((ts) => toggleSide(ts, s), 'Change stroke sides'),
                }))
              }
            />
            <button
              type="button"
              className={`dp-icon-btn boxed${adv ? ' filled' : ''}`}
              title={vector ? 'Stroke settings' : 'Stroke settings (paths only)'}
              aria-label="Stroke settings"
              aria-expanded={adv}
              disabled={ctx.disabled || !has || !vector}
              onClick={() => setAdv((a) => !a)}
            >
              <Icon name="settings2" size={13} />
            </button>
          </div>
          {vector && adv && <StrokeAdvanced targets={targets} ctx={ctx} disabled={ctx.disabled || !has} />}
        </>
      )}
    </Group>
  );
}

/** Blok lanjutan stroke path (desain E3): select Cap/Join, field Dash (ikon ellipsis) + Miter, strip pratinjau dash. */
function StrokeAdvanced({ targets, ctx, disabled }: { targets: DesignTarget[]; ctx: Ctx; disabled: boolean }) {
  const cap = readField(targets, (n) => vectorValue(n, 'strokeLinecap'));
  const join = readField(targets, (n) => vectorValue(n, 'strokeLinejoin'));
  const dash = readField(targets, (n) => n.strokeDasharray);
  const miter = readField(targets, (n) => vectorValue(n, 'strokeMiterlimit'));
  const dashText = dash.mixed ? '' : formatDash(dash.resolved ?? dash.value);
  return (
    <div className="dp-stroke-adv">
      <div className="dp-row">
        <SelectField label="Cap" className="dp-grow" state={cap} options={[['butt', 'Butt'], ['round', 'Round'], ['square', 'Square']]} disabled={disabled} onPick={(v) => ctx.run((ts) => setVector(ts, 'strokeLinecap', v), 'Change stroke cap')} />
        <SelectField label="Join" className="dp-grow" state={join} options={[['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']]} disabled={disabled} onPick={(v) => ctx.run((ts) => setVector(ts, 'strokeLinejoin', v), 'Change stroke join')} />
      </div>
      <div className="dp-row">
        <Field
          className="dp-grow"
          label="Dash"
          icon="ellipsis"
          title="Dash pattern in px, e.g. 4 2"
          placeholder="None"
          state={dash}
          format={formatDash}
          parse={parseDash}
          disabled={disabled}
          onCommit={(v) => ctx.run((ts) => setVector(ts, 'strokeDasharray', v), 'Change stroke dash')}
        />
        <Field
          className="dp-grow"
          label="Miter"
          title="Miter limit"
          state={miter}
          format={num}
          parse={parseMiter}
          scrub={{ step: 0.1, min: 1, max: MITER_MAX }}
          disabled={disabled}
          onCommit={(v) => ctx.run((ts) => setVector(ts, 'strokeMiterlimit', v), 'Change miter limit')}
        />
      </div>
      {/* Strip pratinjau dash 20px (desain E3): garis `strokeDasharray` sesuai nilai field. */}
      <svg className="dp-dashline" aria-hidden="true" height="4" width="100%">
        <line x1="0" y1="2" x2="100%" y2="2" strokeDasharray={dashText || 'none'} />
      </svg>
    </div>
  );
}

/**
 * Bagian Appearance (desain badge 3): Opacity + Radius satu baris; blend mode = tombol droplet di header
 * (menampilkan mode aktif); toggle scan membuka 4 sudut radius (tuple, "Mixed" bila beda). Radius hanya untuk
 * tipe dengan `radius` di skema (frame/rect — RADIUS_TYPES); opacity/blend untuk semua tipe.
 */
function AppearanceGroup({ targets, ctx }: { targets: DesignTarget[]; ctx: Ctx }) {
  const blend = readField(targets, (n) => n.blend ?? 'normal');
  const blendText = blend.mixed ? 'Mixed' : (BLEND_OPTIONS.find(([v]) => v === blend.value)?.[1] ?? 'Normal');
  const canRadius = targets.every((t) => RADIUS_TYPES.has(t.type));
  const raw = readField(targets, (n) => n.radius);
  const resolvedAll = raw.mixed ? undefined : radiusAll(raw.resolved);
  const storedAll = raw.mixed ? undefined : radiusAll(raw.value);
  const allState: FieldState =
    raw.mixed || !storedAll || storedAll.mixed ? { mixed: true } : { mixed: false, value: storedAll.value ?? 0, resolved: resolvedAll && !resolvedAll.mixed ? resolvedAll.value : storedAll.value };
  const tuple = !raw.mixed && Array.isArray(raw.value);
  const [corners, setCorners] = useState(tuple);
  useEffect(() => {
    if (tuple) setCorners(true);
  }, [tuple]);
  const corner = (i: number): FieldState => {
    if (raw.mixed) return { mixed: true };
    const s = Array.isArray(raw.value) ? raw.value[i] : (raw.value ?? 0);
    const r = Array.isArray(raw.resolved) ? raw.resolved[i] : (raw.resolved ?? 0);
    return { mixed: false, value: s, resolved: r };
  };
  const CORNER_ICON: readonly IconName[] = ['arrowUpLeft', 'arrowUpRight', 'arrowDownRight', 'arrowDownLeft'];
  return (
    <Group
      title="Appearance"
      action={
        <MenuButton
          icon="droplet"
          className="dp-header-btn"
          title={`Blend mode: ${blendText}`}
          disabled={ctx.disabled}
          items={() =>
            BLEND_OPTIONS.map(([v, l]) => ({
              label: l,
              checked: !blend.mixed && blend.value === v,
              run: () => ctx.run((ts) => setProp(ts, 'blend', v), 'Change blend mode'),
            }))
          }
        />
      }
    >
      <div className="dp-row">
        <Field
          label="Opacity"
          className="dp-grow"
          state={readField(targets, (n) => n.opacity ?? 1)}
          format={(v) => (typeof v === 'number' ? formatPercent(v) : '')}
          parse={parsePercent}
          scrub={{ step: 0.01, min: 0, max: 1 }}
          disabled={ctx.disabled}
          onCommit={(v) => ctx.run((ts) => setProp(ts, 'opacity', v), 'Change opacity')}
        />
        {canRadius && (
          <Field
            label="Radius"
            className="dp-grow"
            state={allState}
            format={num}
            parse={parseSize}
            scrub={{ step: 1, min: 0 }}
            disabled={ctx.disabled}
            onCommit={(v) => ctx.run((ts) => setRadiusAll(ts, v), 'Change radius')}
            token={{ spec: radiusSpec(), ctx }}
            trailing={
              <button
                type="button"
                className={`dp-icon-btn boxed${corners ? ' filled' : ''}`}
                title="Independent corners"
                aria-label="Independent corners"
                aria-pressed={corners}
                disabled={ctx.disabled}
                onClick={() => setCorners((c) => !c)}
              >
                <Icon name="scan" size={13} />
              </button>
            }
          />
        )}
      </div>
      {canRadius && corners && (
        <div className="dp-row dp-corners">
          {CORNERS.map((c, i) => (
            <Field key={c} label={`${c} corner radius`} title={`${c} corner radius`} icon={CORNER_ICON[i]} state={corner(i)} format={num} parse={parseSize} scrub={{ step: 1, min: 0 }} disabled={ctx.disabled} onCommit={(v) => ctx.run((ts) => setRadiusCorner(ts, i, v), 'Change corner radius')} token={{ spec: radiusSpec(i, `${c} radius`), ctx }} />
          ))}
        </div>
      )}
    </Group>
  );
}

const EFFECT_LABEL: Record<EffectKind, string> = { drop: 'Drop shadow', inner: 'Inner shadow', blur: 'Layer blur', backdropBlur: 'Background blur' };
const EFFECT_KINDS: readonly EffectKind[] = ['drop', 'inner', 'blur', 'backdropBlur'];
const SCALAR_KIND = new Set<EffectKind>(['blur', 'backdropBlur']);

/**
 * Bagian Effects (desain badge 6): baris bertipe — tombol settings (editor sebaris), select jenis, "−". Menu "+"
 * menawarkan 4 jenis; blur/backdropBlur (skalar) maksimal satu baris. Per-baris eye FIGMA-ONLY (tak ada di model).
 * Spread shadow FIGMA-ONLY: model mengedit shadow sebagai objek {x,y,blur,color}; spread tersimpan tak dihapus.
 */
function EffectsGroup({ targets, ctx }: { targets: DesignTarget[]; ctx: Ctx }) {
  const shadows = readField(targets, (n) => n.shadows);
  const list = !shadows.mixed && Array.isArray(shadows.value) ? (shadows.value as Raw[]) : [];
  const rList = !shadows.mixed && Array.isArray(shadows.resolved) ? (shadows.resolved as Raw[]) : list;
  const blurState = readField(targets, (n) => n.blur);
  const backState = readField(targets, (n) => n.backdropBlur);
  const used = new Set<EffectKind>();
  for (const t of targets) for (const k of effectKindsOf(t.stored)) used.add(k);
  const [open, setOpen] = useState<string | undefined>(undefined);
  const rows: { key: string; kind: EffectKind; index: number }[] = [
    ...list.map((s, i) => ({ key: `s${i}`, kind: (s.type === 'inner' ? 'inner' : 'drop') as EffectKind, index: i })),
    ...(!blurState.mixed && typeof blurState.value === 'number' && blurState.value !== 0 ? [{ key: 'blur', kind: 'blur' as EffectKind, index: -1 }] : []),
    ...(!backState.mixed && typeof backState.value === 'number' && backState.value !== 0 ? [{ key: 'bd', kind: 'backdropBlur' as EffectKind, index: -1 }] : []),
  ];
  /** Editor sebaris satu baris: X/Y/Blur + warna untuk shadow; kolom Blur untuk blur skalar. */
  const editor = (row: (typeof rows)[number]) =>
    SCALAR_KIND.has(row.kind) ? (
      <div className="dp-fx-edit">
        <div className="dp-row">
          <Field
            label="Blur"
            className="dp-grow"
            state={row.kind === 'blur' ? blurState : backState}
            format={num}
            parse={parseSize}
            scrub={{ step: 1, min: 0 }}
            disabled={ctx.disabled}
            onCommit={(v) => ctx.run((ts) => setProp(ts, row.kind, v), `Change ${EFFECT_LABEL[row.kind].toLowerCase()}`)}
          />
        </div>
      </div>
    ) : (
      <ShadowEditor index={row.index} shadow={list[row.index]!} resolved={rList[row.index] ?? list[row.index]!} ctx={ctx} />
    );
  return (
    <Group
      title="Effects"
      action={
        <MenuButton
          icon="plus"
          className="dp-header-btn"
          title="Add effect"
          disabled={ctx.disabled}
          items={() =>
            EFFECT_KINDS.map((k) => ({
              label: EFFECT_LABEL[k],
              disabled: SCALAR_KIND.has(k) && used.has(k),
              run: () => ctx.run((ts) => addEffect(ts, k), `Add ${EFFECT_LABEL[k].toLowerCase()}`),
            }))
          }
        />
      }
    >
      {shadows.mixed && <PaintRow disabled={ctx.disabled} swatch={<Swatch background="transparent" title="Mixed" disabled />} value={<span className="dp-muted">Mixed shadows</span>} onRemove={() => ctx.run((ts) => setProp(ts, 'shadows', null), 'Remove shadows')} removeTitle="Remove shadows" />}
      {rows.map((row) => {
        const isOpen = open === row.key;
        return (
          <div key={row.key} className="dp-fx">
            <div className="dp-fx-row">
              <button
                type="button"
                className={`dp-icon-btn boxed${isOpen ? ' filled' : ''}`}
                title={`${EFFECT_LABEL[row.kind]} settings`}
                aria-label={`${EFFECT_LABEL[row.kind]} settings`}
                aria-expanded={isOpen}
                disabled={ctx.disabled}
                onClick={() => setOpen((o) => (o === row.key ? undefined : row.key))}
              >
                <Icon name="settings2" size={13} />
              </button>
              <label className="dp-select dp-grow">
                <select
                  aria-label="Effect type"
                  value={row.kind}
                  disabled={ctx.disabled}
                  onChange={(e) => ctx.run((ts) => convertEffect(ts, row.index >= 0 ? { index: row.index } : (row.kind as 'blur' | 'backdropBlur'), e.currentTarget.value as EffectKind), 'Change effect type')}
                >
                  {EFFECT_KINDS.map((k) => (
                    <option key={k} value={k} disabled={k !== row.kind && SCALAR_KIND.has(k) && used.has(k)}>
                      {EFFECT_LABEL[k]}
                    </option>
                  ))}
                </select>
                <Icon name="chevronDown" size={12} className="dp-select-chevron" />
              </label>
              <button
                type="button"
                className="dp-icon-btn"
                title={`Remove ${EFFECT_LABEL[row.kind].toLowerCase()}`}
                aria-label={`Remove ${EFFECT_LABEL[row.kind].toLowerCase()}`}
                disabled={ctx.disabled}
                onClick={() => {
                  setOpen(undefined);
                  ctx.run((ts) => removeEffect(ts, row.kind, Math.max(0, row.index)), `Remove ${EFFECT_LABEL[row.kind].toLowerCase()}`);
                }}
              >
                <Icon name="minus" size={14} />
              </button>
            </div>
            {isOpen && editor(row)}
          </div>
        );
      })}
    </Group>
  );
}

/** Editor sebaris shadow (desain E3-style): X, Y, Blur + baris warna (swatch + hex + alpha). */
function ShadowEditor({ index, shadow, resolved, ctx }: { index: number; shadow: Raw; resolved: Raw; ctx: Ctx }) {
  const field = (key: 'x' | 'y' | 'blur', label: string) => (
    <Field
      label={label}
      className="dp-grow"
      state={{ mixed: false, value: shadow[key], resolved: resolved[key] }}
      format={num}
      parse={(t) => parseNumber(t, key === 'blur' ? { min: 0 } : undefined)}
      scrub={{ step: 1, ...(key === 'blur' ? { min: 0 } : {}) }}
      disabled={ctx.disabled}
      onCommit={(v) => ctx.run((ts) => editShadow(ts, index, (x) => ({ ...x, [key]: v })), `Change shadow ${label.toLowerCase()}`)}
    />
  );
  return (
    <div className="dp-fx-edit">
      <div className="dp-row">
        {field('x', 'X')}
        {field('y', 'Y')}
        {field('blur', 'Blur')}
      </div>
      <ColorRow
        state={{ mixed: false, value: shadow.color, resolved: resolved.color }}
        disabled={ctx.disabled}
        onColor={(c) => {
          const next = changeColor(resolved.color, c);
          if (next) ctx.run((ts) => editShadow(ts, index, (x) => ({ ...x, color: next })), 'Change shadow color');
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export type DesignPanelProps = {
  targets: DesignTarget[];
  /** Jalur nama node primer (board → node). */
  path: string[];
  editable: boolean;
  fonts: FontFamily[];
  /** Node primer dari POST /inspect (Copy as, posisi terukur anak flow). */
  inspectNode: InspectNode | undefined;
  /** Rev dokumen yang tampil: antrean edit lanjut saat rev berubah. */
  rev: number;
  onCommit: Commit;
  /** Multi-seleksi (story 6, desain "Align & distribute" J8r8Gq): ketersediaan dan penjalan aksi align/distribute. */
  align?: { enabled: Record<EditAction, boolean>; run: (a: EditAction) => void } | undefined;
  /** `tokenModes` dokumen tampil (epic token-tema story 3): grup Theme mode untuk board. */
  tokenModes?: readonly string[] | undefined;
  /** Token dokumen tampil (epic token-tema story 4): Token Field dan Token Picker. */
  tokens?: TokenMap | undefined;
  /** Seleksi tunggal master/instance/isi instance (epic komponen story 4): header dan grup Instance. */
  component?: ComponentPanel | undefined;
  /** Penjalan aksi props/slot komponen (story 5): op dari dokumen terbaru, satu permintaan ops per aksi. */
  componentEdit?: ComponentEdit | undefined;
  /** Buka dialog Export code untuk node primer (epic kode story 5, seksi Code: `target` awal); undefined = item disembunyikan. */
  onExportCode?: ((id: string, target?: CodegenTarget) => void) | undefined;
  /** Mode edit titik path node primer (paste-vektor story 5, desain J7AmQi): grup Point menggantikan Position & size. */
  pathEdit?: PathEditPanel | undefined;
  /** Dokumen terkini untuk seksi Theme (spec-viewer-merged-design-tab); ops token lewat `onCommit`. */
  doc: LakarDocument;
  /** Slug dokumen untuk seksi Export (route /viewer/docs/:slug/export-file). */
  slug: string;
  /** Target ekspor seleksi tunggal (seksi Export); undefined = tanpa seleksi sah. */
  exportSel?: ExportSel | undefined;
  /** Buka dialog Import (dipicu dari menu seksi Theme). */
  onImportCss?: (() => void) | undefined;
  onImportDtcg?: (() => void) | undefined;
  /** Dialog impor sedang terbuka (Escape di seksi tidak menelannya). */
  importOpen?: boolean;
};

/** Info komponen node primer untuk panel (dihitung Viewer dari dokumen tersimpan). */
export type ComponentPanel =
  | { kind: 'master'; instances: number; model?: MasterModel | undefined }
  | {
      kind: 'instance';
      masterName: string;
      overrides: { count: number; text: string };
      onGoToMaster: () => void;
      onDetach: () => void;
      onResetAll: () => void;
      /** Properties dan Slots (story 5); undefined bila master tidak ditemukan. */
      props?: InstancePanelProps | undefined;
    }
  | { kind: 'inside'; instanceName: string; masterName: string }
  /** Frame di dalam master (story 5): grup Slot. */
  | { kind: 'slotFrame'; frameId: string; masterId: string; masterName: string; slot: string | undefined };

/** Data Properties/Slots instance: model, master lain (sisip ke slot), dokumen tampil, pemilih alamat slot. */
export type InstancePanelProps = { model: InstanceModel; masters: readonly { id: string; name: string }[]; doc: LakarDocument; info: ComponentInfo; onSelect: (address: string) => void };

/**
 * Grup Instance (desain xTIr4 "Group Instance"): chip master (ke master), Detach, dan ringkasan override + Reset all.
 * Lalu Properties dan Slots instance (story 5) bila master punya props/slots.
 */
function InstanceGroup({ info, disabled, edit }: { info: Extract<ComponentPanel, { kind: 'instance' }>; disabled: boolean; edit: ComponentEdit | undefined }) {
  return (
    <section className="dp-group">
      <div className="dp-instance-row">
        <div className="dp-component-chip">
          <Icon name="component" size={13} />
          <span title={info.masterName}>{info.masterName}</span>
          <button type="button" title="Go to component" aria-label="Go to component" onClick={info.onGoToMaster}>
            <Icon name="arrowUpRight" size={13} />
          </button>
        </div>
        <button type="button" className="btn dp-detach-btn" disabled={disabled} onClick={info.onDetach} title="Detach instance">
          <Icon name="unlink" size={13} />
          Detach
        </button>
      </div>
      {info.overrides.count > 0 && (
        <div className="dp-overrides-row">
          <i className="override-dot" aria-hidden="true" />
          <span title={info.overrides.text}>{info.overrides.text}</span>
          <button type="button" disabled={disabled} onClick={info.onResetAll}>
            Reset all
          </button>
        </div>
      )}
      {info.props && edit && <InstancePropsSlots {...info.props} edit={edit} disabled={disabled} />}
    </section>
  );
}

export function DesignPanel({ targets, path, editable, fonts, inspectNode, rev, onCommit, align, tokenModes, tokens, component, componentEdit, onExportCode, pathEdit, doc, slug, exportSel, onImportCss, onImportDtcg, importOpen }: DesignPanelProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | undefined>(undefined);
  const [picker, setPicker] = useState<{ anchor: HTMLElement; spec: TokenSpec; trigger: HTMLElement | undefined } | undefined>(undefined);
  // Picker ditutup saat seleksi berganti, panel menjadi baca-saja (pratinjau/offline), atau field jangkarnya hilang
  // sesudah rev baru (fill/stroke dihapus agen, undo): spec lama tidak boleh menulis ke slot yang sudah bergeser.
  const selKey = targets.map((t) => t.id).join(',');
  useEffect(() => setPicker(undefined), [selKey, editable]);
  useEffect(() => {
    if (picker && !picker.anchor.isConnected) setPicker(undefined);
  }, [rev, picker]);
  const [copied, setCopied] = useState<string | undefined>(undefined);
  // Antrean edit: patch fills/shadows/stroke berupa array/objek utuh, jadi edit berikutnya baru dibangun sesudah commit
  // sebelumnya tampil di dokumen (rev berubah) — tanpa itu edit cepat kedua menimpa yang pertama dengan data basi.
  const live = useRef({ targets, editable, rev, onCommit, tokens, tokenModes });
  live.current = { targets, editable, rev, onCommit, tokens, tokenModes };
  const queue = useRef<{ build: Build; label: string }[]>([]);
  const pending = useRef<{ rev: number; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
  const flush = useRef(() => {});
  flush.current = () => {
    if (pending.current) return;
    for (let job = queue.current.shift(); job; job = queue.current.shift()) {
      const cur = live.current;
      if (!cur.editable || cur.targets.length === 0) {
        queue.current = [];
        return;
      }
      const ops = job.build(cur.targets);
      if (ops.length === 0) continue;
      const timer = setTimeout(() => {
        if (pending.current?.timer !== timer) return;
        pending.current = undefined;
        flush.current();
      }, PENDING_MAX_MS);
      pending.current = { rev: cur.rev, timer };
      void cur.onCommit(ops, describeEdit(job.label, cur.targets.length)).then((ok) => {
        if (ok || pending.current?.timer !== timer) return;
        // Gagal: toast dari Viewer; edit yang mengantre dibuang (dibangun dari keadaan yang ditolak).
        clearTimeout(timer);
        pending.current = undefined;
        queue.current = [];
      });
      return;
    }
  };
  useEffect(() => {
    const p = pending.current;
    if (!p || p.rev === rev) return;
    clearTimeout(p.timer);
    pending.current = undefined;
    flush.current();
  }, [rev]);
  const primary = targets[targets.length - 1];
  if (!primary) {
    return (
      <div className="inspect design-panel">
        <div className="panel-empty">
          <Icon name="pointer" size={20} />
          <strong>Nothing selected</strong>
          <span>Select a layer or a board on the canvas to edit its design.</span>
        </div>
        <ThemeSection doc={doc} rev={rev} editable={editable} onCommit={onCommit} onImportCss={onImportCss} onImportDtcg={onImportDtcg} importOpen={importOpen} />
        <ExportSection slug={slug} sel={undefined} />
        <CodeSection sel={undefined} onExportCode={onExportCode} />
      </div>
    );
  }
  const multi = targets.length > 1;
  const groups = designGroups(targets);
  const ctx: Ctx = {
    disabled: !editable,
    run: (build, label) => {
      if (!editable) return;
      queue.current.push({ build, label });
      flush.current();
    },
    targets,
    tokens: tokens ?? {},
    modes: tokenModes ?? [],
    pickerKey: picker ? specKey(picker.spec) : undefined,
    openPicker: (anchor, spec) => {
      if (editable) setPicker({ anchor, spec, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : undefined });
    },
    latest: () => ({ tokens: live.current.tokens ?? {}, modes: live.current.tokenModes ?? [] }),
  };
  const types = new Set(targets.map((t) => t.type));
  const typeLabel = TYPE_LABEL[primary.type] ?? primary.type;
  const parentPath = path.length > 1 ? ` · ${path.slice(0, -1).join(' / ')}` : '';
  // Header komponen (desain C2xbUQ/xTIr4/dQRib): master "Component · N instances", instance "Instance of <master> ·
  // <path>", isi instance "<Tipe> · inside <instance> (<master>)".
  const comp = multi ? undefined : component;
  const points = !multi && pathEdit && pathEdit.nodeId === primary.id ? pathEdit : undefined;
  const subtitle = points
    ? `Path · editing points · ${points.selected} of ${points.total} selected`
    : multi
    ? `${types.size === 1 ? `${typeLabel}s` : 'Layers'}${parentPath}`
    : comp?.kind === 'master'
      ? `Component · ${instancesText(comp.instances)}`
      : comp?.kind === 'instance'
        ? `Instance of ${comp.masterName}${parentPath}`
        : comp?.kind === 'inside'
          ? `${typeLabel} · inside ${comp.instanceName} (${comp.masterName})`
          : `${typeLabel}${parentPath}`;
  const badgeIcon: IconName = comp?.kind === 'master' ? 'component' : comp?.kind === 'instance' ? 'diamond' : multi && types.size > 1 ? 'layers' : (NODE_ICON[primary.type] ?? 'square');
  const node = inspectNode && inspectNode.id === primary.id ? inspectNode : undefined;
  const copy = async (format: CopyFormat) => {
    if (!node) return;
    try {
      await copyText(copyAs(format, node));
      setCopied(format);
      setTimeout(() => setCopied((c) => (c === format ? undefined : c)), 1500);
    } catch {
      // clipboard tidak tersedia
    }
  };
  // Posisi terukur relatif board (anak flow); hanya untuk seleksi tunggal.
  const bounds = node?.bounds;
  return (
    // `readonly` (E6): seluruh kontrol panel di-dim 60% bila keadaan baca-saja nyata (pratinjau versi/offline).
    <div className={`inspect design-panel${editable ? '' : ' readonly'}`}>
      <div className="selection-header">
        <span className={`type-badge${comp?.kind === 'master' || comp?.kind === 'instance' ? ' component' : ''}`}>
          <Icon name={badgeIcon} size={14} />
        </span>
        <div className="selection-info">
          <strong>{multi ? `${targets.length} layers` : primary.name}</strong>
          <span>{subtitle}</span>
        </div>
        {!multi && (
          <button
            type="button"
            className={`dp-icon-btn copy-menu-btn${copied ? ' done' : ''}`}
            title={copied ? 'Copied' : 'Export code or copy as…'}
            aria-label="Export code or copy as"
            aria-haspopup="menu"
            disabled={!node && !onExportCode}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.right - 160, y: r.bottom + 4 });
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={14} />
          </button>
        )}
      </div>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          items={[
            ...(onExportCode
              ? [
                  {
                    label: 'Export code…',
                    icon: 'codeXml' as const,
                    run: () => {
                      setMenu(undefined);
                      onExportCode(primary.id);
                    },
                  },
                ]
              : []),
            ...COPY_FORMATS.map(([f, label]) => ({
              label: `Copy as ${label}`,
              icon: 'copy' as const,
              disabled: !node,
              run: () => {
                setMenu(undefined);
                void copy(f);
              },
            })),
          ]}
        />
      )}
      {picker && editable && <TokenPicker anchor={picker.anchor} trigger={picker.trigger} spec={picker.spec} ctx={ctx} onClose={() => setPicker(undefined)} />}
      <OverrideContext.Provider value={ctx}>
        <Fragment key={selKey}>
          {comp?.kind === 'instance' && <InstanceGroup info={comp} disabled={!editable} edit={componentEdit} />}
          {comp?.kind === 'master' && comp.model && componentEdit && <MasterComponentGroup model={comp.model} edit={componentEdit} disabled={!editable} />}
          {comp?.kind === 'slotFrame' && componentEdit && <SlotFrameGroup {...comp} edit={componentEdit} disabled={!editable} />}
          {points && <PointGroup edit={points} disabled={!editable} />}
          {groups.includes('position') && !points && <PositionGroup targets={targets} ctx={ctx} bounds={bounds} align={align} />}
          {groups.includes('autoLayout') && <AutoLayoutGroup targets={targets} ctx={ctx} />}
          {groups.includes('typography') && <TypographyGroup targets={targets} ctx={ctx} fonts={fonts} />}
          {groups.includes('icon') && <IconGroup targets={targets} ctx={ctx} />}
          {groups.includes('appearance') && <AppearanceGroup targets={targets} ctx={ctx} />}
          {groups.includes('fill') && <FillGroup targets={targets} ctx={ctx} />}
          {groups.includes('stroke') && <StrokeGroup targets={targets} ctx={ctx} />}
          {groups.includes('effects') && <EffectsGroup targets={targets} ctx={ctx} />}
        </Fragment>
      </OverrideContext.Provider>
      <ThemeSection
        doc={doc}
        rev={rev}
        editable={editable}
        onCommit={onCommit}
        boardTheme={
          tokenModes && tokenModes.length > 0 && targets.every((t) => t.type === 'board')
            ? { targets, modes: tokenModes, onPick: (m: string) => ctx.run((ts) => themeModeOps(ts, m, tokenModes), 'Change theme mode') }
            : undefined
        }
        onImportCss={onImportCss}
        onImportDtcg={onImportDtcg}
        importOpen={importOpen}
      />
      <ExportSection slug={slug} sel={exportSel} />
      <CodeSection sel={exportSel} onExportCode={onExportCode} />
      {!editable && (
        <div className="read-only-note">
          <Icon name="lock" size={14} />
          <span>Read only while previewing a version or offline.</span>
        </div>
      )}
    </div>
  );
}

