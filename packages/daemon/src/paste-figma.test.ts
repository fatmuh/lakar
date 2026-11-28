// Tes spec-paste-design-tools: decoder Kiwi (round-trip schema+message buatan test encoder) dan importer
// clipboard Figma (envelope → NodeChange → ImportedNode) + pen JSON.
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { figmaBufferBase64, importFigma } from './paste/figma.js';
import { PenImportError, importPen } from './paste/pen.js';
import { decodeBinarySchema } from './paste/kiwi.js';

// ---- Encoder Kiwi minimal untuk fixture (mirror ByteBuffer tulis evanw/kiwi). ----
class WB {
  private bytes: number[] = [];
  byte(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }
  varUint(v: number): this {
    do {
      const b = v & 127;
      v = Math.floor(v / 128);
      this.bytes.push(v ? b | 128 : b);
    } while (v);
    return this;
  }
  varInt(v: number): this {
    return this.varUint(v < 0 ? ((-v) << 1) - 1 : v << 1);
  }
  varFloat(v: number): this {
    const f = new Float32Array(1);
    const i = new Int32Array(f.buffer);
    f[0] = v;
    let bits = i[0]!;
    bits = (bits >>> 23) | (bits << 9);
    if ((bits & 255) === 0) return this.byte(0);
    this.byte(bits & 0xff).byte((bits >> 8) & 0xff).byte((bits >> 16) & 0xff).byte((bits >> 24) & 0xff);
    return this;
  }
  str(s: string): this {
    for (const c of Buffer.from(s, 'utf8')) this.byte(c);
    return this.byte(0);
  }
  out(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

// Schema mini bergaya Figma: Message{nodeChanges:[NodeChange]} + tipe pendukung.
const DEFS = [
  { name: 'GUID', kind: 1, fields: [{ name: 'sessionID', type: 'uint' }, { name: 'localID', type: 'uint' }] },
  { name: 'NodeType', kind: 0, fields: [{ name: 'FRAME', value: 1 }, { name: 'RECTANGLE', value: 2 }, { name: 'TEXT', value: 3 }, { name: 'ELLIPSE', value: 4 }] },
  { name: 'PaintType', kind: 0, fields: [{ name: 'SOLID', value: 1 }, { name: 'IMAGE', value: 2 }] },
  { name: 'StackMode', kind: 0, fields: [{ name: 'NONE', value: 0 }, { name: 'HORIZONTAL', value: 1 }, { name: 'VERTICAL', value: 2 }] },
  { name: 'Color', kind: 1, fields: [{ name: 'r', type: 'float' }, { name: 'g', type: 'float' }, { name: 'b', type: 'float' }, { name: 'a', type: 'float' }] },
  { name: 'Paint', kind: 2, fields: [{ name: 'type', type: 'PaintType', value: 1 }, { name: 'color', type: 'Color', value: 2 }, { name: 'visible', type: 'bool', value: 3 }] },
  { name: 'Vector', kind: 1, fields: [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }] },
  { name: 'Matrix', kind: 1, fields: [{ name: 'm00', type: 'float' }, { name: 'm01', type: 'float' }, { name: 'm02', type: 'float' }, { name: 'm10', type: 'float' }, { name: 'm11', type: 'float' }, { name: 'm12', type: 'float' }] },
  { name: 'ParentIndex', kind: 1, fields: [{ name: 'guid', type: 'GUID' }, { name: 'position', type: 'int' }] },
  {
    name: 'NodeChange',
    kind: 2,
    fields: [
      { name: 'guid', type: 'GUID', value: 1 },
      { name: 'parentIndex', type: 'ParentIndex', value: 2 },
      { name: 'type', type: 'NodeType', value: 3 },
      { name: 'name', type: 'string', value: 4 },
      { name: 'visible', type: 'bool', value: 5 },
      { name: 'transform', type: 'Matrix', value: 6 },
      { name: 'size', type: 'Vector', value: 7 },
      { name: 'fillPaints', type: 'Paint', value: 8, isArray: true },
      { name: 'stackMode', type: 'StackMode', value: 9 },
      { name: 'characters', type: 'string', value: 10 },
      { name: 'fontSize', type: 'float', value: 11 },
    ],
  },
  { name: 'Message', kind: 2, fields: [{ name: 'nodeChanges', type: 'NodeChange', value: 1, isArray: true }] },
];

const PRIMS = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64'];

function encodeSchema(): Uint8Array {
  const w = new WB();
  w.varUint(DEFS.length);
  for (const d of DEFS) {
    w.str(d.name).byte(d.kind).varUint(d.fields.length);
    for (const f of d.fields) {
      w.str(f.name);
      const t = f.type ? (PRIMS.includes(f.type) ? ~PRIMS.indexOf(f.type) : DEFS.findIndex((x) => x.name === f.type)) : 0;
      w.varInt(t).byte((f as { isArray?: boolean }).isArray ? 1 : 0).varUint((f as { value?: number }).value ?? 0);
    }
  }
  return w.out();
}

function encodeValue(w: WB, type: string | undefined, v: unknown, isArray?: boolean): void {
  if (isArray) {
    const items = v as unknown[];
    w.varUint(items.length);
    for (const i of items) encodeValue(w, type, i);
    return;
  }
  if (type === 'string') w.str(v as string);
  else if (type === 'uint') w.varUint(v as number);
  else if (type === 'int') w.varInt(v as number);
  else if (type === 'bool') w.byte(v ? 1 : 0);
  else if (type === 'float') w.varFloat(v as number);
  else {
    const def = DEFS.find((d) => d.name === type)!;
    if (def.kind === 0) {
      const member = def.fields.find((f) => f.name === v);
      w.varUint(member ? member.value! : (v as number));
    } else if (def.kind === 1) {
      const s = v as Record<string, unknown>;
      for (const f of def.fields) encodeValue(w, f.type, s[f.name] ?? (f.type === 'bool' ? false : 0));
    } else encodeMessage(w, type!, v as Record<string, unknown>);
  }
}

function encodeMessage(w: WB, defName: string, msg: Record<string, unknown>): void {
  const def = DEFS.find((d) => d.name === defName)!;
  for (const f of def.fields) {
    if (msg[f.name] === undefined) continue;
    w.varUint(f.value!);
    encodeValue(w, f.type, msg[f.name], (f as { isArray?: boolean }).isArray);
  }
  w.varUint(0);
}

function figKiwiBuffer(nodeChanges: Record<string, unknown>[]): string {
  const w = new WB();
  w.varUint(1); // field nodeChanges
  w.varUint(nodeChanges.length);
  for (const nc of nodeChanges) encodeMessage(w, 'NodeChange', nc);
  w.varUint(0);
  const msg = w.out();
  const schema = deflateSync(encodeSchema());
  const data = deflateSync(msg);
  const head = new WB();
  for (const c of 'fig-kiwi') head.byte(c.charCodeAt(0));
  const view = (n: number) => {
    const b = new DataView(new ArrayBuffer(4));
    b.setUint32(0, n, true);
    return [...new Uint8Array(b.buffer)];
  };
  for (const b of view(0)) head.byte(b);
  for (const b of view(schema.length)) head.byte(b);
  for (const b of schema) head.byte(b);
  for (const b of view(data.length)) head.byte(b);
  for (const b of data) head.byte(b);
  return Buffer.from(head.out()).toString('base64');
}

const guid = (s: number, l: number) => ({ sessionID: s, localID: l });
const XY = (x: number, y: number) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });
const WH = (x: number, y: number) => ({ x, y });

