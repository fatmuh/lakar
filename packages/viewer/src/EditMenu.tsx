// Menu konteks editor (editor-canvas story 6, desain bagian 05 "Context menu" QvMyG + submenu Align S2WUHS):
// Create component (desain 08 ZHqtv) + Detach instance (hanya bila berlaku), Group, Ungroup, Duplicate, Delete, Bring
// forward, Send backward, Align ›, Distribute ›. Dibuka dari klik kanan di
// canvas live dan di baris Layers; item yang tidak berlaku untuk seleksi nonaktif (opacity desain 0.4). Pola posisi,
// fokus, dan keyboard mengikuti `Menu` (FileMenu.tsx); ArrowRight/Enter membuka submenu, ArrowLeft/Escape menutupnya.
// Item terakhir "Export code…" (epic kode story 5) membuka dialog Export code untuk satu node; bukan aksi edit, jadi
// tetap aktif saat offline (kode dihasilkan di viewer) dan hanya tampil bila `onExportCode` diberikan.
import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { EditAction } from './editActions';
import { Icon, type IconName } from './icons';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = (k: string, shift = false) => (IS_MAC ? `${shift ? '⇧' : ''}⌘${k}` : `Ctrl+${shift ? 'Shift+' : ''}${k}`);
const alt = (k: string, shift = false) => (IS_MAC ? `${shift ? '⇧' : ''}⌥${k}` : `Alt+${shift ? 'Shift+' : ''}${k}`);

/** Label, ikon, dan shortcut tiap aksi (menu, panel Design, tooltip). `shortcut` ditampilkan di menu; `hint` hanya tooltip. */
export const ACTION_META: Record<EditAction, { label: string; icon: IconName; shortcut?: string; hint?: string; danger?: boolean; component?: boolean }> = {
  group: { label: 'Group', icon: 'group', shortcut: mod('G') },
  ungroup: { label: 'Ungroup', icon: 'ungroup', shortcut: mod('G', true) },
  duplicate: { label: 'Duplicate', icon: 'copy', shortcut: mod('D') },
  'copy-png': { label: 'Copy as PNG', icon: 'image', shortcut: mod('C', true) },
  delete: { label: 'Delete', icon: 'trash', shortcut: 'Del', danger: true },
  forward: { label: 'Bring forward', icon: 'bringForward', shortcut: mod(']') },
  backward: { label: 'Send backward', icon: 'sendBackward', shortcut: mod('[') },
  front: { label: 'Bring to front', icon: 'bringToFront', shortcut: ']' },
  back: { label: 'Send to back', icon: 'sendToBack', shortcut: '[' },
  'wrap-frame': { label: 'Frame selection', icon: 'frame', shortcut: IS_MAC ? '⌥⌘G' : 'Ctrl+Alt+G' },
  'auto-layout': { label: 'Add auto layout', icon: 'layoutGrid', shortcut: '⇧A' },
  unlayout: { label: 'Remove auto layout', icon: 'squareDashed', shortcut: alt('A', true) },
  'fit-content': { label: 'Resize to fit', icon: 'fit', shortcut: IS_MAC ? '⌥⇧⌘R' : 'Ctrl+Alt+Shift+R' },
  'align-left': { label: 'Align left', icon: 'alignLeft', hint: alt('A') },
  'align-center': { label: 'Align center', icon: 'alignCenterX', hint: alt('H') },
  'align-right': { label: 'Align right', icon: 'alignRight', hint: alt('D') },
  'align-top': { label: 'Align top', icon: 'alignTop', hint: alt('W') },
  'align-middle': { label: 'Align middle', icon: 'alignCenterY', hint: alt('V') },
  'align-bottom': { label: 'Align bottom', icon: 'alignBottom', hint: alt('S') },
  'distribute-h': { label: 'Distribute horizontally', icon: 'distributeX', hint: alt('H', true) },
  'distribute-v': { label: 'Distribute vertically', icon: 'distributeY', hint: alt('V', true) },
  'create-component': { label: 'Create component', icon: 'component', shortcut: IS_MAC ? '⌥⌘K' : 'Ctrl+Alt+K', component: true },
  detach: { label: 'Detach instance', icon: 'unlink', shortcut: IS_MAC ? '⌥⌘B' : 'Ctrl+Alt+B' },
};

