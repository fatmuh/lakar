// Importer clipboard Figma (spec-paste-design-tools): HTML envelope (span data-buffer = base64 fig-kiwi)
// atau binary `application/x-figma-design` yang di-base64-kan viewer → decode Kiwi → NodeChange[] →
// ImportedNode. Satu pohon: anak dirangkai lewat `parentIndex.guid`. Mencakup sumber yang menulis format
// yang sama: Figma, OpenPencil (x-figma-design), dan tool lain yang kompatibel envelope Figma (Paper, Wonder).
// Mapping best-effort: nama/geometri/paint/layout/teks tersimpan; image fill jadi placeholder + laporan
// dropped; vector network tidak didekode (dilaporkan).
import { inflateSync, zstdDecompressSync } from 'node:zlib';
import { decodeKiwi, type KiwiMessage, type KiwiValue } from './kiwi.js';
import type { ImportedNode } from './html.js';
import type { PasteDropped } from './svg.js';

export class FigmaImportError extends Error {}

export type FigmaReport = {
  kind: 'figma';
  layers: number;
  autoLayout: number;
  texts: number;
  images: number;
  vectors: number;
  dropped: PasteDropped[];
};

export type FigmaImport = { node: ImportedNode; report: FigmaReport };

/** `data-buffer="<!--(figma)BASE64(/figma)-->"` atau `data-buffer="BASE64"` dari HTML clipboard. */
export function figmaBufferBase64(html: string): string | undefined {
  const m = /data-buffer="<!--\(figma\)([\s\S]*?)\(\/figma\)-->"|data-buffer="([A-Za-z0-9+/=\s]+?)"/.exec(html);
  const raw = (m?.[1] ?? m?.[2])?.replace(/\s+/g, '');
  return raw && raw.length > 16 ? raw : undefined;
}

type Guid = { sessionID?: number | bigint; localID?: number | bigint };
type NodeChange = KiwiMessage & { guid?: KiwiMessage; parentIndex?: KiwiMessage; type?: string; name?: string };

const msg = (v: unknown): KiwiMessage | undefined => (v && typeof v === 'object' && '$type' in v ? (v as KiwiMessage) : undefined);
const arr = (v: unknown): KiwiMessage[] => (Array.isArray(v) ? v.map(msg).filter((m): m is KiwiMessage => !!m) : []);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'bigint' ? Number(v) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const round = (n: number): number => Math.round(n * 100) / 100;

const guidKey = (g: Guid | undefined): string | undefined => {
  const s = num(g?.sessionID);
  const l = num(g?.localID);
  return s === undefined || l === undefined ? undefined : `${s}:${l}`;
};

/** Cari array NodeChange di message akar (field bernama nodeChanges, atau array pertama berisi message ber-`guid`+`type`). */
function nodeChanges(root: KiwiMessage): NodeChange[] {
  for (const v of Object.values(root)) {
    const items = arr(v as KiwiValue);
    if (items.length && items.every((m) => 'guid' in m && 'type' in m)) return items as NodeChange[];
  }
  return [];
}

/** Warna Figma {r,g,b,a} 0..1 → hex Lakar (#rrggbb / #rrggbbaa). */
function hex(c: KiwiMessage | undefined): string | undefined {
  const r = num(c?.r);
  const g = num(c?.g);
  const b = num(c?.b);
  const a = num(c?.a) ?? 1;
  if (r === undefined || g === undefined || b === undefined) return undefined;
  const h = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
  return a >= 0.999 ? `#${h(r)}${h(g)}${h(b)}` : `#${h(r)}${h(g)}${h(b)}${h(a)}`;
}

/** Paint Figma → entri `fills` Lakar; image/gif → undefined (dilaporkan). */
function paint(p: KiwiMessage): Record<string, unknown> | undefined {
  if (p.visible === false) return undefined;
  const type = str(p.type);
  if (type === 'SOLID') {
    const color = hex(msg(p.color));
    if (!color) return undefined;
    const out: Record<string, unknown> = { type: 'solid', color };
    const o = num(p.opacity);
    if (o !== undefined && o < 1) out.opacity = round(o);
    return out;
  }
  if (type === 'GRADIENT_LINEAR' || type === 'GRADIENT_RADIAL' || type === 'GRADIENT_ANGULAR' || type === 'GRADIENT_DIAMOND') {
    const stops = arr(p.gradientStops)
      .map((s) => {
        const color = hex(msg(s.color));
        const position = num(s.position);
        return color !== undefined && position !== undefined ? { color, position: round(position) } : undefined;
      })
      .filter((s): s is { color: string; position: number } => !!s);
    if (!stops.length) return undefined;
    const kind = type === 'GRADIENT_LINEAR' ? 'linear' : type === 'GRADIENT_RADIAL' ? 'radial' : type === 'GRADIENT_ANGULAR' ? 'conic' : 'diamond';
    return { type: 'gradient', kind, stops };
  }
  return undefined; // IMAGE, GIF_PATTERN, VIDEO…
}

