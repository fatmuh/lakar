// Paste SVG viewer (epic paste-vektor story 3): deteksi clipboard, target parent, teks toast dan report (desain
// G0vf1/nE6dL, r69qO, w2am0).
import { describe, expect, it } from 'vitest';
import { PASTE_NO_TARGET, canUndoPaste, clipboardPaste, clipboardSvg, htmlKept, htmlSource, fileLayerName, isSvgFile, joinList, pasteDescription, pasteReportDescription, pasteReportItems, pasteReportText, pasteTarget, pasteTitle, svgFromText, type PasteReport } from './paste.js';

const doc = {
  pages: [
    {
      id: 'Pg000001',
      name: 'P',
      children: [
        {
          id: 'Brd00001',
          type: 'board',
          children: [
            { id: 'Frm00001', type: 'frame', children: [{ id: 'Txt00001', type: 'text' }] },
            { id: 'Ins00001', type: 'instance' },
            { id: 'Rct00001', type: 'rect' },
          ],
        },
      ],
    },
  ],
} as never;

describe('svgFromText / file', () => {
  it('teks diawali <svg atau <?xml (sesudah spasi, BOM, komentar) dikenali; lainnya tidak', () => {
    expect(svgFromText('  <svg viewBox="0 0 1 1"/>')).toBe('  <svg viewBox="0 0 1 1"/>');
    expect(svgFromText('\uFEFF<!-- x --><svg>')).toBeDefined();
    expect(svgFromText('<?xml version="1.0"?><svg></svg>')).toBeDefined();
    expect(svgFromText('<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<!-- c --><svg/>')).toBeDefined();
    for (const t of [undefined, '', 'hello <svg>', '<svgx>', '<div><svg/></div>', '<?xml version="1.0"?><html/>', '<!-- open', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><svg/></body></html>']) expect(svgFromText(t), String(t)).toBeUndefined();
  });

  it('file SVG dari tipe atau ekstensi; nama layer tanpa ekstensi', () => {
    expect(isSvgFile({ type: 'image/svg+xml', name: 'a' })).toBe(true);
    expect(isSvgFile({ type: '', name: 'Rocket.SVG' })).toBe(true);
    expect(isSvgFile({ type: 'image/png', name: 'a.png' })).toBe(false);
    expect(fileLayerName('rocket.svg')).toBe('rocket');
    expect(fileLayerName('.svg')).toBeUndefined();
  });
});

describe('pasteTarget', () => {
  it('board/frame terpilih = tujuan; node lain → kontainer leluhur; instance/isi instance → parent instance', () => {
    expect(pasteTarget(doc, ['Frm00001'])).toEqual({ parentId: 'Frm00001' });
    expect(pasteTarget(doc, ['Brd00001'])).toEqual({ parentId: 'Brd00001' });
    expect(pasteTarget(doc, ['Txt00001'])).toEqual({ parentId: 'Frm00001' });
    expect(pasteTarget(doc, ['Frm00001', 'Rct00001'])).toEqual({ parentId: 'Brd00001' });
    expect(pasteTarget(doc, ['Ins00001/Abc00001'])).toEqual({ parentId: 'Brd00001' });
  });

  it('tanpa seleksi atau id hilang → pesan', () => {
    expect(pasteTarget(doc, [])).toEqual({ error: PASTE_NO_TARGET });
    expect(pasteTarget(doc, ['Gone0001'])).toEqual({ error: PASTE_NO_TARGET });
  });
});

describe('teks toast dan report', () => {
  const report: PasteReport = {
    kind: 'svg',
    paths: 4,
    kept: ['fill-rule', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray'],
    dropped: [
      { kind: 'attribute', name: 'filter', count: 1 },
      { kind: 'element', name: '<mask>', count: 2 },
    ],
  };

  it('judul dan deskripsi sesuai desain', () => {
    expect(pasteTitle(report)).toBe('Pasted SVG as 4 paths');
    expect(pasteTitle({ ...report, paths: 1 })).toBe('Pasted SVG as 1 path');
    expect(pasteDescription(report)).toBe('Kept fill-rule, stroke caps, joins and dashes. Not imported: filter, <mask> (no matching property).');
    expect(pasteDescription({ ...report, kept: [], dropped: [] })).toBe('All attributes kept.');
    expect(pasteDescription({ ...report, kept: [], dropped: [{ kind: 'value', name: 'fill', count: 1 }] })).toBe('Not imported: fill value (unsupported values).');
    const many = Array.from({ length: 6 }, (_, i) => ({ kind: 'attribute' as const, name: `a${i}`, count: 1 }));
    expect(pasteDescription({ ...report, kept: [], dropped: many })).toBe('Not imported: a0, a1, a2, 3 more (no matching property).');
  });

  it('baris report, deskripsi, dan teks salin', () => {
    expect(pasteReportItems(report)).toEqual([
      { icon: 'paintbrush', what: 'filter', why: 'No matching Lakar property' },
      { icon: 'code', what: '2 × <mask>', why: 'No matching Lakar property' },
    ]);
    expect(pasteReportDescription(report, 'Icon / Rocket')).toBe('4 paths in “Icon / Rocket” · 1 change in History');
    expect(pasteReportText(report, 'X')).toContain('Not imported (2):\n- filter: No matching Lakar property\n- 2 × <mask>: No matching Lakar property');
    expect(joinList(['a'])).toBe('a');
    expect(joinList(['a', 'b'])).toBe('a and b');
  });
});

describe('clipboardSvg / canUndoPaste', () => {
  it('file SVG didahulukan (nama layer dari file); teks SVG; selain itu dibiarkan', () => {
    const svgFile = { type: 'image/svg+xml', name: 'rocket.svg' };
    const png = { type: 'image/png', name: 'a.png' };
    expect(clipboardSvg({ files: [png, svgFile], text: '<svg/>' })).toEqual({ file: svgFile, name: 'rocket' });
    expect(clipboardSvg({ files: [png], text: '<svg/>' })).toEqual({ text: '<svg/>' });
    expect(clipboardSvg({ files: [png], text: 'hello' })).toBeUndefined();
    expect(clipboardSvg({ files: [], text: undefined })).toBeUndefined();
  });

  it('Undo paste hanya bila entri paste masih teratas', () => {
    const paste = { label: 'Paste SVG' };
    const later = { label: 'Move' };
    expect(canUndoPaste([paste], paste)).toBe(true);
    expect(canUndoPaste([paste, later], paste)).toBe(false);
    expect(canUndoPaste([], paste)).toBe(false);
    expect(canUndoPaste([], undefined)).toBe(false);
  });
});

describe('paste HTML (story 4, desain rkIyP/GXHxW)', () => {
  const html: PasteReport = {
    kind: 'html',
    layers: 14,
    autoLayout: 3,
    texts: 6,
    images: 2,
    vectors: 0,
    dropped: [
      { kind: 'element', name: '<script>', count: 2 },
      { kind: 'request', name: 'external image', count: 1 },
      { kind: 'property', name: 'backdrop-filter', count: 1 },
      { kind: 'property', name: 'outline', count: 3 },
      { kind: 'font', name: 'Satoshi', count: 4 },
      { kind: 'attribute', name: 'onclick', count: 1 },
      { kind: 'layout', name: 'margins', count: 1 },
      { kind: 'value', name: 'border-style', count: 1 },
      { kind: 'request', name: 'external stylesheet', count: 2 },
    ],
  };

  it('clipboard: SVG didahulukan (teks SVG dari editor kode juga membawa text/html); text/html bermarkup → html; teks biasa dibiarkan', () => {
    const svg = '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>';
    expect(clipboardPaste({ files: [], text: svg, html: '<pre><span>&lt;svg</span></pre>' })).toEqual({ text: svg });
    expect(clipboardPaste({ files: [], text: 'Card', html: '<meta charset="utf-8"><div class="card">Card</div>' })).toEqual({ html: '<meta charset="utf-8"><div class="card">Card</div>' });
    expect(clipboardPaste({ files: [], text: 'hello', html: '' })).toBeUndefined();
    expect(clipboardPaste({ files: [], text: 'hello', html: 'hello' })).toBeUndefined();
    // Kode HTML dari editor (text/plain = markup, text/html = pewarnaan sintaks) → markup text/plain yang diimpor.
    const code = '<div class="card">\n  <h3>Title</h3>\n</div>';
    expect(clipboardPaste({ files: [], text: code, html: '<pre><span>&lt;div</span></pre>' })).toEqual({ html: code });
    expect(htmlSource('<a < b')).toBe(false);
    expect(htmlSource('<img src="data:x" />')).toBe(true);
    // Salin gambar dari browser: file gambar + text/html satu <img> → dibiarkan.
    const png = { type: 'image/png', name: 'image.png' };
    expect(clipboardPaste({ files: [png], text: '', html: '<meta charset="utf-8"><img src="https://x/a.png" alt="">' })).toBeUndefined();
    expect(clipboardPaste({ files: [png], text: '', html: '<div><img src="https://x/a.png"> Caption</div>' })).toEqual({ html: '<div><img src="https://x/a.png"> Caption</div>' });
  });

  it('snapshot terpotong punya alasan sendiri di report', () => {
    const r: PasteReport = { kind: 'html', layers: 1, autoLayout: 0, texts: 1, images: 0, vectors: 0, dropped: [{ kind: 'element', name: 'elements beyond the import limit', count: 1 }] };
    expect(pasteReportItems(r)).toEqual([{ icon: 'code', what: 'Elements beyond the import limit', why: 'Too many elements — paste a smaller snippet' }]);
  });

  it('judul, deskripsi, baris report, dan teks salin', () => {
    expect(pasteTitle(html)).toBe('Pasted 14 layers from HTML');
    expect(pasteReportDescription(html, 'Card')).toBe('Auto layout, text and 2 images kept as layers · 1 change in History');
    expect(htmlKept({ ...html, autoLayout: 0, texts: 0, images: 0, vectors: 1 })).toBe('1 vector kept as layers');
    expect(htmlKept({ ...html, autoLayout: 0, texts: 0, images: 0 })).toBe('Layers kept');
    expect(pasteReportItems(html)).toEqual([
      { icon: 'code', what: '2 × <script>', why: 'Scripts never run and are not stored' },
      { icon: 'imageOff', what: '1 external image', why: 'Network is blocked while importing' },
      { icon: 'paintbrush', what: 'backdrop-filter, outline', why: 'No matching Lakar property' },
      { icon: 'type', what: 'font “Satoshi”', why: 'Not installed — replaced with Inter' },
      { icon: 'code', what: 'onclick', why: 'Scripts never run and are not stored' },
      { icon: 'paintbrush', what: 'margins', why: 'Kept with fixed positions' },
      { icon: 'paintbrush', what: 'border-style', why: 'Value not supported' },
      { icon: 'imageOff', what: '2 external stylesheets', why: 'Network is blocked while importing' },
    ]);
    expect(pasteReportText(html, 'Card').split('\n').slice(0, 3)).toEqual(['Pasted 14 layers from HTML', 'Auto layout, text and 2 images kept as layers · 1 change in History', 'Not imported (8):']);
  });
});

describe('clipboard tool desain (spec-paste-design-tools)', () => {
  it('envelope figma (data-buffer) → kind figma; pen JSON → kind pen; MIME kustom didahulukan', () => {
    const figmaHtml = '<meta charset="utf-8"><span data-buffer="<!--(figma)ZmlnLWtpd2kAAAAABAAAAA==(/figma)-->"></span>';
    expect(clipboardPaste({ files: [], text: 'Frame', html: figmaHtml })).toEqual({ figma: figmaHtml });
    const pen = '{"type":"frame","name":"S","children":[{"type":"text","name":"t"}]}';
    expect(clipboardPaste({ files: [], text: pen, html: undefined })).toEqual({ pen });
    expect(clipboardPaste({ files: [], text: 'x', html: figmaHtml, toolBuffer: 'ZmlnLWtpd2kA' })).toEqual({ figma: 'ZmlnLWtpd2kA' });
    // JSON biasa tanpa node bertipe → bukan pen.
    expect(clipboardPaste({ files: [], text: '{"a":1}', html: undefined })).toBeUndefined();
  });
});