/** Tooltip tombol: label + shortcut/hint. */
export const actionTitle = (a: EditAction): string => {
  const m = ACTION_META[a];
  const k = m.shortcut ?? m.hint;
  return k ? `${m.label} (${k})` : m.label;
};

/** `optional`: item hanya tampil bila berlaku (Detach instance, tanpa desain: mengikuti Create component). */
type Entry = { action: EditAction; separator?: boolean; optional?: boolean } | { submenu: 'align' | 'distribute'; separator?: boolean };
const MAIN: Entry[] = [
  { action: 'create-component' },
  { action: 'detach', optional: true },
  { action: 'group', separator: true },
  { action: 'ungroup' },
  { action: 'wrap-frame' },
  { action: 'auto-layout' },
  { action: 'unlayout', optional: true },
  { action: 'fit-content', optional: true },
  { action: 'duplicate', separator: true },
  { action: 'copy-png' },
  { action: 'delete' },
  { action: 'forward', separator: true },
  { action: 'backward' },
  { action: 'front' },
  { action: 'back' },
  { submenu: 'align', separator: true },
  { submenu: 'distribute' },
];
const SUB: Record<'align' | 'distribute', { label: string; icon: IconName; items: { action: EditAction; separator?: boolean }[] }> = {
  align: {
    label: 'Align',
    icon: 'alignLeft',
    items: [{ action: 'align-left' }, { action: 'align-center' }, { action: 'align-right' }, { action: 'align-top', separator: true }, { action: 'align-middle' }, { action: 'align-bottom' }],
  },
  distribute: { label: 'Distribute', icon: 'distributeX', items: [{ action: 'distribute-h' }, { action: 'distribute-v' }] },
};

const enabledItems = (root: HTMLElement | null) => [...(root?.querySelectorAll<HTMLElement>(':scope > .menu-group > .menu-item:not(:disabled)') ?? [])];

