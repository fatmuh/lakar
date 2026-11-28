// Decoder Kiwi generik (spec-paste-design-tools): ByteBuffer + decodeBinarySchema + decodeMessage dinamis.
// Di-vendor dari evanw/kiwi (MIT, https://github.com/evanw/kiwi) — hanya sisi baca; schema tertanam di tiap
// buffer fig-kiwi jadi tidak perlu schema Figma yang di-hardcode. Decode menghasilkan field bernetuk
// { nama: nilai } sesuai nama di schema biner; enum jadi nama membernya, message bersarang jadi objek.

const TYPES: readonly (string | null)[] = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64'];
const KINDS = ['ENUM', 'STRUCT', 'MESSAGE'] as const;
export type KiwiKind = (typeof KINDS)[number];
export type KiwiField = { name: string; type: string | null; isArray: boolean; value: number };
export type KiwiDef = { name: string; kind: KiwiKind; fields: KiwiField[] };
export type KiwiValue = string | number | bigint | boolean | KiwiMessage | KiwiValue[];
/** Message terdecode: nama field → nilai. `$type` = nama definisi di schema. */
export type KiwiMessage = { $type: string } & Record<string, unknown>;

const int32 = new Int32Array(1);
const float32 = new Float32Array(int32.buffer);

export class ByteBuffer {
  private index = 0;
  constructor(private readonly data: Uint8Array) {}
  get done(): boolean {
    return this.index >= this.data.length;
  }
  readByte(): number {
    if (this.index + 1 > this.data.length) throw new Error('Index out of bounds');
    return this.data[this.index++]!;
  }
  readBytes(length: number): Uint8Array {
    const end = this.index + length;
    if (end > this.data.length) throw new Error('Read array out of bounds');
    const out = this.data.subarray(this.index, end);
    this.index = end;
    return out;
  }
  readVarFloat(): number {
    const d = this.data;
    let i = this.index;
    const first = this.readByte();
    if (first === 0) return 0;
    if (i + 4 > d.length) throw new Error('Index out of bounds');
    let bits = first | (d[i + 1]! << 8) | (d[i + 2]! << 16) | (d[i + 3]! << 24);
    this.index = i + 4;
    bits = (bits << 23) | (bits >>> 9);
    int32[0] = bits;
    return float32[0]!;
  }
  readVarUint(): number {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.readByte();
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128 && shift < 35);
    return value >>> 0;
  }
  readVarInt(): number {
    const v = this.readVarUint() | 0;
    return v & 1 ? ~(v >>> 1) : v >>> 1;
  }
  readVarUint64(): bigint {
    let value = 0n;
    let shift = 0n;
    let byte: number;
    while (((byte = this.readByte()) & 128) !== 0 && shift < 56n) {
      value |= BigInt(byte & 127) << shift;
      shift += 7n;
    }
    return value | (BigInt(byte) << shift);
  }
  readVarInt64(): bigint {
    const v = this.readVarUint64();
    const sign = v & 1n;
    const out = v >> 1n;
    return sign ? ~out : out;
  }
  readString(): string {
    let out = '';
    for (;;) {
      const a = this.readByte();
      let cp: number;
      if (a < 0xc0) cp = a;
      else {
        const b = this.readByte();
        if (a < 0xe0) cp = ((a & 0x1f) << 6) | (b & 0x3f);
        else {
          const c = this.readByte();
          if (a < 0xf0) cp = ((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f);
          else {
            const d = this.readByte();
            cp = ((a & 0x07) << 18) | ((b & 0x3f) << 12) | ((c & 0x3f) << 6) | (d & 0x3f);
          }
        }
      }
      if (cp === 0) return out;
      if (cp < 0x10000) out += String.fromCharCode(cp);
      else {
        cp -= 0x10000;
        out += String.fromCharCode((cp >> 10) + 0xd800, (cp & 0x3ff) + 0xdc00);
      }
    }
  }
}

/** Decode schema biner (chunk pertama fig-kiwi) → daftar definisi bernama. */
export function decodeBinarySchema(buffer: Uint8Array): KiwiDef[] {
  const bb = new ByteBuffer(buffer);
  const count = bb.readVarUint();
  const defs: KiwiDef[] = [];
  for (let i = 0; i < count; i++) {
    const name = bb.readString();
    const kind = KINDS[bb.readByte()]!;
    const fieldCount = bb.readVarUint();
    const fields: KiwiField[] = [];
    for (let j = 0; j < fieldCount; j++) {
      const fieldName = bb.readString();
      const type = bb.readVarInt();
      const isArray = (bb.readByte() & 1) !== 0;
      const value = bb.readVarUint();
      fields.push({ name: fieldName, type: kind === 'ENUM' ? null : type as unknown as string, isArray, value });
    }
    defs.push({ name, kind, fields });
  }
  // Bind type: negatif → primitif (~type), non-negatif → nama definisi.
  for (const def of defs) {
    for (const f of def.fields) {
      const t = f.type as unknown as number | null;
      if (t === null) continue;
      if (t < 0) {
        const prim = TYPES[~t];
        if (!prim) throw new Error(`Invalid type ${t}`);
        f.type = prim;
      } else {
        if (t >= defs.length) throw new Error(`Invalid type ${t}`);
        f.type = defs[t]!.name;
      }
    }
  }
  return defs;
}