describe('kiwi decoder', () => {
  it('decodes binary schema', () => {
    const defs = decodeBinarySchema(encodeSchema());
    expect(defs.map((d) => d.name)).toContain('NodeChange');
    const nc = defs.find((d) => d.name === 'NodeChange')!;
    expect(nc.kind).toBe('MESSAGE');
    expect(nc.fields.find((f) => f.name === 'fillPaints')).toMatchObject({ type: 'Paint', isArray: true, value: 8 });
    expect(nc.fields.find((f) => f.name === 'type')).toMatchObject({ type: 'NodeType' });
  });
});

describe('importFigma', () => {
  it('maps a frame with solid fill, text child, and auto layout', () => {
    const b64 = figKiwiBuffer([
      {
        guid: guid(1, 1),
        type: 'FRAME',
        name: 'Card',
        transform: XY(10, 20),
        size: WH(200, 100),
        stackMode: 'HORIZONTAL',
        fillPaints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }],
      },
      { guid: guid(1, 2), parentIndex: { guid: guid(1, 1), position: 0 }, type: 'TEXT', name: 'Title', characters: 'Hello', fontSize: 16, transform: XY(8, 8), size: WH(50, 20) },
      { guid: guid(1, 3), parentIndex: { guid: guid(1, 1), position: 1 }, type: 'RECTANGLE', name: 'Box', transform: XY(8, 40), size: WH(30, 30) },
    ]);
    const { node, report } = importFigma(b64);
    expect(node).toMatchObject({
      type: 'frame',
      name: 'Card',
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      layout: 'row',
      fills: [{ type: 'solid', color: '#ff0000' }],
    });
    expect(node.children).toHaveLength(2);
    expect(node.children![0]).toMatchObject({ type: 'text', name: 'Title', content: 'Hello', size: 16 });
    expect(node.children![1]).toMatchObject({ type: 'rect', name: 'Box' });
    expect(report).toMatchObject({ kind: 'figma', layers: 3, autoLayout: 1, texts: 1 });
  });

  it('wraps multiple roots in a frame and drops hidden nodes', () => {
    const b64 = figKiwiBuffer([
      { guid: guid(1, 1), type: 'RECTANGLE', name: 'A', size: WH(10, 10) },
      { guid: guid(1, 2), type: 'ELLIPSE', name: 'B', visible: false },
      { guid: guid(1, 3), type: 'RECTANGLE', name: 'C', size: WH(5, 5) },
    ]);
    const { node } = importFigma(b64);
    expect(node.type).toBe('frame');
    expect(node.children!.map((c) => c.name)).toEqual(['A', 'C']);
  });

  it('rejects a non-kiwi buffer', () => {
    expect(() => importFigma(Buffer.from('hello world this is not kiwi').toString('base64'))).toThrow(/fig-kiwi/);
  });

  it('extracts data-buffer from clipboard HTML', () => {
    const b64 = 'ZmlnLWtpd2kAAAAABAAAAA==';
    const html = `<meta charset="utf-8"><span data-buffer="<!--(figma)${b64}(/figma)-->"></span>`;
    expect(figmaBufferBase64(html)).toBe(b64);
  });
});

describe('importPen', () => {
  it('maps .pen JSON objects', () => {
    const json = JSON.stringify({
      type: 'frame',
      name: 'Screen',
      x: 0,
      y: 0,
      width: 320,
      height: 200,
      children: [
        { type: 'text', name: 'Hi', content: 'Hello', size: 14 },
        { type: 'rectangle', name: 'Btn', width: 80, height: 32, fill: '#0066ff' },
      ],
    });
    const { node, report } = importPen(json);
    expect(node).toMatchObject({ type: 'frame', name: 'Screen', width: 320 });
    expect(node.children![1]).toMatchObject({ type: 'rect', fills: [{ type: 'solid', color: '#0066ff' }] });
    expect(report).toMatchObject({ kind: 'pen', layers: 3, texts: 1 });
  });

  it('rejects non-node JSON', () => {
    expect(() => importPen('{"foo": 1}')).toThrow(PenImportError ? Error : Error);
    expect(() => importPen('123')).toThrow();
  });
});