const LAKAR_TYPE: Record<string, string> = {
  RECTANGLE: 'rect',
  ROUNDED_RECTANGLE: 'rect',
  ELLIPSE: 'ellipse',
  TEXT: 'text',
  FRAME: 'frame',
  SECTION: 'frame',
  GROUP: 'frame',
  INSTANCE: 'frame',
  COMPONENT: 'frame',
  COMPONENT_SET: 'frame',
  BOOLEAN_OPERATION: 'frame',
};

const JUSTIFY: Record<string, string> = { MIN: 'start', CENTER: 'center', MAX: 'end', SPACE_EVENLY: 'space-between' };
const ALIGN: Record<string, string> = { MIN: 'start', CENTER: 'center', MAX: 'end', STRETCH: 'stretch' };
const TEXT_ALIGN: Record<string, string> = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' };

function mapNode(nc: NodeChange, children: ImportedNode[], dropped: Map<string, number>): ImportedNode | undefined {
  if (nc.visible === false) return undefined;
  const ftype = str(nc.type) ?? 'FRAME';
  const name = str(nc.name) || ftype;
  const isVectorLike = ftype === 'VECTOR' || ftype === 'LINE' || ftype === 'STAR' || ftype === 'REGULAR_POLYGON';
  const type = LAKAR_TYPE[ftype] ?? (isVectorLike ? 'rect' : 'frame');
  const node: ImportedNode = { type, name };

  const t = msg(nc.transform);
  const x = num(t?.m02);
  const y = num(t?.m12);
  if (x !== undefined) node.x = round(x);
  if (y !== undefined) node.y = round(y);
  const size = msg(nc.size);
  const w = num(size?.x);
  const h = num(size?.y);
  if (w !== undefined) node.width = round(w);
  if (h !== undefined) node.height = round(h);
  const rot = t ? Math.atan2(num(t.m10) ?? 0, num(t.m00) ?? 1) * (180 / Math.PI) : 0;
  if (Math.abs(rot) > 0.01) node.rotation = round(rot);
  const op = num(nc.opacity);
  if (op !== undefined && op < 1) node.opacity = round(op);

  const fills = arr(nc.fillPaints).map(paint).filter((f): f is Record<string, unknown> => !!f);
  const imgCount = arr(nc.fillPaints).filter((p) => str(p.type) === 'IMAGE' || str(p.type) === 'GIF_PATTERN').length;
  if (imgCount) dropped.set('image fills', (dropped.get('image fills') ?? 0) + imgCount);
  if (fills.length) node.fills = fills;

  const strokes = arr(nc.strokePaints).map(paint).filter((f): f is Record<string, unknown> => !!f);
  const sw = num(nc.strokeWeight);
  if (strokes.length && sw !== undefined) {
    const c = str(msg(strokes[0]!.color)) ? hex(msg(strokes[0]!.color)) : (strokes[0]!.color as string | undefined);
    node.stroke = { color: c ?? '#000', width: round(sw) };
  }
  const cr = num(nc.cornerRadius);
  const corners = Array.isArray(nc.rectangleCornerRadii) ? (nc.rectangleCornerRadii as unknown[]).map(num).filter((n): n is number => n !== undefined) : [];
  if (corners.length === 4 && corners.some((n) => n !== corners[0])) node.radius = corners.map(round) as unknown as ImportedNode['radius'];
  else if (cr !== undefined && cr > 0) node.radius = round(cr);

  const stack = str(nc.stackMode);
  if (type === 'frame' && (stack === 'HORIZONTAL' || stack === 'VERTICAL')) {
    node.layout = stack === 'HORIZONTAL' ? 'row' : 'column';
    const sp = num(nc.stackSpacing);
    if (sp !== undefined) node.gap = round(sp);
    const pad = (n: string): number | undefined => num(msg(nc[n]) ? undefined : (nc[`stack${n}Padding`] ?? (msg(nc.stackPadding) as KiwiMessage | undefined)?.[n.toLowerCase()]));
    const padV = num((nc as Record<string, unknown>).stackVerticalPadding);
    const padH = num((nc as Record<string, unknown>).stackHorizontalPadding);
    if (padV !== undefined || padH !== undefined) node.padding = [padV ?? 0, padH ?? 0].map(round);
    void pad;
    const j = JUSTIFY[str(nc.stackPrimaryAlign) ?? ''];
    const a = ALIGN[str(nc.stackCounterAlign) ?? ''];
    if (j) node.justify = j;
    if (a && a !== 'stretch') node.align = a;
    const primary = str(nc.stackPrimarySizing);
    const counter = str(nc.stackCounterSizing);
    if (stack === 'HORIZONTAL') {
      if (primary === 'AUTO') node.width = 'hug';
      if (counter === 'AUTO') node.height = 'hug';
      if (primary === 'FILL') node.width = 'fill';
      if (counter === 'FILL') node.height = 'fill';
    } else {
      if (primary === 'AUTO') node.height = 'hug';
      if (counter === 'AUTO') node.width = 'hug';
      if (primary === 'FILL') node.height = 'fill';
      if (counter === 'FILL') node.width = 'fill';
    }
  }

  if (ftype === 'TEXT') {
    node.content = str(nc.characters) ?? '';
    const fs = num(nc.fontSize);
    if (fs !== undefined) node.size = round(fs);
    const font = msg(nc.fontName);
    if (str(font?.family)) node.family = str(font!.family);
    const weight = num((font?.postScriptName && undefined) as unknown as number) ?? num((nc as Record<string, unknown>).fontWeight as unknown);
    void weight;
    const align = TEXT_ALIGN[str(nc.textAlignHorizontal) ?? ''];
    if (align) node.align = align;
    const lh = num(msg(nc.lineHeight)?.value);
    if (lh !== undefined) node.lineHeight = round(lh);
    const ls = num(msg(nc.letterSpacing)?.value);
    if (ls !== undefined) node.letterSpacing = round(ls);
    if (fills.length) node.color = (fills[0]!.color as string) ?? undefined;
  }

  if (isVectorLike) dropped.set('vector geometry', (dropped.get('vector geometry') ?? 0) + 1);
  if (children.length) node.children = children;
  return node;
}

