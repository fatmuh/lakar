import { describe, expect, it } from 'vitest';
import type { Box, GeoNode } from './gesture.js';
import { actionState, enterChildId, nudgeNodes, nudgeOps, normalizeEditedText, parentIdOf, planAction, resizeOps, rotateOps, selectAllIds, selectInverseIds, selectionAfter, shortcutAction, siblingIdOf, textEditPlan, textStyleOps, topMost, viewShortcut } from './editActions.js';
import { indexGeo } from './gesture.js';

const node = (id: string, box: Box, opts: Partial<GeoNode> = {}): GeoNode => ({
  id,
  type: 'rect',
  name: id,
  box,
  parentId: undefined,
  absolute: false,
  x: 0,
  y: 0,
  layout: undefined,
  children: [],
  ...opts,
});
const tree = (n: GeoNode): GeoNode => {
  for (const c of n.children) {
    c.parentId = n.id;
    tree(c);
  }
  return n;
};

/**
 * Board B1 (100,100) kolom: A dan C absolut, Row R (flow, R1..R3), frame F `none` absolut (F1, F2). Board B2 (600,100).
 */
function scene(): GeoNode[] {
  const b1 = tree(
    node('B1', { x: 100, y: 100, w: 400, h: 300 }, {
      type: 'board',
      absolute: true,
      x: 100,
      y: 100,
      layout: 'column',
      children: [
        node('A', { x: 120, y: 130, w: 50, h: 40 }, { absolute: true, x: 20, y: 30 }),
        node('C', { x: 200, y: 150, w: 60, h: 20 }, { absolute: true, x: 100, y: 50 }),
        node('R', { x: 100, y: 200, w: 400, h: 100 }, {
          type: 'frame',
          layout: 'row',
          children: [node('R1', { x: 100, y: 200, w: 100, h: 100 }), node('R2', { x: 200, y: 200, w: 100, h: 100 }), node('R3', { x: 300, y: 200, w: 100, h: 100 })],
        }),
        node('F', { x: 300, y: 300, w: 100, h: 80 }, {
          type: 'frame',
          layout: 'none',
          absolute: true,
          x: 200,
          y: 200,
          children: [node('F1', { x: 310, y: 310, w: 20, h: 20 }, { absolute: true, x: 10, y: 10 }), node('F2', { x: 350, y: 340, w: 30, h: 30 }, { absolute: true, x: 50, y: 40 })],
        }),
      ],
    }),
  );
  const b2 = node('B2', { x: 600, y: 100, w: 200, h: 200 }, { type: 'board', absolute: true, x: 600, y: 100, layout: 'column' });
  return [b1, b2];
}

describe('topMost', () => {
  it('membuang anggota yang leluhurnya terpilih dan ID yang tidak ada', () => {
    const idx = indexGeo(scene());
    expect(topMost(idx, ['F1', 'F', 'zz', 'A', 'A']).map((n) => n.id)).toEqual(['F', 'A']);
  });
});

describe('group', () => {
  it('node absolut: frame absolut di bounding box, anak relatif frame, frame di posisi z anggota teratas', () => {
    const p = planAction('group', scene(), ['C', 'A']);
    expect(p && 'ops' in p && p.ops).toEqual([
      { op: 'add', parentId: 'B1', node: { type: 'frame', name: 'Group', layout: 'none', width: 140, height: 40, position: 'absolute', x: 20, y: 30 }, ref: 'group' },
      { op: 'move', id: 'A', parentId: '@group' },
      { op: 'update', id: 'A', patch: { position: 'absolute', x: 0, y: 0 } },
      { op: 'move', id: 'C', parentId: '@group' },
      { op: 'update', id: 'C', patch: { position: 'absolute', x: 80, y: 20 } },
      { op: 'move', id: '@group', parentId: 'B1', index: 0 },
    ]);
    expect(p && 'ops' in p && p.select).toEqual({ refs: ['group'] });
    expect(p && 'ops' in p && p.label).toBe('Group 2 layers');
  });
  it('anak flow: frame flow (tanpa x/y) di indeks anggota pertama', () => {
    const p = planAction('group', scene(), ['R3', 'R2']);
    expect(p && 'ops' in p && p.ops).toEqual([
      { op: 'add', parentId: 'R', node: { type: 'frame', name: 'Group', layout: 'none', width: 200, height: 100 }, ref: 'group' },
      { op: 'move', id: 'R2', parentId: '@group' },
      { op: 'update', id: 'R2', patch: { position: 'absolute', x: 0, y: 0 } },
      { op: 'move', id: 'R3', parentId: '@group' },
      { op: 'update', id: 'R3', patch: { position: 'absolute', x: 100, y: 0 } },
      { op: 'move', id: '@group', parentId: 'R', index: 1 },
    ]);
  });
  it('board atau parent berbeda → pesan', () => {
    expect(planAction('group', scene(), ['B1'])).toEqual({ error: "Boards can't be grouped" });
    expect(planAction('group', scene(), ['A', 'F1'])).toEqual({ error: 'Select layers in the same parent to group' });
    expect(planAction('group', scene(), [])).toBeUndefined();
  });
});