export function EditMenu({
  x,
  y,
  enabled,
  onAction,
  onClose,
  onExportCode,
  onSection,
}: {
  x: number;
  y: number;
  enabled: Record<EditAction, boolean>;
  onAction: (a: EditAction) => void;
  onClose: () => void;
  /** undefined = item Export code… disembunyikan; null = tampil nonaktif (seleksi lebih dari satu node). */
  onExportCode?: (() => void) | null | undefined;
  /** Section board (spec-section-groups): nama section bersama board terpilih (null = campuran/tanpa) + setter. */
  onSection?: { current: string | null; set: (name: string | null) => void } | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [sub, setSub] = useState<{ key: 'align' | 'distribute'; left: number; top: number; focus: boolean } | undefined>(undefined);
  const [secInput, setSecInput] = useState(false);
  useLayoutEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
    // Semua item nonaktif (pratinjau/offline): fokus di menu supaya Escape tetap menutupnya.
    (enabledItems(el)[0] ?? el).focus();
  }, [x, y]);
  // Submenu: di kanan item; tidak muat → di kiri menu (desain S2WUHS). Fokus item pertama bila dibuka dari keyboard.
  useLayoutEffect(() => {
    const el = subRef.current;
    if (!el || !sub) return;
    const r = el.getBoundingClientRect();
    const top = Math.max(8, Math.min(sub.top, window.innerHeight - r.height - 8));
    if (top !== sub.top) setSub({ ...sub, top });
    if (sub.focus) enabledItems(el)[0]?.focus();
  }, [sub]);
  const openSub = (key: 'align' | 'distribute', item: HTMLElement, focus: boolean) => {
    const menu = ref.current!.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    const width = 232;
    const left = menu.right + 2 + width <= window.innerWidth - 8 ? menu.right + 2 : Math.max(8, menu.left - 2 - width);
    setSub({ key, left, top: r.top - 6, focus });
  };
  const run = (a: EditAction) => {
    if (!enabled[a]) return;
    onClose();
    onAction(a);
  };
  const nav = (e: ReactKeyboardEvent, root: HTMLElement | null, inSub: boolean) => {
    const all = enabledItems(root);
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      (e.key === 'Home' ? all[0] : all[all.length - 1])?.focus();
    } else if (inSub && (e.key === 'ArrowLeft' || e.key === 'Escape')) {
      e.preventDefault();
      e.stopPropagation();
      const key = sub?.key;
      setSub(undefined);
      ref.current?.querySelector<HTMLElement>(`[data-submenu="${key}"]`)?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  const item = (a: EditAction, separator: boolean | undefined, inSub = false) => {
    const m = ACTION_META[a];
    return (
      <div key={a} className="menu-group" role="none">
        {separator && <div className="menu-separator" role="separator" />}
        <button type="button" role="menuitem" className={`menu-item${m.danger ? ' danger' : ''}${m.component ? ' component' : ''}`} disabled={!enabled[a]} title={m.hint ? `${m.label} (${m.hint})` : undefined} onClick={() => run(a)} onMouseEnter={inSub ? undefined : () => setSub(undefined)}>
          <Icon name={m.icon} size={15} />
          <span className="menu-label">{m.label}</span>
          {m.shortcut && (
            <span className="menu-shortcut" aria-hidden="true">
              {m.shortcut}
            </span>
          )}
        </button>
      </div>
    );
  };
  return (
    <div
      className="menu-layer"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div ref={ref} className="menu edit-menu" role="menu" tabIndex={-1} aria-label="Layer actions" style={pos} onKeyDown={(e) => nav(e, ref.current, false)}>
        {MAIN.map((en) => {
          if ('action' in en) return en.optional && !enabled[en.action] ? null : item(en.action, en.separator);
          const s = SUB[en.submenu];
          const can = s.items.some((it) => enabled[it.action]);
          const open = sub?.key === en.submenu;
          return (
            <div key={en.submenu} className="menu-group" role="none">
              {en.separator && <div className="menu-separator" role="separator" />}
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open}
                data-submenu={en.submenu}
                className={`menu-item${open ? ' open' : ''}`}
                disabled={!can}
                onMouseEnter={(e) => openSub(en.submenu, e.currentTarget, false)}
                onClick={(e) => openSub(en.submenu, e.currentTarget, true)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    openSub(en.submenu, e.currentTarget, true);
                  }
                }}
              >
                <Icon name={s.icon} size={15} />
                <span className="menu-label">{s.label}</span>
                <Icon name="chevronRight" size={13} className="menu-submenu-chevron" />
              </button>
            </div>
          );
        })}
        {onSection !== undefined && (
          <div className="menu-group" role="none">
            <div className="menu-separator" role="separator" />
            {secInput ? (
              <input
                ref={(el) => el?.focus()}
                className="menu-section-input"
                defaultValue={onSection.current ?? ''}
                placeholder="Section name"
                maxLength={120}
                onMouseEnter={() => setSub(undefined)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    onSection.set(e.currentTarget.value.trim());
                    onClose();
                  } else if (e.key === 'Escape') {
                    setSecInput(false);
                  }
                }}
                onBlur={() => setSecInput(false)}
              />
            ) : (
              <>
                <button type="button" role="menuitem" className="menu-item" onMouseEnter={() => setSub(undefined)} onClick={() => setSecInput(true)}>
                  <Icon name="folder" size={15} />
                  <span className="menu-label">{onSection.current ? `Section · ${onSection.current}` : 'Move to section…'}</span>
                </button>
                {onSection.current && (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onMouseEnter={() => setSub(undefined)}
                    onClick={() => {
                      onSection.set(null);
                      onClose();
                    }}
                  >
                    <Icon name="x" size={15} />
                    <span className="menu-label">Remove from section</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {onExportCode !== undefined && (
          <div className="menu-group" role="none">
            <div className="menu-separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={!onExportCode}
              onMouseEnter={() => setSub(undefined)}
              onClick={() => {
                if (!onExportCode) return;
                onClose();
                onExportCode();
              }}
            >
              <Icon name="codeXml" size={15} />
              <span className="menu-label">Export code…</span>
            </button>
          </div>
        )}
      </div>
      {sub && (
        <div ref={subRef} className="menu edit-menu edit-submenu" role="menu" aria-label={SUB[sub.key].label} style={{ left: sub.left, top: sub.top }} onKeyDown={(e) => nav(e, subRef.current, true)}>
          {SUB[sub.key].items.map((it) => item(it.action, it.separator, true))}
        </div>
      )}
    </div>
  );
}
