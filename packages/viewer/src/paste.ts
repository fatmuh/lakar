// Paste SVG/HTML di viewer (epic paste-vektor story 3–4; desain G0vf1/nE6dL dan rkIyP/GXHxW, Toast r69qO, Paste Report
// w2am0). Murni, tanpa DOM dan tanpa IO: deteksi isi clipboard, target parent dari seleksi, dan teks toast/report dari
// laporan importer daemon (AD-15; importer tidak ada di viewer).
import type { LakarDocument } from '@lakar/schema';

/** Laporan importer (bentuk respons route paste daemon). */
export type PasteDropKind = 'element' | 'attribute' | 'value' | 'request' | 'property' | 'font' | 'layout';
export type PasteDrop = { kind: PasteDropKind; name: string; count: number };
export type SvgPasteReport = { kind: 'svg'; paths: number; kept: string[]; dropped: PasteDrop[] };
export type HtmlPasteReport = { kind: 'html'; layers: number; autoLayout: number; texts: number; images: number; vectors: number; dropped: PasteDrop[] };
export type ToolPasteReport = { kind: 'figma' | 'pen'; layers: number; autoLayout: number; texts: number; images?: number; vectors?: number; dropped: PasteDrop[] };
export type PasteReport = SvgPasteReport | HtmlPasteReport | ToolPasteReport;

/**
 * Teks yang dianggap SVG: elemen pertama `<svg` sesudah BOM, spasi, komentar, prolog `<?xml …?>`, dan DOCTYPE.
 * Dokumen XML lain (mis. XHTML berisi SVG inline) bukan SVG.
 */
export function svgFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  let s = text.replace(/^\uFEFF/, '').trimStart();
  for (;;) {
    const close = s.startsWith('<!--') ? '-->' : s.startsWith('<?') ? '?>' : /^<!doctype/i.test(s) ? '>' : undefined;
    if (!close) break;
    const end = s.indexOf(close);
    if (end === -1) return undefined;
    s = s.slice(end + close.length).trimStart();
  }
  return /^<svg[\s>/]/i.test(s) ? text : undefined;
}

/**
 * Pilihan paste dari clipboard: file SVG dulu (nama file = nama layer), lalu teks SVG; selain itu undefined (paste
 * dibiarkan, tanpa `preventDefault`).
 */
export function clipboardSvg<F extends { type: string; name: string }>(input: { files: readonly F[]; text: string | undefined }): { file: F; name: string | undefined } | { text: string } | undefined {
  const file = input.files.find(isSvgFile);
  if (file) return { file, name: fileLayerName(file.name) };
  const text = svgFromText(input.text);
  return text ? { text } : undefined;
}

/** HTML clipboard tool desain: `<span data-buffer>` berisi payload fig-kiwi (Figma dan yang kompatibel). */
export const isFigmaEnvelope = (html: string | undefined): boolean => !!html && /data-buffer="<!--\(figma\)|data-buffer="[^"]{100,}"/i.test(html);

/** text/plain JSON pohon node .pen (pen.dev): objek/array dengan properti `type` string di dalamnya. */
export function isPenJson(text: string | undefined): boolean {
  const s = text?.trim();
  if (!s || (s[0] !== '{' && s[0] !== '[') || !/"type"\s*:/.test(s)) return false;
  try {
    const p: unknown = JSON.parse(s);
    const nodes = Array.isArray(p) ? p : [p, ...(['objects', 'children', 'layers', 'nodes'] as const).map((k) => (p as Record<string, unknown>)?.[k])].flat().filter(Boolean);
    return nodes.some((n) => !!n && typeof n === 'object' && typeof (n as { type?: unknown }).type === 'string');
  } catch {
    return false;
  }
}

/**
 * Pilihan paste dari clipboard (story 4 + spec-paste-design-tools): SVG lebih dulu (file, lalu teks), lalu
 * envelope Figma (`data-buffer` kiwi), JSON .pen, lalu `text/html` yang berisi markup; selain itu undefined.
 */
export function clipboardPaste<F extends { type: string; name: string }>(input: {
  files: readonly F[];
  text: string | undefined;
  html: string | undefined;
  /** Base64 buffer dari MIME kustom (application/x-figma-design, dst.) bila viewer membacanya. */
  toolBuffer?: string | undefined;
}): { file: F; name: string | undefined } | { text: string } | { html: string } | { figma: string } | { pen: string } | undefined {
  if (input.toolBuffer) return { figma: input.toolBuffer };
  const svg = clipboardSvg(input);
  if (svg) return svg;
  if (isFigmaEnvelope(input.html)) return { figma: input.html! };
  if (isPenJson(input.text)) return { pen: input.text! };
  // Kode HTML disalin dari editor/chat: text/plain berisi markup (text/html, bila ada, hanya pewarnaan sintaks).
  if (htmlSource(input.text)) return { html: input.text! };
  const html = input.html?.trim() ? input.html : undefined;
  if (!html || !/<[a-z!]/i.test(html)) return undefined;
  // Salin gambar dari browser: file gambar + text/html berisi satu <img> saja → bukan potongan HTML (dibiarkan).
  if (input.files.some((f) => f.type.startsWith('image/')) && isImageOnly(html)) return undefined;
  return { html };
}

/** text/plain yang berupa kode HTML: diawali tag/DOCTYPE/komentar dan memuat tag penutup atau tag kosong. */
export function htmlSource(text: string | undefined): boolean {
  const s = text?.replace(/^\uFEFF/, '').trim() ?? '';
  return /^<(!doctype html|!--|[a-z][a-z0-9-]*[\s>/])/i.test(s) && /<\/[a-z][a-z0-9-]*\s*>|\/>\s*$/i.test(s);
}

/** HTML clipboard yang hanya membungkus satu <img> (meta/komentar/fragmen markers diabaikan). */
const isImageOnly = (html: string): boolean =>
  /^<img\b[^>]*>$/i.test(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/?(html|head|body|meta)\b[^>]*>/gi, '')
      .trim(),
  );