/** Decode base64 fig-kiwi → pohon ImportedNode akar (frame pembungkus pilihan). */
export function importFigma(bufferB64: string, opts: { name?: string } = {}): FigmaImport {
  // Base64 (envelope data-buffer) dulu; kalau bukan fig-kiwi, coba byte mentah (getData MIME kustom → string latin1).
  const candidates = [Buffer.from(bufferB64, 'base64'), Buffer.from(bufferB64, 'latin1')];
  const bytes = candidates.find((b) => b.length > 12 && b.subarray(0, 8).toString('latin1') === 'fig-kiwi');
  if (!bytes) throw new FigmaImportError('data-buffer bukan buffer fig-kiwi');
  const { message } = decodeKiwi(bytes, { inflate: inflateSync, zstd: zstdDecompressSync });
  const changes = nodeChanges(message);
  if (!changes.length) throw new FigmaImportError('tidak ada layer di clipboard Figma');

  const byKey = new Map<string, NodeChange>();
  for (const nc of changes) {
    const k = guidKey(msg(nc.guid) as Guid | undefined);
    if (k) byKey.set(k, nc);
  }
  const kidsOf = (k: string): NodeChange[] =>
    changes
      .filter((c) => {
        const p = msg(c.parentIndex);
        return guidKey(msg(p?.guid) as Guid | undefined) === k;
      })
      .sort((a, b) => (num(msg(a.parentIndex)?.position) ?? 0) - (num(msg(b.parentIndex)?.position) ?? 0));

  const dropped = new Map<string, number>();
  const roots = changes.filter((c) => {
    const p = msg(c.parentIndex);
    const pk = guidKey(msg(p?.guid) as Guid | undefined);
    return !pk || !byKey.has(pk);
  });
  const build = (nc: NodeChange): ImportedNode | undefined => {
    const k = guidKey(msg(nc.guid) as Guid | undefined);
    const kids = k ? kidsOf(k).map(build).filter((n): n is ImportedNode => !!n) : [];
    return mapNode(nc, kids, dropped);
  };
  const built = roots.map(build).filter((n): n is ImportedNode => !!n);
  if (!built.length) throw new FigmaImportError('semua layer Figma tersembunyi atau kosong');

  const root: ImportedNode =
    built.length === 1
      ? built[0]!
      : { type: 'frame', name: opts.name ?? 'Pasted layers', children: built, x: 0, y: 0, width: 'hug', height: 'hug' };

  let layers = 0;
  let autoLayout = 0;
  let texts = 0;
  const count = (n: ImportedNode) => {
    layers++;
    if (n.layout) autoLayout++;
    if (n.type === 'text') texts++;
    for (const c of n.children ?? []) count(c);
  };
  count(root);
  const vectors = dropped.get('vector geometry') ?? 0;
  const images = dropped.get('image fills') ?? 0;
  const report: FigmaReport = {
    kind: 'figma',
    layers,
    autoLayout,
    texts,
    images,
    vectors,
    dropped: [...dropped].map(([name, count]) => ({ kind: 'element' as const, name, count })),
  };
  return { node: root, report };
}