type Ctx = { byName: Map<string, KiwiDef>; byValue: Map<string, Map<number, KiwiField>> };

const defByValue = (ctx: Ctx, def: KiwiDef): Map<number, KiwiField> => {
  let m = ctx.byValue.get(def.name);
  if (!m) {
    m = new Map(def.fields.map((f) => [f.value, f]));
    ctx.byValue.set(def.name, m);
  }
  return m;
};

function decodeFieldValue(bb: ByteBuffer, ctx: Ctx, field: KiwiField): KiwiValue {
  const decode = (): KiwiValue => {
    const t = field.type!;
    switch (t) {
      case 'bool':
        return bb.readByte() !== 0;
      case 'byte':
        return bb.readByte();
      case 'int':
        return bb.readVarInt();
      case 'uint':
        return bb.readVarUint();
      case 'float':
        return bb.readVarFloat();
      case 'string':
        return bb.readString();
      case 'int64':
        return bb.readVarInt64();
      case 'uint64':
        return bb.readVarUint64();
      default: {
        const def = ctx.byName.get(t);
        if (!def) throw new Error(`Unknown type ${t}`);
        if (def.kind === 'ENUM') {
          const v = bb.readVarUint();
          const member = def.fields.find((f) => f.value === v);
          return member ? member.name : `ENUM_${v}`;
        }
        if (def.kind === 'STRUCT') {
          const out: KiwiMessage = { $type: def.name };
          for (const f of def.fields) out[f.name] = decodeFieldValue(bb, ctx, f);
          return out;
        }
        return decodeMessage(bb, ctx, def);
      }
    }
  };
  if (!field.isArray) return decode();
  const len = bb.readVarUint();
  const out: KiwiValue[] = [];
  for (let i = 0; i < len; i++) out.push(decode());
  return out;
}

/** Decode satu message (def kind MESSAGE): pasangan [field-id varuint][nilai] sampai field-id 0. */
export function decodeMessage(bb: ByteBuffer, ctx: Ctx, def: KiwiDef): KiwiMessage {
  const map = defByValue(ctx, def);
  const out: KiwiMessage = { $type: def.name };
  for (;;) {
    const id = bb.readVarUint();
    if (id === 0) return out;
    const field = map.get(id);
    if (!field) throw new Error(`Unknown field ${id} in ${def.name}`);
    out[field.name] = decodeFieldValue(bb, ctx, field);
  }
}

export type KiwiDecoded = { defs: KiwiDef[]; message: KiwiMessage };

/**
 * Decode payload fig-kiwi lengkap: `fig-kiwi` + u32 versi + [u32 len][schema deflate] + [u32 len][message terkompresi].
 * Kompresi data: zstd (format baru) dengan fallback deflate. `rootName` = nama message akar (default `Message`).
 */
export function decodeKiwi(bytes: Uint8Array, opts: { inflate: (b: Uint8Array) => Uint8Array; zstd: (b: Uint8Array) => Uint8Array; rootName?: string }): KiwiDecoded {
  const MAGIC = 'fig-kiwi';
  if (bytes.length < 12) throw new Error('Buffer too small');
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error('Not a fig-kiwi buffer');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  off += 4; // versi (u32 LE)
  const readChunk = (): Uint8Array => {
    if (off + 4 > bytes.length) throw new Error('Truncated chunk header');
    const len = view.getUint32(off, true);
    off += 4;
    if (off + len > bytes.length) throw new Error('Truncated chunk');
    const c = bytes.subarray(off, off + len);
    off += len;
    return c;
  };
  const schemaBytes = opts.inflate(readChunk());
  const dataChunk = readChunk();
  let dataBytes: Uint8Array;
  try {
    dataBytes = opts.zstd(dataChunk);
  } catch {
    dataBytes = opts.inflate(dataChunk);
  }
  const defs = decodeBinarySchema(schemaBytes);
  const ctx: Ctx = { byName: new Map(defs.map((d) => [d.name, d])), byValue: new Map() };
  const root = ctx.byName.get(opts.rootName ?? 'Message') ?? defs.find((d) => d.kind === 'MESSAGE' && d.fields.length > 0);
  if (!root) throw new Error('No root message in schema');
  return { defs, message: decodeMessage(new ByteBuffer(dataBytes), ctx, root) };
}