/** "Undo paste" hanya bila entri paste masih teratas di tumpukan undo jendela ini. */
export const canUndoPaste = (undo: readonly unknown[], entry: unknown): boolean => entry !== undefined && undo[undo.length - 1] === entry;

/** File SVG dari clipboard/drop. */
export const isSvgFile = (f: { type: string; name: string }): boolean => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);

/** Nama layer dari nama file (`rocket.svg` → `rocket`). */
export function fileLayerName(name: string): string | undefined {
  const s = name.replace(/\.svg$/i, '').trim();
  return s ? s.slice(0, 120) : undefined;
}

export const PASTE_NO_TARGET = 'Select a board or frame to paste into.';

type TreeNode = { id: string; type: string; children?: TreeNode[] };

/**
 * Tujuan paste dari seleksi (alamat terakhir dipilih): board/frame terpilih itu sendiri, selain itu kontainer leluhur
 * terdekat. Alamat isi instance (`I/…`) memakai instance terluar; instance bukan tujuan, jadi naik ke parent-nya.
 */
export function pasteTarget(doc: Pick<LakarDocument, 'pages'>, selection: readonly string[]): { parentId: string } | { error: string } {
  const last = selection[selection.length - 1];
  if (!last) return { error: PASTE_NO_TARGET };
  const id = last.split('/')[0]!;
  const find = (n: TreeNode, chain: TreeNode[]): TreeNode[] | undefined => {
    const next = [...chain, n];
    if (n.id === id) return next;
    for (const c of n.children ?? []) {
      const hit = find(c, next);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const p of doc.pages) {
    for (const b of p.children as unknown as TreeNode[]) {
      const chain = find(b, []);
      if (!chain) continue;
      for (let i = chain.length - 1; i >= 0; i--) {
        const n = chain[i]!;
        if (n.type === 'board' || n.type === 'frame') return { parentId: n.id };
      }
    }
  }
  return { error: PASTE_NO_TARGET };
}

const KEPT_LABELS: Record<string, string> = {
  'fill-rule': 'fill-rule',
  'stroke-linecap': 'stroke caps',
  'stroke-linejoin': 'joins',
  'stroke-dasharray': 'dashes',
  'stroke-dashoffset': 'dash offsets',
  'stroke-miterlimit': 'miter limits',
  'fill-opacity': 'fill opacity',
  'stroke-opacity': 'stroke opacity',
  'paint-order': 'paint order',
  'shape-rendering': 'shape rendering',
  opacity: 'opacity',
  transform: 'transforms',
};

/** `a`, `a and b`, `a, b and c`. */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Judul toast/report: "Pasted SVG as 4 paths" / "Pasted 14 layers from HTML" / "Pasted 8 layers from Figma". */
export const pasteTitle = (r: PasteReport): string =>
  r.kind === 'svg'
    ? `Pasted SVG as ${plural(r.paths, 'path')}`
    : `Pasted ${plural(r.layers, 'layer')} from ${r.kind === 'html' ? 'HTML' : r.kind === 'figma' ? 'Figma' : 'a design tool'}`;

const dropName = (d: PasteReport['dropped'][number]) => (d.kind === 'value' ? `${d.name} value` : d.name);
/** Maks nama yang disebut di toast; sisanya diringkas menjadi "N more". */
const TOAST_NAMES_MAX = 4;

/** Deskripsi toast: "Kept fill-rule, stroke caps and dashes. Not imported: filter, <mask> (no matching property)." */
export function pasteDescription(r: PasteReport): string {
  if (r.kind === 'html' || r.kind === 'figma' || r.kind === 'pen') return htmlKept(r);
  const parts: string[] = [];
  const kept = r.kept.map((k) => KEPT_LABELS[k] ?? k);
  if (kept.length) parts.push(`Kept ${joinList(kept)}.`);
  if (r.dropped.length) {
    const names = r.dropped.map(dropName);
    const shown = names.length > TOAST_NAMES_MAX ? [...names.slice(0, TOAST_NAMES_MAX - 1), `${names.length - TOAST_NAMES_MAX + 1} more`] : names;
    const values = r.dropped.filter((d) => d.kind === 'value').length;
    const why = values === 0 ? 'no matching property' : values === r.dropped.length ? 'unsupported values' : 'no matching property or unsupported values';
    parts.push(`Not imported: ${shown.join(', ')} (${why}).`);
  }
  return parts.length ? parts.join(' ') : 'All attributes kept.';
}

/** "Auto layout, text and 2 images kept as layers" (desain rkIyP); tanpa rincian → "Layers kept". */
export function htmlKept(r: Pick<HtmlPasteReport, 'autoLayout' | 'texts'> & { images?: number; vectors?: number }): string {
  const parts = [r.autoLayout ? 'auto layout' : '', r.texts ? 'text' : '', r.images ? plural(r.images, 'image') : '', r.vectors ? plural(r.vectors, 'vector') : ''].filter(Boolean);
  if (!parts.length) return 'Layers kept';
  const s = `${joinList(parts)} kept as layers`;
  return s[0]!.toUpperCase() + s.slice(1);
}

export type PasteReportItem = { icon: 'code' | 'paintbrush' | 'imageOff' | 'type'; what: string; why: string };

/** Nama laporan snapshot terpotong (daemon `paste/html.ts` TRUNCATED_NAME). */
const TRUNCATED_NAME = 'elements beyond the import limit';
/** Alasan pembuangan per jenis (laporan HTML). */
const SCRIPT_WHY = 'Scripts never run and are not stored';
const REQUEST_PLURAL: Record<string, string> = { 'external image': 'external images', 'external stylesheet': 'external stylesheets', 'external font': 'external fonts', 'network request': 'network requests' };

/** Baris "Not imported" laporan HTML: elemen/permintaan/font per baris; properti, nilai, dan layout digabung satu baris. */
function htmlItems(r: HtmlPasteReport): PasteReportItem[] {
  const out: PasteReportItem[] = [];
  const grouped = new Map<string, PasteReportItem>();
  const group = (key: string, name: string, why: string) => {
    const g = grouped.get(key);
    if (g) g.what = `${g.what}, ${name}`;
    else {
      const it: PasteReportItem = { icon: 'paintbrush', what: name, why };
      grouped.set(key, it);
      out.push(it);
    }
  };
  for (const d of r.dropped) {
    switch (d.kind) {
      case 'element':
        if (d.name === TRUNCATED_NAME) out.push({ icon: 'code', what: 'Elements beyond the import limit', why: 'Too many elements — paste a smaller snippet' });
        else out.push({ icon: 'code', what: d.count > 1 ? `${d.count} × ${d.name}` : d.name, why: d.name === '<script>' ? SCRIPT_WHY : 'No matching Lakar layer' });
        break;
      case 'attribute':
        out.push({ icon: 'code', what: d.count > 1 ? `${d.count} × ${d.name}` : d.name, why: /^on/i.test(d.name) ? SCRIPT_WHY : 'No matching Lakar property' });
        break;
      case 'request':
        out.push({ icon: 'imageOff', what: `${d.count} ${d.count === 1 ? d.name : (REQUEST_PLURAL[d.name] ?? d.name)}`, why: 'Network is blocked while importing' });
        break;
      case 'font':
        out.push({ icon: 'type', what: `font “${d.name}”`, why: 'Not installed — replaced with Inter' });
        break;
      case 'property':
        group('property', d.name, 'No matching Lakar property');
        break;
      case 'layout':
        group('layout', d.name, 'Kept with fixed positions');
        break;
      default:
        group('value', d.name, 'Value not supported');
    }
  }
  return out;
}

/** Baris "Not imported" Paste Report (w2am0). */
export function pasteReportItems(r: PasteReport): PasteReportItem[] {
  if (r.kind === 'html') return htmlItems(r);
  if (r.kind === 'figma' || r.kind === 'pen')
    return r.dropped.map((d) => ({
      icon: 'code' as const,
      what: d.count > 1 ? `${d.count} × ${dropName(d)}` : dropName(d),
      why: 'No matching Lakar layer',
    }));
  return r.dropped.map((d) => ({
    icon: d.kind === 'element' ? 'code' : 'paintbrush',
    what: d.count > 1 ? `${d.count} × ${dropName(d)}` : dropName(d),
    why: d.kind === 'value' ? 'Value not supported' : 'No matching Lakar property',
  }));
}

/** Deskripsi header report: "4 paths in “Icon / Rocket” · 1 change in History" / "Auto layout and text kept as layers · 1 change in History". */
export const pasteReportDescription = (r: PasteReport, layer: string): string =>
  r.kind === 'svg' ? `${plural(r.paths, 'path')} in “${layer}” · 1 change in History` : `${htmlKept(r)} · 1 change in History`;

/** Teks "Copy report". */
export function pasteReportText(r: PasteReport, layer: string): string {
  const items = pasteReportItems(r);
  const lines = r.kind === 'svg' ? [pasteTitle(r), pasteReportDescription(r, layer), pasteDescription(r)] : [pasteTitle(r), pasteReportDescription(r, layer)];
  if (items.length) lines.push(`Not imported (${items.length}):`, ...items.map((i) => `- ${i.what}: ${i.why}`));
  return lines.join('\n');
}