describe('ungroup', () => {
  it('frame absolut: anak dipindah ke parent di indeks frame dengan posisi tetap, frame dihapus', () => {
    const p = planAction('ungroup', scene(), ['F']);
    expect(p && 'ops' in p && p.ops).toEqual([
      { op: 'move', id: 'F1', parentId: 'B1', index: 3 },
      { op: 'update', id: 'F1', patch: { position: 'absolute', x: 210, y: 210 } },
      { op: 'move', id: 'F2', parentId: 'B1', index: 4 },
      { op: 'update', id: 'F2', patch: { position: 'absolute', x: 250, y: 240 } },
      { op: 'remove', id: 'F' },
    ]);
    expect(p && 'ops' in p && p.select).toEqual({ ids: ['F1', 'F2'] });
  });
  it('frame flow di parent flow: anak flow tetap flow', () => {
    const p = planAction('ungroup', scene(), ['R']);
    expect(p && 'ops' in p && p.ops).toEqual([
      { op: 'move', id: 'R1', parentId: 'B1', index: 2 },
      { op: 'move', id: 'R2', parentId: 'B1', index: 3 },
      { op: 'move', id: 'R3', parentId: 'B1', index: 4 },
      { op: 'remove', id: 'R' },
    ]);
  });
  it('dua frame di parent sama diproses dari indeks terbesar; bukan frame → undefined', () => {
    const p = planAction('ungroup', scene(), ['R', 'F']);
    const ops = p && 'ops' in p ? p.ops : [];
    expect(ops[0]).toEqual({ op: 'move', id: 'F1', parentId: 'B1', index: 3 });
    expect(ops.at(-1)).toEqual({ op: 'remove', id: 'R' });
    expect(planAction('ungroup', scene(), ['A', 'B1'])).toBeUndefined();
  });
});

describe('duplicate dan delete', () => {
  it('absolut +10, board di kanan + 40, flow tanpa patch, seleksi = salinan', () => {
    const p = planAction('duplicate', scene(), ['A', 'B2', 'R1']);
    expect(p && 'ops' in p && p.ops).toEqual([
      { op: 'duplicate', id: 'A', patch: { x: 30, y: 40 }, ref: 'dup0' },
      { op: 'duplicate', id: 'B2', patch: { x: 840 }, ref: 'dup1' },
      { op: 'duplicate', id: 'R1', ref: 'dup2' },
    ]);
    expect(p && 'ops' in p && p.select).toEqual({ refs: ['dup0', 'dup1', 'dup2'] });
  });
  it('hapus hanya node teratas, satu plan, seleksi dikosongkan', () => {
    const p = planAction('delete', scene(), ['F1', 'F', 'A']);
    expect(p && 'ops' in p && p.ops).toEqual([
      { op: 'remove', id: 'F' },
      { op: 'remove', id: 'A' },
    ]);
    expect(p && 'ops' in p && p.select).toEqual({ ids: [] });
    expect(p && 'ops' in p && p.label).toBe('Delete 2 layers');
  });
});

describe('urutan z', () => {
  it('bring forward satu dan dua anggota bersebelahan', () => {
    expect(planAction('forward', scene(), ['A'])).toMatchObject({ ops: [{ op: 'move', id: 'A', parentId: 'B1', index: 1 }], label: 'Bring forward A' });
    expect(planAction('forward', scene(), ['A', 'C'])).toMatchObject({
      ops: [
        { op: 'move', id: 'C', parentId: 'B1', index: 2 },
        { op: 'move', id: 'A', parentId: 'B1', index: 1 },
      ],
    });
  });
  it('paling depan → undefined; board send backward → parentId null', () => {
    expect(planAction('forward', scene(), ['F'])).toBeUndefined();
    expect(planAction('backward', scene(), ['A'])).toBeUndefined();
    expect(planAction('backward', scene(), ['B2'])).toMatchObject({ ops: [{ op: 'move', id: 'B2', parentId: null, index: 0 }] });
  });
});

describe('align dan distribute', () => {
  it('align left ke bounding box; node yang sudah rata tidak mendapat op', () => {
    expect(planAction('align-left', scene(), ['A', 'C'])).toMatchObject({ ops: [{ op: 'update', id: 'C', patch: { x: 20 } }], label: 'Align left 2 layers' });
    expect(planAction('align-top', scene(), ['A', 'C'])).toMatchObject({ ops: [{ op: 'update', id: 'C', patch: { y: 30 } }] });
    expect(planAction('align-center', scene(), ['A', 'C'])).toMatchObject({
      ops: [
        { op: 'update', id: 'A', patch: { x: 65 } },
        { op: 'update', id: 'C', patch: { x: 60 } },
      ],
    });
  });
  it('node flow tidak bergerak; satu node absolut → terhadap parent', () => {
    expect(planAction('align-bottom', scene(), ['R1', 'A'])).toMatchObject({ ops: [{ op: 'update', id: 'A', patch: { y: 160 } }] });
    expect(planAction('align-right', scene(), ['F1'])).toMatchObject({ ops: [{ op: 'update', id: 'F1', patch: { x: 80 } }] });
    expect(planAction('align-middle', scene(), ['B1'])).toBeUndefined();
  });
  it('distribute horizontal: ujung tetap, jarak sama', () => {
    expect(planAction('distribute-h', scene(), ['F', 'A', 'C'])).toMatchObject({ ops: [{ op: 'update', id: 'C', patch: { x: 105 } }], label: 'Distribute horizontally 3 layers' });
    expect(planAction('distribute-v', scene(), ['A', 'C'])).toBeUndefined();
  });
  it('board ikut align (x halaman)', () => {
    expect(planAction('align-top', scene(), ['B1', 'B2'])).toBeUndefined();
    expect(planAction('align-left', scene(), ['B1', 'B2'])).toMatchObject({ ops: [{ op: 'update', id: 'B2', patch: { x: 100 } }] });
  });
});

