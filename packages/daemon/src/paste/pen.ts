// Importer clipboard pen.dev (spec-paste-design-tools): `.pen` adalah pohon objek JSON (id/type per docs
// pencil.dev). Clipboard menaruh JSON di text/plain — objek tunggal, array, atau {objects|children|layers}.
// Mapping toleran: tipe .pen dipetakan ke tipe Lakar, properti yang namanya sama dengan shape Lakar
// diteruskan (name/x/y/width/height/radius/opacity/rotation/layout/gap/padding/fills/stroke/content/align),
// `fill` string → fills solid, anak lewat `children`. Yang tak dikenal → frame + laporan dropped.
import type { ImportedNode } from './html.js';
import type { PasteDropped } from './svg.js';

export class PenImportError extends Error {}

export type PenReport = { kind: 'pen'; layers: number; autoLayout: number; texts: number; dropped: PasteDropped[] };
export type PenImport = { node: ImportedNode; report: PenReport };

const PEN_TYPE: Record<string, string> = {
  frame: 'frame',
  group: 'frame',
  container: 'frame',
  section: 'frame',
  rectangle: 'rect',
  rect: 'rect',
  ellipse: 'ellipse',
  circle: 'ellipse',
  text: 'text',
  path: 'path',
  icon: 'icon',
};

/** Kunci properti yang aman diteruskan ke ImportedNode (nama identik dengan shape Lakar). */
const PASS = new Set([
  'width',
  'height',
  'x',
  'y',
  'radius',
  'opacity',
  'rotation',
  'layout',
  'gap',
  'padding',
  'align',
  'justify',
  'clip',
  'wrap',
  'fills',
  'stroke',
  'shadows',
  'blur',
  'content',
  'family',
  'weight',
  'style',
  'size',
  'lineHeight',
  'letterSpacing',
  'color',
  'd',
  'src',
]);

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** text/plain dari clipboard → objek/array .pen, atau undefined kalau bukan JSON pohon node. */
export function penJsonSource(text: string | undefined): Record<string, unknown>[] | undefined {
  const s = text?.replace(/^﻿/, '').trim();
  if (!s || (s[0] !== '{' && s[0] !== '[')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return undefined;
  }
  const roots = penRoots(parsed);
  return roots.length ? roots : undefined;
}

/** Akar pohon: array objek bertipe, atau objek tunggal bertipe, atau {objects|children|layers:[…]}. */
export function penRoots(parsed: unknown): Record<string, unknown>[] {
  const isNode = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string';
  if (Array.isArray(parsed)) return parsed.filter(isNode);
  if (isNode(parsed)) return [parsed];
  if (parsed && typeof parsed === 'object') {
    for (const k of ['objects', 'children', 'layers', 'nodes'] as const) {
      const v = (parsed as Record<string, unknown>)[k];
      if (Array.isArray(v) && v.some(isNode)) return v.filter(isNode);
    }
  }
  return [];
}

function mapPen(src: Record<string, unknown>, dropped: Map<string, number>): ImportedNode {
  const penType = String(src.type).toLowerCase();
  const type = PEN_TYPE[penType];
  if (!type) dropped.set(`<${penType}>`, (dropped.get(`<${penType}>`) ?? 0) + 1);
  const node: ImportedNode = { type: type ?? 'frame', name: typeof src.name === 'string' ? src.name : String(src.type) };
  for (const [k, v] of Object.entries(src)) {
    if (!PASS.has(k) || v === undefined || v === null) continue;
    (node as Record<string, unknown>)[k] = v;
  }
  // `fill` string (warna) → fills solid; paint object/array kompleks diteruskan via PASS.fills.
  if (typeof src.fill === 'string' && node.fills === undefined) node.fills = [{ type: 'solid', color: src.fill }];
  const kids = Array.isArray(src.children) ? src.children.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object') : [];
  if (kids.length) node.children = kids.map((c) => mapPen(c, dropped));
  if (type === 'text' && typeof node.content !== 'string') node.content = '';
  // Ukuran non-angka (token/'hug'/'fill') sudah cocok dengan Dimension; angka dibulatkan.
  if (num(node.width) !== undefined) node.width = Math.round(node.width as number);
  if (num(node.height) !== undefined) node.height = Math.round(node.height as number);
  return node;
}

export function importPen(jsonText: string, opts: { name?: string } = {}): PenImport {
  const roots = penJsonSource(jsonText);
  if (!roots?.length) throw new PenImportError('content bukan pohon node .pen (JSON dengan properti type)');
  const dropped = new Map<string, number>();
  const built = roots.map((r) => mapPen(r, dropped));
  const root: ImportedNode =
    built.length === 1 ? built[0]! : { type: 'frame', name: opts.name ?? 'Pasted layers', children: built, width: 'hug', height: 'hug' };
  let layers = 0;
  let autoLayout = 0;
  let texts = 0;
  const count = (n: ImportedNode) => {
    layers++;
    if (n.layout === 'row' || n.layout === 'column') autoLayout++;
    if (n.type === 'text') texts++;
    for (const c of n.children ?? []) count(c);
  };
  count(root);
  return {
    node: root,
    report: { kind: 'pen', layers, autoLayout, texts, dropped: [...dropped].map(([name, count]) => ({ kind: 'element' as const, name, count })) },
  };
}
