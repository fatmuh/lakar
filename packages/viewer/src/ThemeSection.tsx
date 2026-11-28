// Seksi "Theme" di tab Design (spec-viewer-merged-design-tab, desain viewer-panel-redesign.pen): menggantikan panel
// melayang ThemePanel + tombol Theme di top bar. Header collapsible dengan ringkasan `<jumlah> · <mode>`; isi: switch
// mode aktif, filter, satu grup collapsible per jenis token (baris: swatch/nama + nilai mode aktif + hapus), dan menu
// "⋯" (Import CSS/DTCG, Copy tokens as CSS, Export/Copy DTCG JSON, tambah/rename mode).
// Setiap aksi = satu permintaan ops lewat `onCommit` Viewer (History + undo per jendela, AD-7/AD-8); pembangun op di
// themeModel.ts (murni). Edit mengantre sampai rev commit sebelumnya tampil (antrean sama seperti ThemePanel lama).
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TOKEN_TYPES, type DocOp, type LakarDocument, type TokenType } from '@lakar/schema';
import { dtcgTokensJson } from '@lakar/codegen';
import { copyText } from './Connections';
import { withHex } from './designValues';
import { Icon } from './icons';
import { CopyTokensPopover } from './TokensCss';
import {
  addModeOps,
  addTokenOps,
  cellOf,
  deleteTokenOps,
  modeIcon,
  modeLabel,
  newTokenName,
  readThemeMode,
  renameModeOps,
  renameTokenOps,
  setCellOps,
  tokenGroups,
  TYPE_META,
  usageCounts,
  type Built,
  type ThemeDoc,
  type TokenDefLike,
} from './themeModel';
import type { DesignTarget } from './designModel';

type Commit = (ops: DocOp[], description: string) => Promise<boolean>;
/** Batas tunggu rev commit sebelumnya sebelum antrean dilanjutkan (dokumen gagal dimuat ulang). */
const PENDING_MAX_MS = 3000;
/** Batas baris per jenis sebelum "Show N more" (desain: grup Color menampilkan sebagian). */
const ROW_CAP = 6;

/**
 * Antrean commit: `run(build)` membangun op dari dokumen terbaru saat gilirannya tiba (sesudah rev commit
 * sebelumnya tampil). Build yang kini gagal/tanpa perubahan dilewati; commit gagal membuang antrean.
 */
function useCommitQueue(doc: ThemeDoc, rev: number, editable: boolean, onCommit: Commit) {
  const live = useRef({ doc, rev, editable, onCommit });
  live.current = { doc, rev, editable, onCommit };
  const queue = useRef<((d: ThemeDoc) => Built)[]>([]);
  const pending = useRef<{ rev: number; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
  const flush = useRef(() => {});
  flush.current = () => {
    if (pending.current) return;
    for (let job = queue.current.shift(); job; job = queue.current.shift()) {
      const cur = live.current;
      if (!cur.editable) {
        queue.current = [];
        return;
      }
      const built = job(cur.doc);
      if ('error' in built || built.ops.length === 0) continue;
      const timer = setTimeout(() => {
        if (pending.current?.timer !== timer) return;
        pending.current = undefined;
        flush.current();
      }, PENDING_MAX_MS);
      pending.current = { rev: cur.rev, timer };
      void cur.onCommit(built.ops, built.label).then((ok) => {
        if (ok || pending.current?.timer !== timer) return;
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
  useEffect(() => () => clearTimeout(pending.current?.timer), []);
  return (build: (d: ThemeDoc) => Built) => {
    if (!live.current.editable) return;
    queue.current.push(build);
    flush.current();
  };
}

/** Validasi segera terhadap dokumen tampil: error → string (input tetap terbuka), sah → antre, undefined. */
type Submit = (text: string) => string | undefined;

/** Input sel/nama: Enter commit (error → tetap terbuka), blur commit, Escape batal. */
function CellInput({
  initial,
  placeholder,
  label,
  onSubmit,
  onClose,
  className,
  invalid,
  submitUnchanged,
}: {
  initial: string;
  placeholder?: string;
  label: string;
  onSubmit: Submit;
  onClose: () => void;
  className?: string;
  invalid?: boolean;
  submitUnchanged?: boolean;
}) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const finish = (commit: boolean, keepOnError: boolean) => {
    if (done.current) return;
    if (commit && (text !== initial || (submitUnchanged && keepOnError))) {
      const err = onSubmit(text);
      if (err && keepOnError) return;
    }
    done.current = true;
    onClose();
  };
  return (
    <input
      className={`theme-input${invalid ? ' invalid' : ''}${className ? ` ${className}` : ''}`}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false, false);
        }
      }}
      onBlur={() => finish(true, false)}
    />
  );
}

