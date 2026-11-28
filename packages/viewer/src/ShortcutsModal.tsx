// Panel shortcut keyboard canvas (spec-canvas-shortcuts, paritas Figma Ctrl/⌘+Shift+?): daftar statis shortcut
// yang aktif, dikelompokkan. `mod`/`alt` mengikuti platform (⌘/Ctrl, ⌥/Alt) seperti `EditMenu`.
import { Modal } from './NewFileDialog';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const M = IS_MAC ? '⌘' : 'Ctrl+';
const A = IS_MAC ? '⌥' : 'Alt+';
const S = '⇧';

const GROUPS: { title: string; rows: readonly [string, string][] }[] = [
  {
    title: 'Tools',
    rows: [
      ['V', 'Move'],
      ['H', 'Hand'],
      ['Space', 'Pan (hold)'],
      ['F / A', 'Frame'],
      ['R', 'Rectangle'],
      ['O', 'Ellipse'],
      ['T', 'Text'],
      ['I', 'Icon'],
      ['P', 'Pen'],
      ['C', 'Comment'],
      [`${M}${S}K`, 'Place image'],
    ],
  },
  {
    title: 'Selection',
    rows: [
      [`${M}A`, 'Select all'],
      [`${M}${S}A`, 'Select inverse'],
      ['Esc', 'Deselect'],
      ['Enter', 'Enter group / edit text'],
      [`${S}Enter or \\`, 'Select parent'],
      ['Tab / Shift+Tab', 'Next / previous sibling'],
      [`${M}R`, 'Rename layer'],
      [`${M}${A}${S}K`, 'Go to main component'],
      ['Q', 'Select variant set'],
    ],
  },
  {
    title: 'Edit',
    rows: [
      [`${M}Z / ${M}${S}Z`, 'Undo / redo'],
      [`${M}G / ${M}${S}G`, 'Group / ungroup'],
      [`${M}${A}G`, 'Frame selection'],
      [`${M}D`, 'Duplicate'],
      ['Delete', 'Delete'],
      [`${M}${S}C`, 'Copy as PNG'],
      [`${M}${A}K / ${M}${A}B`, 'Create component / detach'],
      [`${S}A / ${A}${S}A`, 'Add / remove auto layout'],
      [`${M}${A}${S}R`, 'Resize frame to fit'],
    ],
  },
  {
    title: 'Arrange',
    rows: [
      [`${M}] / ${M}[`, 'Forward / backward'],
      [`] / [`, 'To front / to back'],
      [`${A}A H D W V S`, 'Align'],
      [`${A}${S}H V`, 'Distribute'],
      ['Arrows / ⇧Arrows', 'Nudge 1 / 10'],
      [`${M}${A}↑↓`, 'Rotate 1° (⇧ 15°)'],
    ],
  },
  {
    title: 'Text',
    rows: [
      [`${M}B / I / U`, 'Bold / italic / underline'],
      [`${M}${S}< >`, 'Font size'],
      [`${M}${A}< >`, 'Font weight'],
      [`${A}< >`, 'Letter spacing'],
      [`${A}${S}< >`, 'Line height'],
    ],
  },
  {
    title: 'View',
    rows: [
      [`${M}+ −`, 'Zoom'],
      [`${S}1 2 0`, 'Fit / selection / 100%'],
      [`${A}1..${A}4`, 'Panel tabs'],
      [`${S}E`, 'Design / Prototype tab'],
      [`${M}${S}O`, 'Outline mode'],
      [`${S}C`, 'Show / hide comments'],
      [`${M}${A}\\`, 'Show / hide cursors'],
      ['F6', 'Cycle focus region'],
      [`${S}Space / ${M}${A}Enter`, 'Present prototype'],
      [`${M}${S}?`, 'This panel'],
    ],
  },
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="Keyboard shortcuts" onClose={onClose} className="shortcuts">
      <div className="shortcuts-grid">
        {GROUPS.map((g) => (
          <section key={g.title} className="shortcuts-group">
            <h3>{g.title}</h3>
            <dl>
              {g.rows.map(([k, label]) => (
                <div key={label} className="shortcuts-row">
                  <dt>{label}</dt>
                  <dd>
                    <kbd>{k}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