describe('actionState', () => {
  it('menu mengikuti struktur seleksi', () => {
    const s = actionState(scene(), ['A', 'C']);
    expect(s).toMatchObject({ group: true, ungroup: false, duplicate: true, delete: true, forward: true, backward: false, 'align-left': true, 'distribute-h': false });
    expect(actionState(scene(), ['F'])).toMatchObject({ ungroup: true, group: true, 'align-left': true });
    expect(actionState(scene(), ['B1'])).toMatchObject({ group: false, ungroup: false, 'align-left': false, forward: true });
    expect(actionState(scene(), [])).toMatchObject({ group: false, duplicate: false, delete: false, forward: false });
    expect(actionState(scene(), ['R1', 'R2'])).toMatchObject({ group: true, 'align-left': false });
  });
});

describe('copy-png', () => {
  it('aktif tepat satu node tersimpan (board boleh); nonaktif seleksi kosong, jamak, atau alamat komposit', () => {
    expect(actionState(scene(), ['A'])['copy-png']).toBe(true);
    expect(actionState(scene(), ['B1'])['copy-png']).toBe(true);
    expect(actionState(scene(), [])['copy-png']).toBe(false);
    expect(actionState(scene(), ['A', 'C'])['copy-png']).toBe(false);
    expect(actionState(componentScene(), ['I/T'])['copy-png']).toBe(false);
    // Bukan op dokumen: plan selalu undefined (Viewer mengekspor PNG + menulis clipboard sendiri).
    expect(planAction('copy-png', scene(), ['A'])).toBeUndefined();
    expect(planAction('copy-png', scene(), ['B1'])).toBeUndefined();
  });
  it('Ctrl/⌘+Shift+C → copy-png; Ctrl/⌘+C tanpa shift bukan shortcut aksi', () => {
    const k = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
      shortcutAction({ key, code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
    expect(k('C', { ctrlKey: true, shiftKey: true })).toEqual({ action: 'copy-png' });
    expect(k('c', { metaKey: true, shiftKey: true })).toEqual({ action: 'copy-png' });
    expect(k('c', { ctrlKey: true })).toBeUndefined();
    expect(k('c', { ctrlKey: true, altKey: true })).toBeUndefined();
  });
});

describe('nudge, pilih semua, teks', () => {
  it('nudge hanya node absolut', () => {
    expect(nudgeOps([{ id: 'A', name: 'A', absolute: true, x: 20, y: 30 }, { id: 'R1', name: 'R1', absolute: false, x: 0, y: 0 }], 10, -1)).toEqual({
      ops: [{ op: 'update', id: 'A', patch: { x: 30, y: 29 } }],
      label: 'Nudge A',
    });
    expect(nudgeOps([{ id: 'R1', name: 'R1', absolute: false, x: 0, y: 0 }], 1, 0)).toBeUndefined();
  });
  it('Ctrl+A memakai scope seleksi primer', () => {
    expect(selectAllIds(scene(), [])).toEqual(['B1', 'B2']);
    expect(selectAllIds(scene(), ['B1'])).toEqual(['A', 'C', 'R', 'F']);
    expect(selectAllIds(scene(), ['B2'])).toEqual(['B2']);
    expect(selectAllIds(scene(), ['A', 'F1'])).toEqual(['F1', 'F2']);
  });
  it('edit teks: sama/kosong batal, label dipotong 200', () => {
    expect(textEditPlan('t', 'T', 'Hi', 'Hi')).toBeUndefined();
    expect(textEditPlan('t', 'T', 'Hi', '  \n')).toBeUndefined();
    expect(textEditPlan('t', 'T', 'Hi', 'Hi\nthere')).toEqual({ ops: [{ op: 'update', id: 't', patch: { content: 'Hi\nthere' } }], label: 'Edit text T' });
    expect(textEditPlan('t', 'x'.repeat(300), 'a', 'b')!.label.length).toBe(200);
  });
  it('normalisasi innerText', () => {
    expect(normalizeEditedText('a\r\nb\n', true)).toBe('a\nb');
    expect(normalizeEditedText('a\n', false)).toBe('a\n');
  });
});

describe('perbaikan review', () => {
  it('frame kosong tidak bisa di-ungroup (bukan hapus diam-diam)', () => {
    const s = scene();
    s[0]!.children.push(node('E', { x: 100, y: 100, w: 10, h: 10 }, { type: 'frame', layout: 'none', absolute: true, parentId: 'B1' }));
    expect(planAction('ungroup', s, ['E'])).toBeUndefined();
    expect(actionState(s, ['E']).ungroup).toBe(false);
  });
  it('group campuran absolut + flow: frame flow, semua anggota absolut relatif bounding box', () => {
    const p = planAction('group', scene(), ['A', 'R']);
    const ops = p && 'ops' in p ? p.ops : [];
    expect(ops[0]).toEqual({ op: 'add', parentId: 'B1', node: { type: 'frame', name: 'Group', layout: 'none', width: 400, height: 170 }, ref: 'group' });
    expect(ops).toContainEqual({ op: 'update', id: 'A', patch: { position: 'absolute', x: 20, y: 0 } });
    expect(ops).toContainEqual({ op: 'update', id: 'R', patch: { position: 'absolute', x: 0, y: 70 } });
    expect(ops.at(-1)).toEqual({ op: 'move', id: '@group', parentId: 'B1', index: 0 });
  });
  it('duplikat membulatkan x/y pecahan', () => {
    const s = scene();
    s[0]!.children[0]!.x = 20.4;
    expect(planAction('duplicate', s, ['A'])).toMatchObject({ ops: [{ op: 'duplicate', id: 'A', patch: { x: 30, y: 40 } }] });
  });
  it('shortcutAction memetakan tombol ke aksi', () => {
    const k = (key: string, o: Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => shortcutAction({ key, code: o.code ?? '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
    expect(k('Delete')).toEqual({ action: 'delete' });
    expect(k('Backspace')).toEqual({ action: 'delete' });
    expect(k('Delete', { shiftKey: true })).toBeUndefined();
    expect(k('g', { ctrlKey: true })).toEqual({ action: 'group' });
    expect(k('G', { metaKey: true, shiftKey: true })).toEqual({ action: 'ungroup' });
    expect(k('d', { ctrlKey: true })).toEqual({ action: 'duplicate' });
    expect(k('d', { ctrlKey: true, shiftKey: true })).toBeUndefined();
    expect(k(']', { ctrlKey: true, code: 'BracketRight' })).toEqual({ action: 'forward' });
    expect(k('[', { ctrlKey: true, code: 'BracketLeft' })).toEqual({ action: 'backward' });
    expect(k('å', { altKey: true, code: 'KeyA' })).toEqual({ action: 'align-left' });
    expect(k('h', { altKey: true, code: 'KeyH' })).toEqual({ action: 'align-center' });
    expect(k('H', { altKey: true, shiftKey: true, code: 'KeyH' })).toEqual({ action: 'distribute-h' });
    expect(k('V', { altKey: true, shiftKey: true, code: 'KeyV' })).toEqual({ action: 'distribute-v' });
    expect(k('A', { altKey: true, shiftKey: true, code: 'KeyA' })).toEqual({ action: 'unlayout' });
    expect(k('a', { ctrlKey: true })).toEqual({ selectAll: true });
    expect(k('ArrowRight')).toEqual({ nudge: [1, 0] });
    expect(k('ArrowUp', { shiftKey: true })).toEqual({ nudge: [0, -10] });
    expect(k('ArrowUp', { ctrlKey: true })).toBeUndefined();
    expect(k('x')).toBeUndefined();
  });
  it('selectionAfter: ids langsung, refs dipetakan respons, tanpa select → tetap', () => {
    expect(selectionAfter({ ops: [], label: 'x', select: { refs: ['group', 'missing'] } }, { group: 'G1' })).toEqual(['G1']);
    expect(selectionAfter({ ops: [], label: 'x', select: { ids: [] } }, {})).toEqual([]);
    expect(selectionAfter({ ops: [], label: 'x' }, {})).toBeUndefined();
  });
  it('nudgeNodes: x/y dari dokumen tersimpan, tanpa x → 0, tidak ada di dokumen → geometri', () => {
    const stored: Record<string, Record<string, unknown>> = { A: { x: 25, y: 35 }, F1: {} };
    const nodes = nudgeNodes(scene(), ['A', 'F1', 'C', 'R1'], (id) => stored[id]);
    expect(nodes).toEqual([
      { id: 'A', name: 'A', absolute: true, x: 25, y: 35 },
      { id: 'F1', name: 'F1', absolute: true, x: 0, y: 0 },
      { id: 'C', name: 'C', absolute: true, x: 100, y: 50 },
      { id: 'R1', name: 'R1', absolute: false, x: 0, y: 0 },
    ]);
  });
});

/** Scene komponen: Row R berisi instance I (isi komposit I/T, I/B) dan master M (anak M1); frame F biasa. */
function componentScene(): GeoNode[] {
  return [
    tree(
      node('B1', { x: 0, y: 0, w: 400, h: 400 }, {
        type: 'board',
        absolute: true,
        layout: 'column',
        children: [
          node('R', { x: 0, y: 0, w: 400, h: 100 }, {
            type: 'frame',
            layout: 'row',
            children: [
              node('I', { x: 0, y: 0, w: 100, h: 100 }, { type: 'frame', layout: 'column', component: 'instance', children: [node('I/T', { x: 0, y: 0, w: 50, h: 20 }, { type: 'text' }), node('I/B', { x: 0, y: 20, w: 100, h: 80 }, { type: 'frame', layout: 'column' })] }),
              node('M', { x: 100, y: 0, w: 100, h: 100 }, { type: 'frame', layout: 'column', component: 'master', children: [node('M1', { x: 100, y: 0, w: 50, h: 50 })] }),
              node('F', { x: 200, y: 0, w: 100, h: 100 }, { type: 'frame', layout: 'none', children: [node('F1', { x: 210, y: 10, w: 20, h: 20 }, { absolute: true, x: 10, y: 10 })] }),
            ],
          }),
        ],
      }),
    ),
  ];
}

describe('aksi komponen (epic komponen story 4)', () => {
  it('create component: satu node → setComponent; dua node / instance → group + nama + setComponent(@group)', () => {
    const s = componentScene();
    expect(planAction('create-component', s, ['F'])).toEqual({
      ops: [{ op: 'setComponent', id: 'F', component: { props: [], slots: [] } }],
      label: 'Create component F',
      select: { ids: ['F'] },
    });
    const multi = planAction('create-component', s, ['F', 'I']);
    expect(multi && 'ops' in multi && multi.ops.slice(-2)).toEqual([
      { op: 'update', id: '@group', patch: { name: 'Component' } },
      { op: 'setComponent', id: '@group', component: { props: [], slots: [] } },
    ]);
    expect(multi && 'ops' in multi && multi.ops[0]).toMatchObject({ op: 'add', parentId: 'R', ref: 'group' });
    expect(multi && 'select' in multi && multi.select).toEqual({ refs: ['group'] });
    const fromInstance = planAction('create-component', s, ['I']);
    expect(fromInstance && 'label' in fromInstance && fromInstance.label).toBe('Create component from I');
  });

  it('create component ditolak: board, isi instance, master, di dalam master, parent beda', () => {
    const s = componentScene();
    expect(planAction('create-component', s, ['B1'])).toEqual({ error: "Boards can't become components" });
    expect(planAction('create-component', s, ['I/T'])).toEqual({ error: "Layers inside an instance can't become components" });
    expect(planAction('create-component', s, ['M'])).toEqual({ error: 'This layer is already a component' });
    expect(planAction('create-component', s, ['M1'])).toEqual({ error: "Layers inside a component can't become components" });
    expect(planAction('create-component', s, ['F1', 'I'])).toEqual({ error: 'Select layers in the same parent to create a component' });
    expect(planAction('create-component', s, ['M', 'F'])).toEqual({ error: 'This layer is already a component' });
    expect(planAction('create-component', s, [])).toBeUndefined();
  });

  it('detach: satu op ber-ref per instance terpilih; tanpa instance → tidak ada plan', () => {
    const s = componentScene();
    expect(planAction('detach', s, ['I', 'F'])).toEqual({ ops: [{ op: 'detach', id: 'I', ref: 'det0' }], label: 'Detach I', select: { refs: ['det0'] } });
    expect(planAction('detach', s, ['F'])).toBeUndefined();
    expect(planAction('detach', s, ['I/T'])).toBeUndefined();
  });

  it('isi instance: aksi struktural tanpa plan dan nonaktif; ungroup instance nonaktif; update-based tetap', () => {
    const s = componentScene();
    for (const a of ['group', 'ungroup', 'duplicate', 'delete', 'forward', 'backward'] as const) expect(planAction(a, s, ['I/T'])).toBeUndefined();
    const st = actionState(s, ['I/T']);
    expect([st.group, st.ungroup, st.duplicate, st.delete, st.forward, st.backward, st['create-component'], st.detach]).toEqual([false, false, false, false, false, false, false, false]);
    expect(planAction('ungroup', s, ['I'])).toBeUndefined();
    const inst = actionState(s, ['I']);
    expect([inst.ungroup, inst.duplicate, inst.delete, inst.detach, inst['create-component']]).toEqual([false, true, true, true, true]);
    expect(actionState(s, ['M'])['create-component']).toBe(false);
  });

  it('shortcut Ctrl/⌘+Alt+K dan Ctrl/⌘+Alt+B', () => {
    const k = (code: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key: code.slice(3).toLowerCase(), code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
    expect(shortcutAction(k('KeyK', { ctrlKey: true, altKey: true }))).toEqual({ action: 'create-component' });
    expect(shortcutAction(k('KeyK', { metaKey: true, altKey: true }))).toEqual({ action: 'create-component' });
    expect(shortcutAction(k('KeyB', { ctrlKey: true, altKey: true }))).toEqual({ action: 'detach' });
    expect(shortcutAction(k('KeyK', { ctrlKey: true, altKey: true, shiftKey: true }))).toEqual({ gotoMain: true });
  });
});

/** Shortcut paritas Figma (spec-canvas-shortcuts): intent seleksi/rotate/gaya teks, aksi baru, dan kunci tampilan. */
describe('shortcut paritas Figma (spec-canvas-shortcuts)', () => {
  const k = (key: string, o: Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
    shortcutAction({ key, code: o.code ?? '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
  const v = (key: string, o: Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
    viewShortcut({ key, code: o.code ?? '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

  it('seleksi: inverse, masuk/parent, sibling', () => {
    expect(k('A', { ctrlKey: true, shiftKey: true, code: 'KeyA' })).toEqual({ selectInverse: true });
    expect(k('Enter')).toEqual({ enter: true });
    expect(k('Enter', { shiftKey: true })).toEqual({ parent: true });
    expect(k('\\')).toEqual({ parent: true });
    expect(k('Tab')).toEqual({ sibling: 1 });
    expect(k('Tab', { shiftKey: true })).toEqual({ sibling: -1 });
  });

  it('z ke ujung: bare ]/[ dan Ctrl/⌘+Shift+]/[', () => {
    expect(k(']')).toEqual({ action: 'front' });
    expect(k('[')).toEqual({ action: 'back' });
    expect(k(']', { ctrlKey: true, shiftKey: true, code: 'BracketRight' })).toEqual({ action: 'front' });
    expect(k('[', { metaKey: true, shiftKey: true, code: 'BracketLeft' })).toEqual({ action: 'back' });
    expect(k(']', { ctrlKey: true, code: 'BracketRight' })).toEqual({ action: 'forward' });
    expect(k('[', { ctrlKey: true, code: 'BracketLeft' })).toEqual({ action: 'backward' });
  });

  it('frame selection, auto layout, fit content, rename, master, varian', () => {
    expect(k('g', { ctrlKey: true, altKey: true, code: 'KeyG' })).toEqual({ action: 'wrap-frame' });
    expect(k('A', { shiftKey: true, code: 'KeyA' })).toEqual({ action: 'auto-layout' });
    expect(k('r', { ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyR' })).toEqual({ action: 'fit-content' });
    expect(k('r', { ctrlKey: true })).toEqual({ rename: true });
    expect(k('k', { ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyK' })).toEqual({ gotoMain: true });
    expect(k('q', { code: 'KeyQ' })).toEqual({ multiVariant: true });
  });

  it('rotate Ctrl/⌘+Alt+panah (Shift 15°) dan gaya teks', () => {
    expect(k('ArrowUp', { ctrlKey: true, altKey: true, code: 'ArrowUp' })).toEqual({ rotate: 1 });
    expect(k('ArrowDown', { metaKey: true, altKey: true, shiftKey: true, code: 'ArrowDown' })).toEqual({ rotate: -15 });
    expect(k('b', { ctrlKey: true })).toEqual({ textStyle: 'bold' });
    expect(k('i', { ctrlKey: true })).toEqual({ textStyle: 'italic' });
    expect(k('u', { metaKey: true })).toEqual({ textStyle: 'underline' });
    expect(k('>', { ctrlKey: true, shiftKey: true, code: 'Period' })).toEqual({ textStyle: 'size+' });
    expect(k('<', { ctrlKey: true, altKey: true, code: 'Comma' })).toEqual({ textStyle: 'weight-' });
    expect(k(',', { altKey: true, code: 'Comma' })).toEqual({ textStyle: 'spacing-' });
    expect(k('>', { altKey: true, shiftKey: true, code: 'Period' })).toEqual({ textStyle: 'leading+' });
    expect(k('l', { ctrlKey: true, altKey: true, code: 'KeyL' })).toEqual({ textStyle: 'align-left' });
    expect(k('r', { metaKey: true, altKey: true, code: 'KeyR' })).toEqual({ textStyle: 'align-right' });
  });

  it('resize Alt+panah 1px (Shift 10px)', () => {
    expect(k('ArrowRight', { altKey: true })).toEqual({ resize: [1, 0] });
    expect(k('ArrowLeft', { altKey: true })).toEqual({ resize: [-1, 0] });
    expect(k('ArrowDown', { altKey: true, shiftKey: true })).toEqual({ resize: [0, 10] });
    expect(k('ArrowUp', { altKey: true })).toEqual({ resize: [0, -1] });
    // Tanpa Alt tetap nudge; Alt+Shift+A tetap unlayout.
    expect(k('ArrowRight', { altKey: false })).toEqual({ nudge: [1, 0] });
    expect(k('A', { altKey: true, shiftKey: true, code: 'KeyA' })).toEqual({ action: 'unlayout' });
  });

  it('kunci tampilan: tab, proto, komentar, kursor, outline, panel, present, F6', () => {
    expect(v('E', { shiftKey: true, code: 'KeyE' })).toEqual({ view: 'toggle-proto' });
    expect(v('1', { altKey: true, code: 'Digit1' })).toEqual({ view: 'tab', tab: 0 });
    expect(v('3', { altKey: true, code: 'Digit3' })).toEqual({ view: 'tab', tab: 2 });
    expect(v('4', { altKey: true, code: 'Digit4' })).toBeUndefined();
    expect(v('C', { shiftKey: true, code: 'KeyC' })).toEqual({ view: 'comments' });
    expect(v('O', { shiftKey: true, code: 'KeyO' })).toEqual({ view: 'outline' });
    expect(v('I', { shiftKey: true, code: 'KeyI' })).toEqual({ view: 'tab', tab: 1 });
    expect(v('\\', { ctrlKey: true, altKey: true, code: 'Backslash' })).toEqual({ view: 'cursors' });
    expect(v('O', { ctrlKey: true, shiftKey: true, code: 'KeyO' })).toEqual({ view: 'outline' });
    expect(v('?', { ctrlKey: true, shiftKey: true, code: 'Slash' })).toEqual({ view: 'shortcuts' });
    expect(v(' ', { shiftKey: true, code: 'Space' })).toEqual({ view: 'present' });
    expect(v('Enter', { ctrlKey: true, altKey: true })).toEqual({ view: 'present' });
    expect(v('F6')).toEqual({ view: 'focus-cycle' });
    expect(v('a')).toBeUndefined();
  });
});

describe('seleksi navigasi (paritas Figma)', () => {
  it('selectInverseIds: komplemen seleksi di lingkup selectAll', () => {
    const s = scene();
    expect(selectInverseIds(s, ['A'])).toEqual(['C', 'R', 'F']);
    expect(selectInverseIds(s, [])).toEqual(['B1', 'B2']);
    expect(selectInverseIds(s, ['R2'])).toEqual(['R1', 'R3']);
  });
  it('enterChildId: kontainer → anak pertama; leaf/bukan kontainer → undefined', () => {
    const s = scene();
    expect(enterChildId(s, ['R'])).toBe('R1');
    expect(enterChildId(s, ['B1'])).toBe('A');
    expect(enterChildId(s, ['F'])).toBe('F1');
    expect(enterChildId(s, ['A'])).toBeUndefined();
    expect(enterChildId(s, ['A', 'C'])).toBeUndefined();
  });
  it('parentIdOf: parent node primer; puncak → undefined', () => {
    const s = scene();
    expect(parentIdOf(s, ['R2'])).toBe('R');
    expect(parentIdOf(s, ['A', 'R2'])).toBe('R');
    expect(parentIdOf(s, ['B1'])).toBeUndefined();
  });
  it('siblingIdOf: saudara sebelum/sesudah primer; di ujung → undefined', () => {
    const s = scene();
    expect(siblingIdOf(s, ['R2'], 1)).toBe('R3');
    expect(siblingIdOf(s, ['R2'], -1)).toBe('R1');
    expect(siblingIdOf(s, ['R3'], 1)).toBeUndefined();
    expect(siblingIdOf(s, ['A'], 1)).toBe('C');
    expect(siblingIdOf(s, ['B1'], 1)).toBe('B2');
  });
});

describe('plan aksi baru (paritas Figma)', () => {
  it('front/back: anggota ke ujung z tiap parent; sudah di ujung → tanpa plan', () => {
    const s = scene();
    expect(planAction('front', s, ['A'])).toMatchObject({ ops: [{ op: 'move', id: 'A', parentId: 'B1', index: 3 }] });
    expect(planAction('back', s, ['F'])).toMatchObject({ ops: [{ op: 'move', id: 'F', parentId: 'B1', index: 0 }] });
    expect(planAction('front', s, ['A', 'C'])).toMatchObject({ ops: [{ op: 'move', id: 'A', index: 2 }, { op: 'move', id: 'C', index: 3 }] });
    expect(planAction('front', s, ['F'])).toBeUndefined();
    expect(planAction('back', s, ['A'])).toBeUndefined();
  });
  it('wrap-frame: mekanika group dengan nama Frame', () => {
    const p = planAction('wrap-frame', scene(), ['C', 'A']);
    expect(p && 'ops' in p && p.ops[0]).toMatchObject({ op: 'add', parentId: 'B1', node: { type: 'frame', name: 'Frame', layout: 'none' } });
    expect(p && 'ops' in p && p.label).toBe('Frame selection 2 layers');
  });
  it('auto-layout: satu frame → layout row; multi → dibungkus frame row, anak jadi flow', () => {
    const s = scene();
    expect(planAction('auto-layout', s, ['F'])).toEqual({ ops: [{ op: 'update', id: 'F', patch: { layout: 'row' } }], label: 'Add auto layout to F' });
    const multi = planAction('auto-layout', s, ['A', 'C']);
    expect(multi && 'ops' in multi && multi.ops[0]).toMatchObject({ op: 'add', parentId: 'B1', node: { type: 'frame', name: 'Auto layout', layout: 'row' } });
    expect(multi && 'ops' in multi && multi.ops[1]).toEqual({ op: 'move', id: 'A', parentId: '@group' });
    expect(multi && 'ops' in multi && multi.ops[2]).toEqual({ op: 'update', id: 'A', patch: { position: null, x: null, y: null } });
    expect(planAction('auto-layout', s, ['R'])).toBeUndefined();
  });
  it('unlayout: frame row/column/grid → layout none; bukan auto layout → tanpa plan', () => {
    const s = scene();
    expect(planAction('unlayout', s, ['R'])).toMatchObject({ ops: [{ op: 'update', id: 'R', patch: { layout: 'none' } }] });
    expect(planAction('unlayout', s, ['F'])).toBeUndefined();
    expect(planAction('unlayout', s, ['A'])).toBeUndefined();
  });
  it('fit-content: frame absolut dirapatkan ke union anak; anak ikut bergeser', () => {
    const s = scene();
    expect(planAction('fit-content', s, ['F'])).toEqual({
      ops: [
        { op: 'update', id: 'F1', patch: { x: 0, y: 0 } },
        { op: 'update', id: 'F2', patch: { x: 40, y: 30 } },
        { op: 'update', id: 'F', patch: { x: 210, y: 210, width: 70, height: 60 } },
      ],
      label: 'Resize to fit F',
    });
    expect(planAction('fit-content', s, ['A'])).toBeUndefined();
  });
});

describe('resizeOps (paritas Figma Alt+panah)', () => {
  it('lebar/tinggi angka ±Δ min 1; non-angka/board/komposit dilewati', () => {
    const n = (id: string, o: Partial<{ width: number; height: number }>) => ({ id, name: id, type: 'rect', ...o });
    expect(resizeOps([n('A', { width: 100, height: 50 })], 10, 0)).toEqual({ ops: [{ op: 'update', id: 'A', patch: { width: 110 } }], label: 'Resize A' });
    expect(resizeOps([n('A', { width: 5, height: 50 })], -10, 0)).toMatchObject({ ops: [{ op: 'update', id: 'A', patch: { width: 1 } }] });
    expect(resizeOps([n('A', { width: 100, height: 50 })], 0, -1)).toMatchObject({ ops: [{ op: 'update', id: 'A', patch: { height: 49 } }] });
    // hug/fill (bukan angka) dan board → tanpa plan.
    expect(resizeOps([n('A', {}), { id: 'B', name: 'B', type: 'board', width: 400 }], 1, 0)).toBeUndefined();
  });
});

describe('rotateOps / textStyleOps (paritas Figma)', () => {
  it('rotateOps: rotation += deg; board/alamat komposit dilewati, tanpa anggota → undefined', () => {
    expect(rotateOps([{ id: 'A', name: 'A', type: 'rect', rotation: 15 }], 15)).toEqual({ ops: [{ op: 'update', id: 'A', patch: { rotation: 30 } }], label: 'Rotate A' });
    expect(rotateOps([{ id: 'A', name: 'A', type: 'rect' }], -1)).toMatchObject({ ops: [{ op: 'update', id: 'A', patch: { rotation: -1 } }] });
    expect(rotateOps([{ id: 'B1', name: 'B1', type: 'board' }, { id: 'I/T', name: 'T', type: 'text' }], 1)).toBeUndefined();
  });
  it('textStyleOps: toggle bold/italic/underline, size naik-turun skala, weight ±100', () => {
    const t = (o: Partial<{ weight: number; style: string; decoration: string; size: number; lineHeight: number; letterSpacing: number }>) => ({ id: 't', name: 'T', type: 'text', ...o });
    expect(textStyleOps([t({ weight: 700 })], 'bold')).toMatchObject({ ops: [{ op: 'update', id: 't', patch: { weight: 400 } }] });
    expect(textStyleOps([t({})], 'bold')).toMatchObject({ ops: [{ op: 'update', id: 't', patch: { weight: 700 } }] });
    expect(textStyleOps([t({ style: 'italic' })], 'italic')).toMatchObject({ ops: [{ op: 'update', id: 't', patch: { style: 'normal' } }] });
    expect(textStyleOps([t({})], 'underline')).toMatchObject({ ops: [{ op: 'update', id: 't', patch: { decoration: 'underline' } }] });
    expect(textStyleOps([t({})], 'align-left')).toMatchObject({ ops: [{ op: 'update', id: 't', patch: { align: 'left' } }] });
    expect(textStyleOps([t({})], 'align-right')).toMatchObject({ ops: [{ op: 'update', id: 't', patch: { align: 'right' } }] });
    expect(textStyleOps([t({ size: 16 })], 'size+')).toMatchObject({ ops: [{ op: 'update', id: 't', patch: { size: 18 } }] });
    expect(textStyleOps([t({ size: 16 })], 'size-')).toMatchObject({ ops: [{ op: 'update', id: 't', patch: { size: 14 } }] });
    expect(textStyleOps([t({ weight: 400 })], 'weight+')).toMatchObject({ ops: [{ op: 'update', id: 't', patch: { weight: 500 } }] });
    expect(textStyleOps([t({ weight: 100 })], 'weight-')).toMatchObject({ ops: [{ op: 'update', id: 't', patch: { weight: 100 } }] });
    expect(textStyleOps([t({ letterSpacing: 0 })], 'spacing+')).toMatchObject({ ops: [{ op: 'update', id: 't', patch: { letterSpacing: 0.5 } }] });
    expect(textStyleOps([t({ lineHeight: 20 })], 'leading+')).toMatchObject({ ops: [{ op: 'update', id: 't', patch: { lineHeight: 24 } }] });
    // Bukan teks → tanpa plan; token (size non-angka) dilewati.
    expect(textStyleOps([{ id: 'r', name: 'R', type: 'rect' }], 'bold')).toBeUndefined();
    expect(textStyleOps([t({})], 'size+')).toBeUndefined();
  });
});