/** Swatch warna token: color picker native, commit sekali saat picker ditutup (event `change`). */
function TokenSwatch({ color, disabled, label, onPick }: { color: string; disabled: boolean; label: string; onPick: (hex: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const solid = /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7).toLowerCase() : '#000000';
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => pick.current(el.value);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, [solid]);
  return (
    <label className={`dp-swatch${disabled ? ' disabled' : ''}`} title={label}>
      <i style={{ background: color }} />
      <input ref={ref} type="color" defaultValue={solid} key={solid} disabled={disabled} aria-label={label} />
    </label>
  );
}

type Editing =
  | { kind: 'cell'; name: string }
  | { kind: 'name'; name: string }
  | { kind: 'mode'; mode: string | undefined }
  | { kind: 'draft'; type: TokenType; name: string }
  | undefined;

/**
 * Seksi Theme (desain: header `› Theme · 48 · Dark`, expanded: switch mode + filter + grup per jenis + footer Import).
 * `onImportCss`/`onImportDtcg` membuka dialog milik Viewer (modal di-portal ke body; `.canvas-overlay-ui` dicek DOM).
 */
export function ThemeSection({
  doc,
  rev,
  editable,
  onCommit,
  boardTheme,
  onImportCss,
  onImportDtcg,
  importOpen = false,
}: {
  doc: LakarDocument;
  rev: number;
  editable: boolean;
  onCommit: Commit;
  /**
   * "Board theme" (desain badge 7, spec-design-panel-figma): mode tema board terpilih — segmented sun/moon +
   * helper; ditulis lewat `onPick` pemanggil (satu commit). undefined = seleksi bukan board.
   */
  boardTheme?: { targets: readonly DesignTarget[]; modes: readonly string[]; onPick: (mode: string) => void } | undefined;
  onImportCss?: (() => void) | undefined;
  onImportDtcg?: (() => void) | undefined;
  importOpen?: boolean;
}) {
  const head = doc as unknown as ThemeDoc;
  const tokens = head.tokens ?? {};
  const modes = head.tokenModes ?? [];
  const run = useCommitQueue(head, rev, editable, onCommit);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<string | undefined>(modes[0]);
  const active = modes.includes(mode ?? '') ? mode : modes[0];
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Editing>(undefined);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirm, setConfirm] = useState<string | undefined>(undefined);
  const [copyOpen, setCopyOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copiedDtcg, setCopiedDtcg] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const usage = useMemo(() => usageCounts(head), [head]);
  const count = Object.keys(tokens).length;

  // Klik di luar menu/confirm menutupnya.
  useEffect(() => {
    if (!menu && !confirm) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (menu && !el.closest('.theme-menu-wrap')) setMenu(false);
      if (confirm && !el.closest('.theme-confirm')) setConfirm(undefined);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menu, confirm]);
  // Escape di dalam seksi: tutup popover (input menanganinya sendiri; dialog impor punya Escape sendiri).
  useEffect(() => {
    if (importOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      const el = root.current;
      if (!el || !(t instanceof Node) || (t !== document.body && !el.contains(t))) return;
      e.stopPropagation();
      if (confirm) setConfirm(undefined);
      else if (menu) setMenu(false);
      else if (copyOpen) setCopyOpen(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [confirm, copyOpen, menu, importOpen]);
  // Baca-saja (offline): tutup semua edit.
  useEffect(() => {
    if (editable) return;
    setEditing(undefined);
    setConfirm(undefined);
    setMenu(false);
  }, [editable]);

  const startEdit = (e: NonNullable<Editing>) => {
    setError(undefined);
    setEditing(e);
  };
  const submit = (build: (d: ThemeDoc) => Built): string | undefined => {
    const now = build(head);
    if ('error' in now) {
      setError(now.error);
      return now.error;
    }
    setError(undefined);
    if (now.ops.length) run(build);
    return undefined;
  };
  const startDraft = (type: TokenType) => {
    if (!editable) return;
    setEditing(undefined);
    setFilter('');
    setFolded((f) => {
      const n = new Set(f);
      n.delete(type);
      return n;
    });
    setEditing({ kind: 'draft', type, name: newTokenName(tokens, type) });
    setError(undefined);
  };

  /** Sel nilai token untuk mode aktif: warna → swatch + hex, lainnya → tombol format; mewarisi mode default → `= …`. */
  const valueCell = (name: string, def: TokenDefLike): ReactNode => {
    const cell = cellOf(def, active, modes);
    const colLabel = active ? modeLabel(active) : 'Value';
    const isEditing = editing?.kind === 'cell' && editing.name === name;
    if (isEditing) {
      return (
        <CellInput
          label={`${name} ${colLabel}`}
          initial={TYPE_META[def.type].format(cell.value)}
          onSubmit={(t) => void submit((d) => setCellOps(d.tokens, name, active, t, d.tokenModes))}
          onClose={() => setEditing(undefined)}
        />
      );
    }
    const openEdit = () => editable && startEdit({ kind: 'cell', name });
    if (cell.inherited) {
      return (
        <button type="button" className="theme-inherited" disabled={!editable} title={`Uses the ${modeLabel(modes[0] ?? '')} value. Click to set a ${colLabel} value.`} onClick={openEdit}>
          = {modeLabel(modes[0] ?? '')}
        </button>
      );
    }
    if (def.type === 'color') {
      const color = String(cell.value);
      return (
        <>
          <TokenSwatch
            color={color}
            disabled={!editable}
            label={`${name} ${colLabel} color`}
            onPick={(hex) => submit((d) => setCellOps(d.tokens, name, active, withHex(cellOf(d.tokens?.[name] ?? def, active, d.tokenModes).value, hex), d.tokenModes))}
          />
          <button type="button" className="theme-value plain" disabled={!editable} onClick={openEdit} aria-label={`Edit ${name} ${colLabel}`}>
            {TYPE_META[def.type].format(color)}
          </button>
        </>
      );
    }
    return (
      <button type="button" className="theme-value" disabled={!editable} onClick={openEdit} aria-label={`Edit ${name} ${colLabel}`}>
        {TYPE_META[def.type].format(cell.value)}
      </button>
    );
  };

  const confirmUses = confirm ? (usage.get(confirm) ?? 0) : 0;
  // Ringkasan header (desain badge 7): jumlah token saja ("3 tokens"); mode ada di baris Board theme/body.
  const summary = `${count} ${count === 1 ? 'token' : 'tokens'}`;
  const boardMode = boardTheme ? readThemeMode(boardTheme.targets, boardTheme.modes) : undefined;

  return (
    <div ref={root} className="theme-section">
      <div className="dp-section-head">
        <button type="button" className="dp-section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="chevronDown" size={11} className={`dp-section-caret${open ? ' open' : ''}`} />
          <span className="dp-section-title">Theme</span>
          <span className="dp-section-summary">{summary}</span>
        </button>
        <span className="theme-menu-wrap">
          <button
            type="button"
            className={`dp-icon-btn boxed${menu ? ' active' : ''}`}
            title="Theme actions"
            aria-label="Theme actions"
            aria-expanded={menu}
            aria-haspopup="menu"
            onClick={() => {
              setCopyOpen(false);
              setMenu((m) => !m);
            }}
          >
            <Icon name="ellipsis" size={14} />
          </button>
          {menu && (
            <div className="theme-menu" role="menu" aria-label="Theme actions">
              {editable && onImportCss && (
                <button type="button" role="menuitem" className="theme-menu-item" onClick={() => { setMenu(false); onImportCss(); }}>
                  Import CSS variables…
                </button>
              )}
              {editable && onImportDtcg && (
                <button type="button" role="menuitem" className="theme-menu-item" onClick={() => { setMenu(false); onImportDtcg(); }}>
                  Import DTCG tokens (.json)…
                </button>
              )}
              {(onImportCss || onImportDtcg) && <span className="theme-menu-sep" />}
              <button type="button" role="menuitem" className="theme-menu-item" disabled={count === 0} onClick={() => { setMenu(false); setCopyOpen(true); }}>
                Copy tokens as CSS
              </button>
              <button
                type="button"
                role="menuitem"
                className="theme-menu-item"
                disabled={count === 0}
                onClick={() => {
                  setMenu(false);
                  const blob = new Blob([dtcgTokensJson(doc)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'tokens.json';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Export DTCG JSON
              </button>
              <button
                type="button"
                role="menuitem"
                className="theme-menu-item"
                disabled={count === 0}
                onClick={() => {
                  setMenu(false);
                  void copyText(dtcgTokensJson(doc))
                    .then(() => {
                      setCopiedDtcg(true);
                      setTimeout(() => setCopiedDtcg(false), 1500);
                    })
                    .catch(() => {});
                }}
              >
                {copiedDtcg ? 'Copied' : 'Copy DTCG JSON'}
              </button>
              {editable && (
                <>
                  <span className="theme-menu-sep" />
                  <button type="button" role="menuitem" className="theme-menu-item" onClick={() => { setMenu(false); startEdit({ kind: 'mode', mode: undefined }); }}>
                    Add mode…
                  </button>
                  {active !== undefined && (
                    <button type="button" role="menuitem" className="theme-menu-item" onClick={() => { setMenu(false); startEdit({ kind: 'mode', mode: active }); }}>
                      Rename {modeLabel(active)}…
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </span>
        {copyOpen && <CopyTokensPopover doc={doc} onClose={() => setCopyOpen(false)} />}
      </div>
      {/* Board theme (desain badge 7): segmented mode tema board terpilih + helper; selalu tampil saat board terseleksi. */}
      {boardTheme && (
        <div className="theme-board">
          <div className="dp-row">
            <span className="dp-field-label">Board theme</span>
            {boardTheme.modes.length <= 3 ? (
              <div className="segmented dp-grow" role="radiogroup" aria-label="Board theme">
                {boardTheme.modes.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={m === boardMode} className={`segment${m === boardMode ? ' active' : ''}`} disabled={!editable} onClick={() => boardTheme.onPick(m)}>
                    <Icon name={modeIcon(m)} size={12} />
                    {modeLabel(m)}
                  </button>
                ))}
              </div>
            ) : (
              <select className="input select dp-grow" aria-label="Board theme" value={boardMode ?? ''} disabled={!editable} onChange={(e) => boardTheme.onPick(e.currentTarget.value)}>
                {boardTheme.modes.map((m) => (
                  <option key={m} value={m}>
                    {modeLabel(m)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <span className="dp-helper">Applies to every layer on this board, including instances.</span>
        </div>
      )}
      {open && (
        <div className="theme-section-body">
          {modes.length > 0 && (
            <div className="theme-mode-row">
              {editing?.kind === 'mode' ? (
                <CellInput
                  className="mode"
                  label={editing.mode === undefined ? 'New mode name' : `Rename mode ${modeLabel(editing.mode)}`}
                  initial={editing.mode === undefined ? '' : modeLabel(editing.mode)}
                  placeholder="New mode"
                  onSubmit={(t) =>
                    submit((d) => (editing.mode === undefined ? addModeOps(d, t) : renameModeOps(d, editing.mode as string, t)))
                  }
                  onClose={() => setEditing(undefined)}
                  invalid={error !== undefined}
                />
              ) : modes.length <= 3 ? (
                <div className="segmented" role="radiogroup" aria-label="Token mode">
                  {modes.map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={m === active} className={`segment${m === active ? ' active' : ''}`} onClick={() => setMode(m)}>
                      <Icon name={modeIcon(m)} size={12} />
                      {modeLabel(m)}
                    </button>
                  ))}
                </div>
              ) : (
                <select className="input select" aria-label="Token mode" value={active} onChange={(e) => setMode(e.currentTarget.value)}>
                  {modes.map((m) => (
                    <option key={m} value={m}>
                      {modeLabel(m)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          <label className="theme-filter">
            <Icon name="search" size={13} />
            <input value={filter} placeholder="Filter tokens" aria-label="Filter tokens" spellCheck={false} onChange={(e) => setFilter(e.currentTarget.value)} />
          </label>
          {TOKEN_TYPES.map((type) => {
            const meta = TYPE_META[type];
            const groups = tokenGroups(tokens, type, filter);
            const rows = groups.flatMap((g) => g.rows);
            const isFolded = folded.has(type);
            const shown = expandedRows.has(type) ? rows : rows.slice(0, ROW_CAP);
            const hidden = rows.length - shown.length;
            return (
              <Fragment key={type}>
                <div className="theme-type-head">
                  <button
                    type="button"
                    className={`theme-type-toggle${isFolded ? ' folded' : ''}`}
                    aria-expanded={!isFolded}
                    onClick={() =>
                      setFolded((f) => {
                        const n = new Set(f);
                        if (!n.delete(type)) n.add(type);
                        return n;
                      })
                    }
                  >
                    <Icon name="chevronDown" size={11} />
                    <span>{meta.label}</span>
                    <span className="theme-type-count">{rows.length}</span>
                  </button>
                  <button type="button" className="theme-icon-btn" title={`New ${meta.label.toLowerCase()} token`} aria-label={`New ${meta.label.toLowerCase()} token`} disabled={!editable} onClick={() => startDraft(type)}>
                    <Icon name="plus" size={13} />
                  </button>
                </div>
                {!isFolded && (
                  <>
                    {rows.length === 0 && editing?.kind !== 'draft' && <div className="theme-empty">{filter ? `No ${meta.label.toLowerCase()} tokens match “${filter}”.` : `No ${meta.label.toLowerCase()} tokens yet.`}</div>}
                    {shown.map(({ name, def }) => (
                      <div key={name} className={`theme-token${confirm === name ? ' selected' : ''}`} data-token={name}>
                        {def.type !== 'color' && <Icon name={meta.icon} size={12} className="theme-name-icon" />}
                        {editing?.kind === 'name' && editing.name === name ? (
                          <CellInput label={`Rename ${name}`} initial={name} onSubmit={(t) => submit((d) => renameTokenOps(d.tokens, name, t))} onClose={() => setEditing(undefined)} invalid={error !== undefined} />
                        ) : (
                          <button type="button" className="theme-name-text" disabled={!editable} title={editable ? 'Rename token' : name} onClick={() => startEdit({ kind: 'name', name })}>
                            {name}
                          </button>
                        )}
                        <span className="theme-spacer" />
                        {valueCell(name, def)}
                        <button
                          type="button"
                          className="theme-icon-btn danger theme-del"
                          title="Delete token"
                          aria-label={`Delete ${name}`}
                          disabled={!editable}
                          onClick={() => setConfirm(name)}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </div>
                    ))}
                    {editing?.kind === 'draft' && editing.type === type && (
                      <div className="theme-token draft">
                        {type !== 'color' && <Icon name={meta.icon} size={12} className="theme-name-icon" />}
                        <CellInput
                          label="New token name"
                          initial={editing.name}
                          submitUnchanged
                          onSubmit={(t) => submit((d) => addTokenOps(d.tokens, t, type))}
                          onClose={() => setEditing(undefined)}
                          invalid={error !== undefined}
                        />
                        <span className="theme-spacer" />
                        <span className="theme-value static">{meta.format(meta.initial)}</span>
                      </div>
                    )}
                    {hidden > 0 && (
                      <button type="button" className="theme-more" onClick={() => setExpandedRows((x) => new Set(x).add(type))}>
                        Show {hidden} more
                      </button>
                    )}
                  </>
                )}
              </Fragment>
            );
          })}
          <footer className="theme-footer">
            {error ? (
              <span className="theme-error" role="alert">
                {error}
              </span>
            ) : !editable ? (
              <span className="theme-hint">
                <Icon name="lock" size={12} /> Read only while lakard is offline.
              </span>
            ) : (
              modes.length > 1 && <span className="theme-hint">Empty cells use the default mode value.</span>
            )}
          </footer>
        </div>
      )}
      {confirm && tokens[confirm] && (
        <div className="theme-confirm" role="alertdialog" aria-label={`Delete ${confirm}`}>
          <strong>Delete {confirm}?</strong>
          <p>{confirmUses === 0 ? 'No layers use this token. You can undo this from History.' : `Used by ${confirmUses === 1 ? '1 layer' : `${confirmUses} layers`} — they fall back to a literal value.`}</p>
          <div className="theme-confirm-actions">
            <button type="button" className="btn small" onClick={() => setConfirm(undefined)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn small danger"
              onClick={() => {
                submit((d) => deleteTokenOps(d, confirm));
                setConfirm(undefined);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
