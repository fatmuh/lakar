// Server MCP Lakar: 34 tool → HTTP lakard. Daftar lengkap dipaku di tests (daftar tool + anotasi read/write).
// import_url, undo, redo, visual_diff, fix_check.
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  COMPONENT_SIZES,
  CONTRAST_MIN,
  CONTROL_PREFIXES,
  DISPLAY_SIZES,
  FORBIDDEN_PHRASES,
  HOME_INDICATOR_INSET,
  KPI_LINE_HEIGHT_RATIO,
  KPI_SIZES,
  LARGE_TEXT,
  PARAGRAPH_MIN,
  PARAGRAPH_MIN_IN_CARD,
  SCRIM_MIN_ALPHA,
  SPACING_VALUES,
  TOUCH_MIN,
  LAKAR_VERSION, SCHEMA_VERSION, VERSION_HINT, errorMessage, findingLine, summaryText, type ApiResult, type Finding, type FindingSummary } from '@lakar/schema';
import { DaemonClient, formatError, type LakarTransport } from './client.js';
import { registerFixCheckTool } from './fix-check.js';
import { TOOL_EFFECTS, toolAnnotations, type ToolName } from './annotations.js';

export const SERVER_NAME = 'lakar';
export const SERVER_VERSION = LAKAR_VERSION;

const errorResult = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });

async function guarded(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    return errorResult(errorMessage(e));
  }
}

/** Hasil tool dari respons daemon: error AD-11 → teks error terformat; sukses → `content(data)`. */
function asResult<T>(r: ApiResult<T>, content: (data: T) => CallToolResult['content']): CallToolResult {
  if (!r.ok) return errorResult(formatError(r.error));
  return { content: content(r.data) };
}

/** Seperti `asResult` dengan satu blok teks `format(data)` (default JSON). */
function asText<T>(r: ApiResult<T>, format: (data: T) => string = JSON.stringify): CallToolResult {
  return asResult(r, (data) => [{ type: 'text', text: format(data) }]);
}

/** Batas baris temuan di output MCP. */
export const EXECUTE_FINDING_LINES = 20;
export const LAYOUT_CHECK_FINDING_LINES = 60;

/** Baris temuan (format ringkas) dengan batas `max` + baris sisa. */
export function findingLines(findings: readonly Finding[], max: number): string[] {
  const lines = findings.slice(0, max).map(findingLine);
  if (findings.length > max) lines.push(`… ${findings.length - max} temuan lagi (layout_check untuk daftar penuh)`);
  return lines;
}

type ChangeRef = { id: string; type: string; name?: string; props?: string[] };
type ExecuteChanges = { added: ChangeRef[]; updated: ChangeRef[]; deleted: ChangeRef[]; moved?: ChangeRef[]; other?: string[]; counts: { added: number; updated: number; deleted: number; moved?: number } };
type ExecuteData = {
  check?: { boards: string[]; summary: FindingSummary; findings: Finding[] };
  changes?: ExecuteChanges;
} & Record<string, unknown>;

/** Maks entri per daftar changes di output execute (sisanya satu baris "… N lagi"). */
const EXECUTE_CHANGE_LINES = 10;

const refText = (r: ChangeRef): string => `${r.type}${r.name ? ` ${r.name}` : ''} (${r.id})${r.props?.length ? `: ${r.props.join(', ')}` : ''}`;
const changeLines = (sign: string, items: readonly ChangeRef[] | undefined): string[] => {
  if (!items?.length) return [];
  const lines = items.slice(0, EXECUTE_CHANGE_LINES).map((r) => `  ${sign} ${refText(r)}`);
  if (items.length > EXECUTE_CHANGE_LINES) lines.push(`  … ${items.length - EXECUTE_CHANGE_LINES} lagi`);
  return lines;
};

/** Output execute: field lain sebagai JSON, lalu ringkasan changes (dry-run) + ringkasan check + baris temuan (maks 20). */
export function formatExecute(data: ExecuteData): string {
  const { check, changes, ...rest } = data;
  if (!check && !changes) return JSON.stringify(data);
  const lines = [JSON.stringify(rest)];
  if (changes) {
    const c = changes.counts;
    lines.push(`changes: +${c.added} ~${c.updated} -${c.deleted}${c.moved ? ` →${c.moved}` : ''}${changes.other?.length ? ` · ${changes.other.join(', ')}` : ''}`);
    lines.push(...changeLines('+', changes.added), ...changeLines('~', changes.updated), ...changeLines('-', changes.deleted), ...changeLines('→', changes.moved));
  }
  if (check) lines.push(check.boards.length ? `check board ${check.boards.join(', ')}: ${summaryText(check.summary)}` : 'check: tidak ada board tersentuh', ...findingLines(check.findings, EXECUTE_FINDING_LINES));
  return lines.join('\n');
}

/**
 * Mulai ke-N ini, baris jumlah execute membawa pengingat batas skill (pada error juga). Sejak
 * spec-skeleton-live-build landing dibangun skeleton dulu lalu satu blok per execute, jadi pengingat dua tingkat:
 * mobile/app dulu, landing mulai `EXECUTE_LANDING_REMINDER_FROM`.
 */
export const EXECUTE_REMINDER_FROM = 4;
/**
 * Mulai ke-N ini pengingat juga berlaku untuk landing: skeleton + navbar + 2 blok hero + ±6 seksi × 2–3 blok (header,
 * baris kartu) + footer + penutup ≈ 20–25 execute kecil.
 */
export const EXECUTE_LANDING_REMINDER_FROM = 26;

/** Baris jumlah execute sesi MCP ini (pengingat saja; pemanggilan tidak pernah diblokir). */
export function executeCountLine(n: number): string {
  const head = `execute ke-${n} di sesi ini`;
  if (n < EXECUTE_REMINDER_FROM) return head;
  if (n < EXECUTE_LANDING_REMINDER_FROM) {
    return `${head} · batas skill mobile (3) / app (4) termasuk perbaikan tercapai — lanjut screenshot/export; landing: lanjut satu blok per execute`;
  }
  return `${head} · melewati batas skill (mobile 3, app 4, landing blok + 1, termasuk perbaikan) — hentikan perbaikan kecil, lanjut screenshot/export`;
}

/** Tambahkan baris jumlah execute ke hasil tool: selalu pada sukses, pada error hanya bila N ≥ 3. */
export function withExecuteCount(result: CallToolResult, n: number): CallToolResult {
  if (result.isError && n < EXECUTE_REMINDER_FROM) return result;
  const content = [...(result.content ?? [])];
  const i = content.findLastIndex((c) => c.type === 'text');
  const line = executeCountLine(n);
  if (i >= 0) {
    const last = content[i] as { type: 'text'; text: string };
    content[i] = { ...last, text: `${last.text}\n${line}` };
  } else content.push({ type: 'text', text: line });
  return { ...result, content };
}

type LayoutCheckData = { docId: string; rev: number; boards: { id: string; name: string; summary: FindingSummary }[]; summary: FindingSummary; findings: Finding[] };

/** Output layout_check: satu baris ringkasan lalu baris temuan (maks 60). */
export function formatLayoutCheck(data: LayoutCheckData): string {
  const ids = data.boards.map((b) => b.id).join(', ');
  const head = `layout_check rev ${data.rev}, ${data.boards.length} board${ids ? ` (${ids})` : ''}: ${summaryText(data.summary)}`;
  return [head, ...findingLines(data.findings, LAYOUT_CHECK_FINDING_LINES)].join('\n');
}

/** Bentuk `GET /status` lakard yang dipakai formatter. */
export type StatusData = {
  version?: string;
  schemaVersion?: number;
  node?: string;
  pid?: number;
  uptimeSec?: number;
  pool?: { size: number; ready: number; busy: number; waiting: number; recreated: number; browserVersion?: string; lastError?: string } | null;
  fonts?: { families: string[]; entries?: { family: string; weights: number[]; styles: string[] }[]; missing: string[] };
  icons?: Record<string, string>;
  photos?: { provider: string; keyFile: string; imported: number };
  sessions?: { count: number; active: { id: string; activeSlug?: string; executes: number }[] };
  /** Mode `lakar --file` / `--server`: nama transport + detailnya (file: berkas/slug/rev; server: url/room/peer). */
  transport?: string;
  file?: string;
  slug?: string;
  rev?: number;
  /** Mode `lakar --server`: URL `@lakar/sync`, capability token room, status koneksi WS, jumlah peer. */
  server?: string;
  room?: string;
  connected?: boolean;
  peers?: number;
  hint?: string;
};

const uptime = (sec: number) => (sec < 60 ? `${sec}d` : sec < 3600 ? `${Math.floor(sec / 60)}m` : `${Math.floor(sec / 3600)}j ${Math.floor((sec % 3600) / 60)}m`);

/** Teks ringkas tool `status` (beberapa baris). */
export function formatStatus(st: StatusData): string {
  const match = st.version === SERVER_VERSION && st.schemaVersion === SCHEMA_VERSION;
  const head =
    `lakard ${st.version ?? '?'} (schema ${st.schemaVersion ?? '?'}, node ${st.node ?? '?'}, pid ${st.pid ?? '?'}, uptime ${uptime(st.uptimeSec ?? 0)}) · ` +
    `mcp ${SERVER_VERSION}: ${match ? 'cocok' : `TIDAK cocok (VERSION_MISMATCH; ${VERSION_HINT})`}`;
  const p = st.pool;
  const pool = p
    ? `pool: ${p.size} halaman · ${p.ready} siap · ${p.busy} sibuk · ${p.waiting} antre · dibuat ulang ${p.recreated}× · chromium ${p.browserVersion ?? '-'}` +
      (p.lastError ? `\npool error terakhir: ${p.lastError}` : '')
    : 'pool: -';
  const fonts = st.fonts ? `font: ${st.fonts.families.length} keluarga, hilang: ${st.fonts.missing.length ? st.fonts.missing.join(', ') : '-'}` : 'font: -';
  const icons = st.icons ? `ikon: ${Object.entries(st.icons).map(([lib, v]) => `${lib} ${v}`).join(', ')}` : 'ikon: -';
  const photos = st.photos ? `foto: ${st.photos.provider} (file key ${st.photos.keyFile}), terimpor ${st.photos.imported}` : 'foto: -';
  const ss = st.sessions;
  const sessions = ss
    ? `sesi: ${ss.count}${ss.active.length ? ` (${ss.active.map((a) => `${a.id} ${a.activeSlug ?? '-'}, ${a.executes} execute`).join('; ')})` : ''}`
    : 'sesi: -';
  const fileLine = st.transport === 'file' ? `lakar file: ${st.slug ?? '?'} (rev ${st.rev ?? '?'})${st.file ? ` · ${st.file}` : ''}` : undefined;
  const serverLine =
    st.transport === 'server'
      ? `lakar server: ${st.server ?? '?'} room ${st.room ?? '?'} · koneksi ${st.connected === true ? 'hidup' : 'putus/menyambung ulang'} · rev ${st.rev ?? '?'} · ${st.peers ?? 0} peer`
      : undefined;
  return [head, ...(fileLine ? [fileLine] : []), ...(serverLine ? [serverLine] : []), pool, fonts, icons, photos, sessions, ...(st.hint ? [`hint: ${st.hint}`] : [])].join('\n');
}

/** Teks ringkas tool `list_fonts`: satu baris per keluarga berisi weight/style yang valid. */
export function formatFonts(st: StatusData): string {
  const f = st.fonts;
  if (!f) return 'font: -';
  const rows = f.entries?.length ? f.entries.map((e) => `${e.family} — weight ${e.weights.join('/')} · style ${e.styles.join('/')}`) : f.families.map((n) => n);
  return [...rows, `paket hilang: ${f.missing.length ? f.missing.join(', ') : '-'}`].join('\n');
}

/** Deskripsi tool `list_fonts`. */
export const LIST_FONTS_DESCRIPTION =
  'Font terpasang di lakard: satu baris per keluarga — "<family> — weight w/w/w · style s/s". ' +
  'Hanya nama di sini yang valid untuk `family` pada node text (atau nilai token fontFamily); nama lain → FONT_MISSING saat check/screenshot. ' +
  'Baris "paket hilang" = paket font yang gagal dimuat daemon. Pakai sebelum memilih tipografi.';

/** Deskripsi tool `status`. */
export const STATUS_DESCRIPTION =
  'Status lakard: versi daemon dan mcp (cocok/tidak), pool render (halaman siap/sibuk/antre, dibuat ulang), font hilang, versi ikon, ' +
  'penyedia foto stok (unsplash/wikimedia/openverse, status file key Unsplash, jumlah foto terimpor), sesi aktif. ' +
  'Tetap bekerja walau versi tidak cocok. Daemon mati → error berisi cara menjalankan service (systemctl --user start lakard).';

/** Deskripsi tool `read_skill`. */
export const READ_SKILL_DESCRIPTION =
  'Baca panduan skill Lakar (Markdown). Baca core (alur kerja, prelude helper, token, konvensi) + delapan skill domain ' +
  '(layout, typography, color, accessibility, ui, interface, writing, review) + skill jenis layar (landing, mobile, atau webapp; ' +
  'aplikasi desktop/dashboard → webapp; berisi contoh teruji) di giliran yang sama (10 panggilan paralel); icons bila ragu nama ikon; api hanya untuk referensi lengkap; ' +
  'selection bila permintaan merujuk node yang dipilih pengguna di viewer (varian responsif, cek konsistensi); ' +
  'opsional: break-ui bila diminta uji data terburuk/edge case, variants bila diminta beberapa variasi/alternatif beda arah, ' +
  'export-code bila diminta mengimplementasikan desain sebagai kode/proyek (design → code, Next.js/React) atau mengekspor token. ' +
  'Tanpa name → daftar {skills:[{name, available}]}; dengan name → isi skill. ' +
  'Nama: core, landing, mobile, webapp, layout, typography, color, accessibility, ui, interface, writing, review, icons, api, selection, break-ui, variants, export-code. ' +
  'Nama lain atau skill yang belum tersedia → NOT_FOUND dengan daftar yang tersedia (polish sudah dipecah ke delapan skill domain).';

/** Instruksi server MCP (dikirim saat initialize): urutan kerja singkat. */
export const SERVER_INSTRUCTIONS =
  'Lakar: canvas desain lewat kode. Prompt singkat (mis. "buatkan landing page menggunakan lakar") cukup: jalankan alur lengkap ini tanpa bertanya. ' +
  'Sebelum menggambar, read_skill core + layout + typography + color + accessibility + ui + interface + writing + review ' +
  '+ landing/mobile/webapp di giliran yang sama (paralel); aplikasi desktop/dashboard → webapp. ' +
  'Lalu open_doc {} tanpa slug (dokumen yang terbuka di aplikasi Lakar; tidak ada → dokumen baru yang terbuka sendiri sebagai tab) dan get_selection: ' +
  'bangun di board terpilih, atau board kosong (ubah ukuran dan nama sesuai jenis layar), atau board baru lewat place; ' +
  'open_doc {slug} hanya bila pengguna meminta file tertentu atau file baru. ' +
  'Lalu rencana singkat, dan langsung bangun bertahap supaya pengguna melihat canvas tumbuh live: execute pertama = board + semua seksi/area rencana ' +
  "sebagai placeholder Skel (skeleton), lalu satu blok kecil per execute (navbar, teks hero, visual hero, header seksi, satu baris kartu) yang mengisi placeholder di tempat lewat Build, " +
  "untuk landing dan webapp (board landing height:'hug' mengikuti isi, jangan isi atau naikkan tingginya; [WIP] sampai execute penutup); satu board utuh untuk mobile; " +
  'helper prelude skill core sudah bawaan di setiap execute: jangan ditulis ulang, palet arketipe sekali per dokumen lewat Palette(c, font); ' +
  'baca check di respons execute; fix aman temuan check: fix_check (satu rev, saran dinilai sendiri); perbaiki sisanya dengan editId/edits atau update; ' +
  'akhiri dengan satu screenshot board + satu screenshot zoom (nodeId, scale 2) area terpadat (skill review), satu execute perbaikan, ' +
  'visual_diff untuk memastikan hanya area yang dimaksud berubah, lalu export PNG. ' +
  'Langkah sendiri yang salah (execute/paste/fix_check): undo {steps?} (redo mengulang); ditolak bila ada edit lain sesudahnya, maka perbaiki maju lewat execute. ' +
  'Opsional: read_skill break-ui bila diminta uji data terburuk/edge case; variants bila diminta beberapa variasi/alternatif; ' +
  'export-code bila diminta mengimplementasikan desain sebagai kode/proyek (design → code) atau mengekspor token.';

/** Deskripsi tool `list_boards`. */
export const LIST_BOARDS_DESCRIPTION =
  'Daftar board dokumen aktif: {docId, slug, rev, boards:[{id, name, page, screen, x, y, width, height, heightMode?, expectedSize?, wip, childCount}]}. ' +
  "heightMode 'hug' = board height:'hug': height = tinggi terukur render terakhir. " +
  "wip = nama diawali '[WIP] '. Pakai id untuk screenshot, inspect, export, layout_check.";

/** Deskripsi tool `inspect`. */
export const INSPECT_DESCRIPTION =
  'Lihat satu board/node dokumen aktif: {docId, rev, boardId, node}. node = properti tersimpan (token apa adanya, mis. {$token:...}) ' +
  '+ bounds [x,y,w,h] hasil render (dibulatkan, relatif board) + children bersarang sampai depth (default 2, 0–6; lebih dalam → childCount). ' +
  'Bila JSON > 32 KB depth diturunkan sampai muat dan truncated:true. ID tidak ada → NOT_FOUND; dokumen yang tidak bisa dirender → error yang sama dengan screenshot.';

/** Deskripsi tool `export`. */
export const EXPORT_DESCRIPTION =
  'Ekspor board/node dokumen aktif ke file PNG di disk daemon: <dataDir>/exports/<slug>/<id>-r<rev>@<scale>x.png. ' +
  'id = board atau node (default board pertama); scale 1 atau 2 (default 1; 2 = render asli 2× piksel). ' +
  'Mengembalikan {path, id, name, rev, scale, width, height, bytes} (width/height = piksel PNG). Gagal menulis → EXPORT_FAILED.';

/** Deskripsi tool `export_code` (epic kode story 5). */
export const EXPORT_CODE_DESCRIPTION =
  'Ekspor board/node dokumen aktif menjadi kode React (generator yang sama dengan dialog Export code di viewer; berkas identik). ' +
  "target 'react-tailwind' (default: <Nama>.tsx, components/*.tsx, tokens.css, theme.css Tailwind v4) atau 'react-css' (+ *.module.css), atau 'dtcg' (seluruh token dokumen → satu tokens.json W3C DTCG; tanpa id). " +
  'Token menjadi var(--nama) dan master komponen menjadi components/<Nama>.tsx dengan props bertipe; instance menjadi pemakaiannya. ' +
  'components:false = semua di-inline; tokens:false = tanpa tokens.css; typescript:false = .jsx tanpa tipe. ' +
  'Mengembalikan blok JSON {docId, slug, rev, id, name, target, files:[{path, bytes}], warnings} lalu satu blok teks per berkas.';

/** Teks `export_code`: ringkasan JSON (tanpa isi berkas) lalu satu blok per berkas `----- path -----`. */
export type ExportCodeData = { files: { path: string; contents: string; bytes: number }[] } & Record<string, unknown>;
export function formatExportCode(data: ExportCodeData): CallToolResult['content'] {
  const { files, ...rest } = data;
  const head = { ...rest, files: files.map((f) => ({ path: f.path, bytes: f.bytes })) };
  return [{ type: 'text', text: JSON.stringify(head) }, ...files.map((f) => ({ type: 'text' as const, text: `----- ${f.path} -----\n${f.contents}` }))];
}

/** Deskripsi tool `export_svg`. */
export const EXPORT_SVG_DESCRIPTION =
  'Ekspor board/node dokumen aktif menjadi dokumen SVG vektor mandiri (emitter yang sama dengan Export file di viewer). ' +
  'id = board atau node (default board pertama); yang bisa diekspor utuh: path, frame, board — alamat komposit isi instance (<instanceId>/<idNodeMaster>) dikenali. ' +
  'Fill/stroke solid, stroke inside/center/outside, radius, opacity, dan transformasi vektor dipetakan; yang tidak punya padanan SVG ' +
  '(gradien non-solid, efek bayangan/blur, teks, ikon katalog) dilaporkan di dropped sebagai "<nodeId>.<prop>" — pakai export/screenshot untuk hasil piksel penuh. ' +
  'Mengembalikan blok JSON {docId, slug, rev, id, name, type, bytes, dropped} lalu satu blok markup <svg>…</svg>.';

/** Teks `export_svg`: ringkasan JSON (tanpa markup) lalu satu blok SVG. */
export type ExportSvgResult = { svg: string } & Record<string, unknown>;
export function formatExportSvg(data: ExportSvgResult): CallToolResult['content'] {
  const { svg, ...rest } = data;
  return [{ type: 'text', text: JSON.stringify(rest) }, { type: 'text', text: svg }];
}

/** Deskripsi tool `paste` (epic paste-vektor story 3–4, AD-15). */
export const PASTE_DESCRIPTION =
  'Tempel SVG, HTML, atau clipboard tool desain ke board/frame dokumen aktif sebagai layer yang bisa diedit (importer yang sama dengan Ctrl+V di viewer; hasil identik). ' +
  'content = dokumen SVG utuh berakar <svg> (kind "svg", default); potongan HTML (kind "html"); HTML envelope clipboard Figma atau base64 buffer fig-kiwi (kind "figma" — mencakup OpenPencil dan tool kompatibel); atau JSON pohon node .pen (kind "pen"); parentId = ID board atau frame tujuan; x/y opsional (default: tengah parent; parent auto layout → ditambahkan di akhir tanpa x/y); ' +
  'name opsional (nama layer akar); description opsional (label riwayat, default "Paste SVG"/"Paste HTML"); width opsional (lebar viewport HTML, default lebar tujuan). ' +
  'HTML dirender di Chromium terisolasi (JavaScript mati, jaringan diblokir; gambar hanya data URI): flex/grid → auto layout, teks → text, <img> data → rect gambar, <svg> → path, tag semantik (nav, h1, p, button, …) → tag; ' +
  'computed style dipetakan ke properti Lakar; HTML/CSS mentah tidak disimpan. Report HTML: {kind:"html", layers, autoLayout, texts, images, vectors, dropped:[{kind: element|attribute|request|property|value|font|layout, name, count}]}. ' +
  'Satu bentuk → node path; beberapa bentuk → frame berisi path (path, rect, circle, ellipse, line, polyline, polygon; <g> diratakan, transform dipanggang ke d). ' +
  'fill/stroke solid, stroke-width, fill-rule, stroke-linecap/linejoin/miterlimit/dasharray/dashoffset, fill/stroke-opacity, paint-order, shape-rendering, opacity dipetakan ke properti path; ' +
  'yang lain (filter, mask, clip-path, gradien url(), <text>, <image>, <use>, <style>, <script>, …) dibuang dan dilaporkan. Satu paste = satu rev. ' +
  'Mengembalikan {docId, slug, rev, created, nodeId, boards, report:{kind, paths, kept:[atribut], dropped:[{kind: element|attribute|value, name, count}]}}. ' +
  'SVG rusak/tanpa bentuk, HTML tanpa isi terlihat, atau parent bukan board/frame → SCHEMA_INVALID; ID tidak ada → NOT_FOUND; belum open_doc → NO_ACTIVE_DOC; daemon tanpa Chromium (HTML) → RENDER_FAILED.';

/** Deskripsi tool `import_url` (epic adopsi open-pencil story 8). */
export const IMPORT_URL_DESCRIPTION =
  'Impor halaman web dari URL sebagai board baru berisi layer yang bisa diedit (importer HTML yang sama dengan paste kind "html"). ' +
  'Daemon mengambil halaman sekali atas permintaan ini: hanya http(s) publik (loopback/privat/link-local ditolak, redirect ≤3 divalidasi ulang, ' +
  'maks 15 detik dan 10 MB), JavaScript halaman tidak dijalankan, dan render tetap tanpa jaringan (gambar hanya data URI). ' +
  'Board dibuat di halaman pageId (default halaman pertama): width = lebar board+viewport (default 1440; preset umum 1440/768/375), ' +
  'height = tinggi konten halaman, name opsional (default <title>, lalu host), screen opsional (default dari lebar), ' +
  'x/y opsional (default kanan board terakhir + 80), description opsional (label riwayat, default "Import page <title>"). ' +
  'Mengembalikan {docId, slug, rev, created, nodeId, boardId, boards, report:{kind:"html", …} seperti paste, page:{url, finalUrl, title?}, target}. ' +
  'Satu impor = satu rev (undo membatalkannya). URL salah/skema bukan http(s)/alamat non-publik/halaman bukan HTML → SCHEMA_INVALID; ' +
  'timeout/gangguan jaringan/HTTP 5xx-429 → EXEC_ERROR retryable; dokumen belum open_doc → NO_ACTIVE_DOC; daemon tanpa Chromium → RENDER_FAILED.';

/** Deskripsi tool `layout_check` (aturan gerbang G0). */
export const LAYOUT_CHECK_DESCRIPTION =
  'Check gerbang G0 pada board dokumen aktif (tanpa boardId = semua board). Board dirender lalu diperiksa: ' +
  'LC-01a emoji di teks; LC-01b glyph Unicode sebagai ikon (★☆✓✔✗→←↑↓↗↘▶◀• di awal teks; pakai node icon); ' +
  "LC-02a node terpotong clip board/frame (pengecualian: isi frame 'Crop / …' maks 2 per board, sumbu vertikal frame 'Scroll / …', node berotasi); " +
  'LC-05 teks lebih kecil dari 12px; ' +
  "LC-20 konten tertutup zona bawah (bar 'Overlay / …' atau frame/rect absolut ber-fill yang menempel bawah atau mengambang, termasuk kapsul ber-fill di dalam pembungkus absolut transparan, ditumpuk): " +
  'konten terakhir posisi akhir scroll berakhir ≤ y zona − 8, tidak ada kartu/teks/gambar terpotong di tepi atas zona, ' +
  'tidak ada judul seksi yang isinya tertutup zona, dan tidak ada konten terlihat terpotong di celah di bawah bar mengambang atau mengintip di celah antar-bar bertumpuk; ' +
  "LC-02b teks (ink terukur) meluap dari isi induk dan menabrak tepi/saudara (< 4px); " +
  'LC-02c non-teks (frame, rect, ikon, gambar) anak flow meluap dari isi induk ke padding/tepi wadah ber-cat terdekat dengan sisa < min(8, padding/2) atau tumpah keluar; ' +
  'LC-31 kartu ber-cat berisi teks terpotong atau rata di tepi bawah seksi/board (mockup di Crop, kartu tanpa ruang bawah), dan baris terakhir daftar/tabel rata di tepi bawah kartunya tanpa ruang bawah padahal ada ruang atas; ' +
  "LC-11 saudara tumpang tindih sebagian (kecuali 'Overlay / …', 'Crop / …', gap negatif); " +
  `LC-04 kontras teks setelah komposit < ${CONTRAST_MIN.text}:1 (teks ≥ ${LARGE_TEXT.size} atau ≥ ${LARGE_TEXT.boldSize} berat ≥ ${LARGE_TEXT.boldWeight}: < ${CONTRAST_MIN.large}:1; layer 'Placeholder' selalu ${CONTRAST_MIN.placeholder}:1; di atas gradien/opacity/blend = warning, di atas foto/noise/mesh dilewati), ` +
  `batas kontrol ${CONTROL_PREFIXES.map((p) => `'${p} …'`).join('/')} (stroke/fill, atau keturunan bercat) < ${CONTRAST_MIN.nonText}:1 terhadap latar, ` +
  `ikon tanpa label teks (di komponen tanpa teks, atau deretan ikon seperti bintang rating tanpa nilai) < ${CONTRAST_MIN.nonText}:1, ` +
  `dan warning scrim: teks di atas foto/gradien multi-hue/efek blur tanpa fill solid opacity ≥ ${String(SCRIM_MIN_ALPHA).replace('.', ',')} di antaranya; ` +
  'LC-12 (warning) ukuran board (mobile 390×844, app 1440×900 atau 1440×1024, landing lebar 1440, atau expectedSize), tinggi pas board mobile panjang dan board landing tanpa [WIP] (ruang kosong di bawah isi > 8 px → update tinggi; board height hug tidak dinilai), dan tabrakan antarboard (pakai place). ' +
  'Warning polesan: LC-18 kartu bersarang, LC-23 celah teks ↔ badge/tombol/ikon < 8, LC-24 proporsi badge di baris, LC-25 radius tidak konsentris, ' +
  'LC-26 ruang di atas judul ≤ bawah, LC-27 > 6 ukuran huruf, LC-28 baris > 80 karakter, LC-29 bobot < 400 di < 18px, LC-30 tanda baca (... dan tanda hubung rentang), ' +
  "LC-34 saudara konten tumpang tindih tanpa sengaja di luar LC-11 (ikon/gambar absolut menimpa teks atau grup; lencana kecil, bentuk dekoratif, 'Overlay / …', 'Crop / …' dan 'Chart / …' dikecualikan; detail memuat irisan [x,y,w,h]), " +
  "LC-35 teks keluar > 1px dari frame induk tanpa clip (detail: sisi, px, bounds teks dan frame; saran Wrap text width:'fill' + wrap:'wrap'). " +
  `Warning tipografi/spacing (token DESIGN.md): LC-03 teks wrap 'fixed' ≥ 2 baris atau teks melewati kotaknya, LC-06 paragraf (≥ 2 baris, ≥ 6 kata) < ${PARAGRAPH_MIN.landing}px di landing/mobile, < ${PARAGRAPH_MIN.app}px di app, < ${PARAGRAPH_MIN_IN_CARD}px di kartu ber-cat, ` +
  `LC-07 gap/padding di luar ${[...SPACING_VALUES].sort((a, b) => a - b).join('/')} (padding bawah ${HOME_INDICATOR_INSET} sah) dan tinggi komponen di luar token atau ${COMPONENT_SIZES.join('/')}, ` +
  `LC-08 ukuran di luar skala tipe atau line-height tak cocok token (KPI / Nilai ${KPI_SIZES.join('/')} dengan line-height × ${KPI_LINE_HEIGHT_RATIO} atau token, 'Display / …' ${DISPLAY_SIZES.join('/')}; < 12px = LC-05), LC-09 > 2 keluarga font (mono tidak dihitung), LC-10 target sentuh < ${TOUCH_MIN}×${TOUCH_MIN} di board mobile. ` +
  `Warning konten/seksi: LC-17 struktur seksi mirip (pasangan 'Seksi / …', atau anak tumpukan utama kolom, dengan multiset tipe node + ukuran font Jaccard ≥ 0,9; variasikan komposisi), ` +
  `LC-19 frasa terlarang (kata utuh, tanpa beda huruf; kecuali di 'Input / …' dan layer 'Label'): ${[...FORBIDDEN_PHRASES.id, ...FORBIDDEN_PHRASES.en].map((p) => `"${p}"`).join(', ')}. ` +
  "Struktural: LC-16 (error bukan gerbang) path ≤ 32×32 sebagai ikon (pakai node icon; bentuk sengaja 'Shape / …', grafik 'Chart / …'); " +
  "warning LC-14 absolut di dalam flex tanpa 'Overlay / …', LC-15 > 1 pustaka ikon UI, LC-21 radius > 3 nilai / spacer kosong / padding ganda mobile / teks langsung di baris tabel / > 1 bidang efek; " +
  'info (hanya di layout_check, tidak di execute) LC-13 nama layer default, LC-22 jumlah node Crop/Overlay/Scroll/Ekstra. ' +
  "Placeholder '[Skeleton] …' (dan isinya) tidak dinilai aturan mana pun; LC-33 (warning) placeholder skeleton tersisa di board tanpa [WIP] (isi dengan Build(id,{…}) atau remove). " +
  'Warning dan info maks 3 per aturan per board. ' +
  'Selesai bila 0 error gerbang. Output: satu baris ringkasan lalu satu baris per temuan ' +
  "'<level>[·gerbang] · <aturan> · <nama node> (<id>) · <terukur> · <seharusnya>' (maks 60 baris). " +
  'Board tidak ada → NOT_FOUND; dokumen yang tidak bisa dirender → error yang sama dengan screenshot.';

/** Deskripsi tool `execute`: harus menyebut setiap fungsi API exec (dites di tests/execute-description.test.ts). */
export const EXECUTE_DESCRIPTION =
  'Jalankan snippet JavaScript sinkron (sandbox QuickJS, tanpa fs/jaringan/import/await, batas 2 detik, maks 5000 op mutasi) terhadap dokumen aktif dalam satu transaksi: ' +
  'sukses = commit (rev +1), error tak tertangkap = rollback penuh. description WAJIB: label riwayat 3–8 kata. ' +
  'Fungsi global (ID = string 8 karakter, langsung bisa dipakai): ' +
  'add(parentId|null, node) → id (null = board di halaman; anak satu per satu, tanpa children bersarang); ' +
  'update(id, patch) merge dangkal, null menghapus properti opsional; ' +
  'replace(id, node) ganti semua properti (boleh ganti tipe), ID/posisi tetap; ' +
  'move(id, parentId|null, index?) pindah ke board/frame (null = urutan board); ' +
  'duplicate(id, patch?) → id salinan subtree tepat setelah asal; ' +
  'remove(id) hapus subtree; ' +
  "arrange(ids, {mode:'align', align:'left'|'hcenter'|'right'|'top'|'vcenter'|'bottom'} | {mode:'spread', axis:'x'|'y', gap?} | {mode:'grid', cols, gap?}) → {moved} rapikan posisi node absolut/board (selaraskan tepi/tengah, jarak merata, atau grid; anak layout auto → atur lewat gap/order parent); " +
  "komponen: setComponent(id, {props, slots}?) jadikan master (null melepas), add(parent, {type:'instance', name, componentId, props?}) sisip instance, " +
  "update('<instanceId>/<idNodeMaster>', patch) override isi instance, resetOverride(alamat, props?) kembali ke master, add('<instanceId>/<idFrameSlot>', node) isi slot, " +
  'detach(instanceId) → id node biasa, get(alamat) node efektif; hapus master men-detach instancenya; ' +
  "setTokens({'colors.primary':'#0F62FE','spacing.4':16}) merge token, null menghapus (bertipe: {type, value, modes?}); " +
  "setTokenModes(['light','dark']) mode tema, board themeMode; " +
  "setFlows([{id, name, startBoardId}]|null) daftar flow prototipe (titik masuk Present), null menghapus; interaksi lewat update(id, {interactions:[{id, trigger:'tap', action:{kind:'navigate',boardId}|{kind:'back'}|{kind:'openLink',url}, transition?}]}); " +
  'getTokens() → {tokens, modes} baca token dan mode; renameToken(from, to) ganti nama token + semua ref; ' +
  'importCssVariables(css) → {tokens, modes, skipped} token bertipe dari isi file CSS variables (:root + [data-theme="dark"]); ' +
  'importDtcgTokens(json) → {tokens, modes, skipped} token bertipe dari JSON W3C DTCG (grup bersarang = nama dipisah ".", mode di $extensions.mode, alias "{a.b}"); ' +
  'get(id) → NodeView; find({type?, name?: string|RegExp, within?}) → NodeView[] urutan dokumen; children(id|null) → NodeView[] anak langsung (null = board); ' +
  'analyze({scope?, limit?, minCluster?}?) → {nodes, colors, literalColors, tokenColors, typography, spacing:{gaps,paddings}, clusters:{shape,count,ids}} audit konsistensi dokumen: frekuensi warna literal vs token, tipografi, gap/padding, struktur berulang (kandidat komponen) — jalankan sebelum melapor selesai; ' +
  'diff({scope?, limit?}?) → {added, removed, changed (per properti {from,to}), moved (parent/urutan), docChanged, summary} perubahan struktural snippet ini terhadap dokumen awal — jalankan di akhir untuk verifikasi sebelum commit; ' +
  "NodeView = properti tersimpan (token apa adanya) + parentId, path, childIds, measuredHeight (board height:'hug') (hanya-baca: jangan kirim balik ke update/add); " +
  "place(w, h|'hug', {near?, gap?}) → {x,y} posisi board baru yang tidak tumpang tindih (gap default 80); " +
  "iconSearch(query, {lib?:'lucide'|'simple-icons', limit?}) → [{lib, icon, tags?, title?, aliasOf?}] cari ikon (default 10, maks 50; sama dengan tool icon_search). " +
  "photo('<ref>') → {assetId, width, height, credit, license, creator, sourcePageUrl} foto stok untuk ref dari tool photo_search; tulis ref sebagai literal string " +
  "(daemon mengimpornya sekali sebelum snippet berjalan; ref dari variabel → NOT_FOUND), pakai di fills [{type:'image', assetId:p.assetId, fit:'cover'}]; credit untuk ringkasan akhir, bukan node UI kecuali diminta. " +
  'keep: objek JSON per sesi yang bertahan antar-execute bila sukses (mis. keep.hero = add(...); lalu get(keep.hero)). ' +
  "Helper desain bawaan (prelude skill core, sudah ada di setiap snippet; deklarasi ulang tetap sah): C/FONT (palet; dipulihkan dari keep.C/keep.FONT, dihapus saat open_doc pindah dokumen), Palette(c, font) palet utuh dari nilai bawaan + simpan di keep, R, TY, HEAD, fill, line, F, Row, T, I, Btn, Badge, " +
  "Skel(parent, nama, minHeight) placeholder '[Skeleton] nama', Build(id, patch) isi placeholder di tempat (placeholder: lepas prefiks + minHeight). " +
  'console.log(...) → data.logs. Nilai ekspresi terakhir → data.value (JSON; dipotong di 32 KB dengan valueTruncated). ' +
  "Katalog node v1 (tertutup): board (parent null) {type:'board', name, x, y, width, height (angka | 'hug' = ikut isi), screen:'landing'|'app'|'mobile', expectedSize?:{width,height}, fills?}; " +
  "frame {layout?:'none'|'row'|'column', gap? (boleh negatif), padding?: n|[v,h]|[t,r,b,l], align?:'start'|'center'|'end'|'stretch', justify?:'start'|'center'|'end'|'space-between', clip?, scrollY?}; " +
  "text {content, size, family?, weight? (100–900), style?:'normal'|'italic', lineHeight? px, letterSpacing? em, align?:'left'|'center'|'right'|'justify', wrap?:'auto'|'wrap'|'fixed', numeric?:'proportional'|'tabular', color?}; " +
  "rect {}; ellipse {startDeg?, sweepDeg? (-360..360), inner? [0,1)}; path {d, viewBox:[x,y,w,h]}; icon {lib:'lucide'|'simple-icons', icon (nama kanonik, mis. 'arrow-right'), size, color?, strokeWidth?, filled?}. " +
  "Icon: lucide = ikon UI, simple-icons = khusus logo brand; jangan pakai emoji/karakter sebagai ikon. Alias dikonversi otomatis ke nama kanonik (lucide 'home' → 'house'); " +
  "name default 'Icon / <lib> / <icon>'; version diisi otomatis (jangan dikirim). Lucide: stroke = color (default #000000), strokeWidth dalam unit grid 24 (default 2), " +
  'filled:true mengisi bentuk dengan color; simple-icons: fill = color (default warna brand), strokeWidth/filled diabaikan; kotak = size×size. ' +
  'Nama tidak dikenal → ICON_UNKNOWN dengan 3 saran nama kanonik (cari dulu dengan iconSearch atau tool icon_search). ' +
  "Semua node anak wajib name; sizing width/height: angka | 'hug' | 'fill' (+ minWidth/maxWidth/minHeight/maxHeight). " +
  "Efek (semua node anak, termasuk text dan icon): shadows[] {x,y,blur,spread?,color,type?:'drop'|'inner'}, opacity 0..1, blend, blur, backdropBlur, rotation. " +
  "Cat (frame/rect/ellipse/path; radius hanya frame/rect): fills[] ({type:'solid',color} | {type:'linear',angle,stops} | {type:'radial',center?,radius?,stops} | {type:'conic',angle?,center?,stops} | {type:'noise',opacity,size?,seed?,blend?,mono?} | {type:'mesh',columns,rows,colors (= columns×rows),points?} | {type:'image',assetId,fit}), " +
  "stroke {color, width, align:'inside'|'center'|'outside', sides?}, radius (n atau [tl,tr,br,bl]). " +
  "Warna: '#RRGGBB' atau '#RRGGBBAA'. Nilai boleh referensi token {$token:'colors.nama'} (token harus ada di dokumen). " +
  "x/y hanya untuk board, node anak dengan position:'absolute', atau anak frame layout:'none' (position:'absolute' ditambahkan otomatis). Kunci di luar skema ditolak (SCHEMA_INVALID). " +
  'Mengembalikan {docId, rev, created:[{id,name,path}], value?, valueTruncated?, logs?, check?, bounds?}: path = list nama dari board ke node (mis. [\'Home\',\'Hero / Card\',\'Judul\']), hanya untuk dibaca; alamati node lewat id. ' +
  'Snippet tanpa op yang sukses tidak menambah rev (tanpa check/bounds). ' +
  'Setelah snippet sukses, board yang tersentuh dirender dan dicek gerbang G0 sebelum commit (aturan: lihat tool layout_check): ' +
  'check {boards, summary:{error, warning, gate, info (selalu 0: temuan info hanya di layout_check)}, findings:[{level, rule, nodeId, nodeName, detail, expected}]} ditampilkan sebagai baris ringkas (maks 20), ' +
  'bounds {id:[x,y,w,h]} dibulatkan relatif board (board tersentuh, node baru, node berubah; maks 60, sisanya boundsTruncated). ' +
  'Temuan tidak membatalkan commit; perbaiki lalu execute lagi (daftar penuh: layout_check). ' +
  'Board tersentuh yang tidak bisa dirender (FONT_MISSING: keluarga tak terdaftar atau karakter di luar font; aset NOT_FOUND; ICON_UNKNOWN) → dokumen tidak di-commit, error membawa editId. ' +
  'Error menyebut baris:kolom snippet dan membawa editId: perbaiki tanpa mengirim ulang kode dengan execute({editId, edits:[{find, replace}]}) ' +
  '(find harus muncul tepat sekali; description diwarisi; edits kosong = jalankan ulang; editId hilang saat daemon restart → kirim code lengkap). ' +
  'dryRun:true = pratinjau tanpa commit: ops dijalankan pada salinan, respons berisi changes {added, updated:{id,props}, deleted, moved, other, counts} per node+board ' +
  'dan temuan check yang sama seperti commit sungguhan; rev, riwayat, undo, dan keep tidak berubah. ' +
  'other berisi perubahan non-node (tokens, comments, pages). ID pada added/created hanya berlaku untuk pratinjau ini — commit sungguhan mencetak ID baru. ' +
  'Pakai untuk memverifikasi dampak sebelum menerapkan.';

/** Deskripsi tool `icon_search` (AD-9). */
export const ICON_SEARCH_DESCRIPTION =
  'Cari ikon untuk node icon di execute. Pustaka: lucide (ikon UI) dan simple-icons (KHUSUS logo brand, mis. github, whatsapp). ' +
  'Mengembalikan {query, results:[{lib, icon, tags?, title?, aliasOf?}]} urut relevansi: nama persis > awalan nama/alias > token nama > tag persis > tag sebagian (default 10, maks 50). ' +
  "Pakai lib + icon hasilnya apa adanya: add(b, {type:'icon', lib, icon, size}). icon = nama kanonik; alias (aliasOf ada) juga diterima dan otomatis disimpan sebagai nama kanonik. " +
  'Di dalam snippet execute, fungsi yang sama tersedia sebagai iconSearch(query, {lib?, limit?}).';

/** Maks thumbnail (image content) di hasil `photo_search`. */
export const PHOTO_THUMBNAILS_MAX = 6;

/** Deskripsi tool `photo_search`. */
export const PHOTO_SEARCH_DESCRIPTION =
  'Cari foto stok nyata untuk gambar di desain (sampul, kartu, hero, avatar orang/tempat, makanan, produk; bukan ikon fitur). Photos provided by Unsplash bila key Unsplash terpasang; ' +
  'selain itu Wikimedia Commons (foto CC0/Public Domain, CC BY, CC BY-SA; tersaring dan terurut mutu), cadangan Openverse (CC0, Public Domain Mark, CC BY). ' +
  'Mengembalikan teks JSON {provider, fallbackReason?, query, tried, results:[{ref, width, height, alt, avgColor?, creator, license, sourcePageUrl, credit}], previews} ' +
  `lalu thumbnail pratinjau (maks ${PHOTO_THUMBNAILS_MAX} gambar; previews:[ref] di JSON = urutan gambar). ` +
  "Pakai di execute: const p = photo('<ref>'); lalu fills:[{type:'image', assetId:p.assetId, fit:'cover'}] pada frame/rect bernama 'Image / …'. " +
  'Ref ditulis literal di kode; foto diimpor sekali saat execute (maks 6 foto baru per execute); halaman render tidak memakai jaringan (foto Unsplash disajikan daemon dari cache). ' +
  'Pilih kandidat dengan subjek jelas dan berwarna. ' +
  'credit = baris kredit siap pakai; atribusi (pembuat, lisensi, sumber) tercatat di metadata aset, jadi kredit tidak ditampilkan di UI kecuali pengguna memintanya; sebut kredit di ringkasan akhir. ' +
  "Kata kunci: 2–3 kata benda Inggris yang visual (tempat/objek/suasana); orang = '<peran> portrait' (mis. 'chef portrait'). orientation: landscape | portrait | square. " +
  'Bila kosong, daemon menyederhanakan kata kunci sendiri (query = yang dipakai, tried = yang dicoba): jangan mengulang pencarian. ' +
  'Cari di awal (maks 2 pencarian per desain, paralel, sebelum execute pertama). Tidak ada hasil → NOT_FOUND; penyedia sibuk/gagal → EXEC_ERROR (retryable): satu percobaan saja, lalu pakai blok gambar pengganti.';

/** Deskripsi tool `import_image`. */
export const IMPORT_IMAGE_DESCRIPTION =
  'Impor gambar milik agen (hasil render/sendiri/logo klien) ke store aset daemon: {path} file lokal di mesin daemon ATAU {dataBase64} byte gambar base64 — tepat satu; ' +
  'raster PNG/JPEG/WebP/GIF ≤ 12 MB. Mengembalikan {assetId, mime, bytes, width?, height?}; pakai assetId di fills node: fills:[{type:\'image\', assetId, fit:\'cover\'}]. ' +
  'Untuk foto stok beratribusi tetap pakai photo_search + photo(\'<ref>\').';

/** Teks ringkas tool `import_image`. */
export const formatImportImage = (d: { assetId: string; mime: string; bytes: number; width?: number; height?: number }) =>
  `gambar terimpor: assetId ${d.assetId} (${d.mime}, ${d.width ?? '?'}×${d.height ?? '?'}, ${Math.round(d.bytes / 1024)} KB)\n` +
  `pakai di fills: {type:'image', assetId:'${d.assetId}', fit:'cover'|'contain'|'fill'|'tile'}`;

/** Deskripsi tool `get_selection` (AD-9). */
export const GET_SELECTION_DESCRIPTION =
  'Baca node yang sedang dipilih pengguna di canvas viewer Lakar (seleksi hidup, hanya di memori daemon; tidak ada di dokumen maupun riwayat). ' +
  'Tanpa slug → dokumen aktif sesi; belum open_doc → dokumen yang terbuka di aplikasi, lalu dokumen yang seleksinya terakhir berubah. ' +
  'Mengembalikan {slug, rev, addresses, nodes:[{address, id, type, name, boardId, bounds?}], missing?, unmeasured?, updatedAt?}: ' +
  'addresses = urutan pilihan pengguna (ID atau alamat komposit id/id); bounds [x,y,w,h] hasil render, dibulatkan, relatif board (board = [0,0,w,h]); ' +
  'missing = alamat yang tidak ada lagi di dokumen; unmeasured = board yang gagal dirender (node tetap tercantum tanpa bounds). ' +
  'addresses kosong = pengguna belum memilih apa pun. Pakai id untuk inspect, execute (get/update), atau open_doc {slug} dulu bila slug bukan dokumen aktif. ' +
  'Tanpa dokumen aktif, tanpa dokumen terbuka, dan tanpa seleksi → NO_ACTIVE_DOC. Alur varian responsif dan cek konsistensi atas seleksi: read_skill selection.';

/** Deskripsi tool `set_selection`. */
export const SET_SELECTION_DESCRIPTION =
  'Atur seleksi canvas viewer (node yang tersorot untuk pengguna; state sesi di memori — bukan dokumen, rev, maupun riwayat). ' +
  '{addresses:[id, …], slug?}: id = ID node 8 karakter; isi instance lewat alamat komposit <instanceId>/<idNodeMaster>. slug kosong = dokumen aktif sesi. ' +
  'Alamat yang tidak ada di dokumen → NOT_FOUND. Pengguna tetap bisa menimpa/mengosongkan seleksi seperti biasa. ' +
  'Pakai untuk menyorot node yang baru dibuat/diubah oleh execute agar pengguna langsung melihat hasilnya. ' +
  'Mengembalikan {slug, rev, addresses, changed}.';

/** Deskripsi tool `open_doc` (spec-agent-open-doc). */
export const OPEN_DOC_DESCRIPTION =
  'Pilih dokumen kerja sesi ini; dokumen dipaku sampai open_doc berikutnya (pengguna pindah tab di aplikasi tidak memindahkannya). ' +
  'Tanpa argumen → dokumen yang sedang terbuka di aplikasi Lakar (source "viewer"); tidak ada dokumen terbuka → dokumen baru dibuat ' +
  '(nama dari name, default "Untitled") dan aplikasi membukanya sebagai tab (source "created"). ' +
  'slug → buka atau buat file tertentu (source "slug"); pakai hanya bila pengguna meminta file tertentu atau file baru. ' +
  'Slug: huruf kecil/angka/tanda hubung, cocok ^[a-z0-9][a-z0-9-]{0,63}$. ' +
  'Mengembalikan {docId, slug, rev, created, source, target:{slug, name, boardIds}, viewerOpen, hint?}; viewerOpen false = aplikasi Lakar tidak terbuka: sampaikan hint ke pengguna.';

/** Deskripsi tool `list_documents` (spec-agent-open-doc). */
export const LIST_DOCUMENTS_DESCRIPTION =
  'Daftar dokumen Lakar (bukan arsip), terbaru dulu: {documents:[{slug, name, rev, updatedAt, open, focused, active?}], focused, active?}. ' +
  'open = tampil di jendela aplikasi; focused = dokumen yang terakhir difokuskan pengguna (dipakai open_doc tanpa slug); active = dokumen kerja sesi ini. ' +
  'Pakai slug untuk open_doc {slug} bila pengguna menyebut file tertentu.';

/** Deskripsi tool `list_pages` (story 9.2). */
export const LIST_PAGES_DESCRIPTION =
  'Daftar halaman dokumen aktif sesi: {pages:[{id, name, index, boards}], active:{id, name, index, boards}, docId, rev}. ' +
  'index = urutan halaman; boards = jumlah board di halaman itu. Halaman aktif menentukan target add(null,…), children(null), dan place() di execute.';

/** Deskripsi tool `get_current_page` (story 9.2). */
export const GET_CURRENT_PAGE_DESCRIPTION =
  'Halaman aktif sesi sekarang: {id, name, index, boards}. Default halaman pertama sampai switch_page dipanggil. ' +
  'Target execute (add(null,…), children(null), place()) mengikuti halaman ini.';

/** Deskripsi tool `switch_page` (story 9.2). */
export const SWITCH_PAGE_DESCRIPTION =
  'Pindah halaman aktif sesi ke {page} — nama ATAU id halaman dari list_pages (nama tidak unik → pakai id). ' +
  'Hanya state sesi: tanpa rev, tanpa riwayat, dan tidak memindahkan tab/halaman yang dilihat pengguna di aplikasi. ' +
  'Sesudahnya execute menulis di halaman ini (add(null,…)), dan children(null)/place() membaca halaman ini. ' +
  'Mengembalikan {page:{id, name, index, boards}, previous:{id}}.';

/** Deskripsi tool `create_page` (story 9.2). */
export const CREATE_PAGE_DESCRIPTION =
  'Buat halaman baru di akhir dokumen aktif sesi dan jadikan halaman aktif sesi. ' +
  'name opsional (1–100 karakter; default "Page N"). Tercatat di riwayat atas nama sesi ini; bisa dikembalikan lewat Restore di aplikasi. ' +
  'Mengembalikan {slug, rev, page:{id, name, index, boards}}.';

/** Deskripsi tool `get_page_tree` (story 9.2). */
export const PAGE_TREE_DESCRIPTION =
  'Outline ringkas pohon node sebuah halaman (default halaman aktif sesi; page = nama/id): per node {id, type, name, x?, y?, width?, height?, content?} ' +
  `lalu children sampai depth (0–6, default 2); lebih dalam → childCount + truncated:true. Lebih hemat token daripada inspect per board — ` +
  'pakai untuk melihat struktur halaman, lalu inspect/screenshot board tertentu untuk detail.';

/** Deskripsi tool `list_comments` (story 9.3). */
export const LIST_COMMENTS_DESCRIPTION =
  'Daftar thread komentar di dokumen aktif sesi: {total, open, threads:[{id, pageId, nodeId?, x, y, status, resolvedAt?, fixRequest?, messages:[{author:{kind,name}, text, at}]}]}. ' +
  'Filter opsional: status open/resolved/all, pageId, kind (penulis pembuka thread: user/agent). Pin nodeId = di layer; tanpa nodeId = titik bebas di x,y (koordinat halaman). ' +
  'fixRequest = mailbox fix (spec-comment-to-fix): {status open/done/failed/cancelled, agent?, at} — pengguna memintanya dari aplikasi (Ask agent to fix); ' +
  'thread ber-fixRequest open adalah antrean kerja untuk agen: kerjakan, kabari lewat reply_to_comment, lalu tutup dengan fix_comment.';

/** Deskripsi tool `add_comment` (story 9.3). */
export const ADD_COMMENT_DESCRIPTION =
  'Buat thread komentar baru di dokumen aktif — untuk catatan review, pertanyaan ke pengguna, atau penanda hasil execute. ' +
  'Pin di layer: {text, nodeId} (x,y opsional; default posisi node). Titik bebas: {text, x, y, pageId?} (default halaman aktif sesi). ' +
  'Menambah rev (riwayat + snapshot); penulis tercatat sebagai agen sesi ini.';

/** Deskripsi tool `reply_to_comment` (story 9.3). */
export const REPLY_COMMENT_DESCRIPTION = 'Balas thread komentar: {threadId, text}. Pesan ditambah ke thread; menambah rev.';

/** Deskripsi tool `resolve_comment` (story 9.3). */
export const RESOLVE_COMMENT_DESCRIPTION =
  'Tandai thread komentar resolved atau buka kembali: {threadId, resolved?} (default true; false = buka kembali). ' +
  'Resolve menetapkan resolvedAt. Idempoten — status sudah sama → tanpa rev baru.';

/** Deskripsi tool `delete_comment` (story 9.4 lanjutan). */
export const DELETE_COMMENT_DESCRIPTION =
  'Hapus thread komentar permanen dari dokumen aktif: {threadId}. Berbeda dengan resolve — dokumen kehilangan threadnya ' +
  '(pulihkan lewat History/restore di aplikasi). Menambah rev; threadId dari list_comments.';

/** Deskripsi tool `fix_comment` (spec-comment-to-fix): menutup mailbox permintaan fix dari aplikasi. */
export const FIX_COMMENT_DESCRIPTION =
  'Tutup permintaan fix (mailbox komentar) pada thread: {threadId, outcome:"done"|"failed", note?, slug?} — hanya thread ber-fixRequest open ' +
  '(dibuat pengguna lewat "Ask agent to fix"; lihat list_comments). `note` tersimpan di fixRequest dan di-append sebagai pesan hasil berauthor agen ' +
  '(default "Fix done."/"Fix failed."); fixRequest.agent diisi harness sesi ini (chip "fixed by" di aplikasi). ' +
  'slug opsional — default dokumen aktif sesi; dengan slug, permintaan bisa ditutup tanpa open_doc dulu. Menambah rev.';

/** Deskripsi tool `visual_diff` (spec-agent-visual-diff). */
export const VISUAL_DIFF_DESCRIPTION =
  'Bandingkan render board/node dokumen aktif di dua rev (snapshot History) untuk memastikan edit hanya mengubah area yang dimaksud. ' +
  "Tanpa fromRev → rev sebelum tulis terakhir sesi ini (execute/paste) di dokumen ini (base lastWrite); since 'session' → sebelum tulis pertama sesi (sessionStart); " +
  'sesi belum menulis → rev sebelumnya (previousRev). toRev default rev kini. Kirim boardId ATAU nodeId (default board pertama); nodeId → hanya bounds node (gabungan kedua rev). ' +
  'Mengembalikan gambar overlay (piksel berubah merah di atas "sesudah" yang dipudarkan, wilayah berbingkai biru) lalu JSON ' +
  '{boardId, nodeId?, fromRev, toRev, base, area:[x,y,w,h], size:{from,to}, sizeDelta?, missing?, changedPixels, changedRatio, regions:[{bounds:[x,y,w,h], pixels, nodes:[{id, name, state?}]}], regionsTruncated?}. ' +
  'Koordinat board; ukuran beda (board hug) disejajarkan kiri-atas dan selisihnya dihitung berubah; antialiasing diabaikan; board > 4 MP dibandingkan pada skala turun (scale), overlay maks 4096 px per sisi (overlayScale). ' +
  'regions[].nodes = node paling spesifik yang bersinggungan (state added/removed): node di luar rencana edit berarti ikut berubah. ' +
  "Rev tanpa snapshot atau board/node tidak ada di kedua rev → NOT_FOUND; board/node hanya ada di satu rev → missing 'from'|'to'.";

/** Kebijakan tool: 'all' (default) atau 'readonly' — hanya tool ber-efek `read` (TOOL_EFFECTS) yang terdaftar. */
export type ToolPolicy = 'all' | 'readonly';

export type LakarMcpOptions = {
  /**
   * 'readonly' menyembunyikan semua tool tulis/destruktif dari tools/list dan tools/call — untuk harness
   * review/bench yang tidak boleh mengubah dokumen. Diatur lewat env `LAKAR_MCP_TOOLS` di main.ts.
   */
  tools?: ToolPolicy;
};

/**
 * Rakit server MCP lakar. `backend` = URL lakard (`DaemonClient`, default) atau `LakarTransport` jadi
 * (mis. `FileClient` dari `lakar --file`). Daftar tool dan routing route tidak berubah.
 */
export function createLakarMcpServer(backend: string | LakarTransport, opts: LakarMcpOptions = {}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: SERVER_INSTRUCTIONS,
      // capabilities.experimental: namespace vendor untuk discovery — harness bisa membaca schemaVersion dokumen
      // dan mode tool ('all'|'readonly') dari hasil initialize tanpa menebak dari serverInfo.
      capabilities: { experimental: { lakar: { schemaVersion: SCHEMA_VERSION, tools: opts.tools ?? 'all' } } },
    },
  );
  if (opts.tools === 'readonly') {
    // Saring di satu titik: tool tanpa entri 'read' di TOOL_EFFECTS (termasuk tool baru yang belum dipetakan)
    // tidak terdaftar → panggilan mendapat error MCP standar "tool not found".
    const reg = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
    server.registerTool = ((name: string, ...rest: unknown[]) => (TOOL_EFFECTS[name as ToolName] === 'read' ? reg(name, ...rest) : undefined)) as McpServer['registerTool'];
  }
  // clientInfo harness (Claude Code, Codex, …) baru ada sesudah initialize; sesi daemon dibuat malas pada tool pertama.
  const client: LakarTransport = typeof backend === 'string' ? new DaemonClient(backend) : backend;
  client.setAgent(() => server.server.getClientVersion());
  let executes = 0;

  server.registerTool(
    'status',
    { annotations: toolAnnotations('status'), description: STATUS_DESCRIPTION, inputSchema: z.object({}).strict() },
    () => guarded(async () => asText(await client.status<StatusData>(), formatStatus)),
  );

  server.registerTool(
    'list_fonts',
    { annotations: toolAnnotations('list_fonts'), description: LIST_FONTS_DESCRIPTION, inputSchema: z.object({}).strict() },
    () => guarded(async () => asText(await client.status<StatusData>(), formatFonts)),
  );

  server.registerTool(
    'read_skill',
    {
      annotations: toolAnnotations('read_skill'),
      description: READ_SKILL_DESCRIPTION,
      inputSchema: z.object({ name: z.string().optional().describe('core | landing | mobile | webapp | layout | typography | color | accessibility | ui | interface | writing | review | icons | api | selection | break-ui | variants | export-code; kosongkan untuk daftar') }).strict(),
    },
    ({ name }) =>
      guarded(async () => {
        const r = await client.call<{ name: string; content: string } | { skills: { name: string; available: boolean }[] }>('/skills/read', name !== undefined ? { name } : {});
        return asText(r, (data) => ('content' in data ? data.content : JSON.stringify(data)));
      }),
  );

  server.registerTool(
    'list_boards',
    { annotations: toolAnnotations('list_boards'), description: LIST_BOARDS_DESCRIPTION, inputSchema: z.object({}).strict() },
    () => guarded(async () => asText(await client.call('/boards', {}))),
  );

  server.registerTool(
    'inspect',
    {
      annotations: toolAnnotations('inspect'),
      description: INSPECT_DESCRIPTION,
      inputSchema: z.object({
        id: z.string().describe('ID board atau node'),
        depth: z.number().int().optional().describe('kedalaman children 0–6 (default 2)'),
      }).strict(),
    },
    ({ id, depth }) => guarded(async () => asText(await client.call('/inspect', depth !== undefined ? { id, depth } : { id }))),
  );

  server.registerTool(
    'export',
    {
      annotations: toolAnnotations('export'),
      description: EXPORT_DESCRIPTION,
      inputSchema: z.object({
        id: z.string().optional().describe('ID board/node; kosongkan untuk board pertama'),
        scale: z.number().int().optional().describe('1 atau 2 (default 1)'),
      }).strict(),
    },
    ({ id, scale }) =>
      guarded(async () => {
        const body: Record<string, unknown> = {};
        if (id !== undefined) body.id = id;
        if (scale !== undefined) body.scale = scale;
        return asText(await client.call('/export', body));
      }),
  );

  server.registerTool(
    'export_code',
    {
      annotations: toolAnnotations('export_code'),
      description: EXPORT_CODE_DESCRIPTION,
      inputSchema: z.object({
        id: z.string().optional().describe('ID board/node; kosongkan untuk board pertama (diabaikan untuk target dtcg)'),
        target: z.enum(['react-tailwind', 'react-css', 'dtcg']).optional().describe("'react-tailwind' (default), 'react-css', atau 'dtcg' (token dokumen → tokens.json W3C DTCG)"),
        components: z.boolean().optional().describe('master sebagai berkas komponen terpisah (default true)'),
        tokens: z.boolean().optional().describe('sertakan tokens.css (default true)'),
        typescript: z.boolean().optional().describe('TSX bertipe (default true); false = JSX'),
      }).strict(),
    },
    (args) =>
      guarded(async () => {
        const body = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
        return asResult(await client.call<ExportCodeData>('/viewer/export-code', body), formatExportCode);
      }),
  );

  server.registerTool(
    'export_svg',
    {
      annotations: toolAnnotations('export_svg'),
      description: EXPORT_SVG_DESCRIPTION,
      inputSchema: z.object({
        id: z.string().optional().describe('ID board/node vektor; kosongkan untuk board pertama; isi instance lewat <instanceId>/<idNodeMaster>'),
      }).strict(),
    },
    (args) =>
      guarded(async () => {
        const body = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
        return asResult(await client.call<ExportSvgResult>('/viewer/export-svg', body), formatExportSvg);
      }),
  );

  server.registerTool(
    'paste',
    {
      annotations: toolAnnotations('paste'),
      description: PASTE_DESCRIPTION,
      inputSchema: z.object({
        content: z.string().describe('dokumen SVG utuh (<svg …>…</svg>) atau potongan HTML (kind html)'),
        parentId: z.string().describe('ID board atau frame tujuan'),
        x: z.number().optional().describe('posisi x di parent (default tengah)'),
        y: z.number().optional().describe('posisi y di parent (default tengah)'),
        name: z.string().optional().describe('nama layer akar (default <title> SVG atau "SVG"; HTML: aria-label/id/kelas/tag akar)'),
        description: z.string().optional().describe('label riwayat (default "Paste SVG"/"Paste HTML")'),
        kind: z.enum(['svg', 'html', 'figma', 'pen']).optional().describe("jenis isi: 'svg' (default), 'html', 'figma' (clipboard Figma/OpenPencil), atau 'pen' (JSON .pen)"),
        width: z.number().optional().describe('HTML: lebar viewport px (default lebar board/frame tujuan)'),
      }).strict(),
    },
    (args) =>
      guarded(async () => {
        const body = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
        return asText(await client.call('/viewer/paste', body));
      }),
  );

  server.registerTool(
    'import_url',
    {
      annotations: toolAnnotations('import_url'),
      description: IMPORT_URL_DESCRIPTION,
      inputSchema: z.object({
        url: z.string().describe('URL halaman web publik (http/https)'),
        pageId: z.string().optional().describe('ID halaman tujuan board baru (default halaman pertama)'),
        width: z.number().optional().describe('lebar board+viewport px (default 1440; preset umum 1440/768/375)'),
        name: z.string().optional().describe('nama board (default <title> halaman, lalu host)'),
        screen: z.enum(['landing', 'app', 'mobile']).optional().describe('jenis layar board (default dari lebar)'),
        x: z.number().optional().describe('posisi x board di halaman (default kanan board terakhir + 80)'),
        y: z.number().optional().describe('posisi y board (default mengikuti board terakhir)'),
        description: z.string().optional().describe('label riwayat (default "Import page <title>")'),
      }).strict(),
    },
    (args) =>
      guarded(async () => {
        const body = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
        return asText(await client.call('/viewer/import-url', body));
      }),
  );

  server.registerTool(
    'open_doc',
    {
      annotations: toolAnnotations('open_doc'),
      description: OPEN_DOC_DESCRIPTION,
      inputSchema: z.object({
        slug: z.string().optional().describe('slug file tertentu, mis. "landing-kopi"; kosongkan untuk dokumen yang terbuka di aplikasi Lakar'),
        name: z.string().optional().describe('nama dokumen baru bila tidak ada dokumen terbuka (default "Untitled"); diabaikan bila ada'),
      }).strict(),
    },
    ({ slug, name }) =>
      guarded(async () => {
        const body: Record<string, unknown> = {};
        if (slug !== undefined) body.slug = slug;
        if (name !== undefined) body.name = name;
        return asText(await client.call('/docs/open', body));
      }),
  );

  server.registerTool(
    'list_documents',
    { annotations: toolAnnotations('list_documents'), description: LIST_DOCUMENTS_DESCRIPTION, inputSchema: z.object({}).strict() },
    () => guarded(async () => asText(await client.call('/viewer/documents', {}))),
  );

  // Halaman (story 9.2): halaman aktif sesi + outline. Route agen `/pages*`, bukan `/viewer/*`.
  server.registerTool(
    'list_pages',
    { annotations: toolAnnotations('list_pages'), description: LIST_PAGES_DESCRIPTION, inputSchema: z.object({}).strict() },
    () => guarded(async () => asText(await client.call('/pages', {}))),
  );

  server.registerTool(
    'get_current_page',
    { annotations: toolAnnotations('get_current_page'), description: GET_CURRENT_PAGE_DESCRIPTION, inputSchema: z.object({}).strict() },
    () =>
      guarded(async () => {
        const r = await client.call<{ active: Record<string, unknown> }>('/pages', {});
        return asText(r, (data) => JSON.stringify(data.active));
      }),
  );

  server.registerTool(
    'switch_page',
    {
      annotations: toolAnnotations('switch_page'),
      description: SWITCH_PAGE_DESCRIPTION,
      inputSchema: z.object({ page: z.string().describe('nama atau id halaman dari list_pages') }).strict(),
    },
    ({ page }) => guarded(async () => asText(await client.call('/pages/switch', { page }))),
  );

  server.registerTool(
    'create_page',
    {
      annotations: toolAnnotations('create_page'),
      description: CREATE_PAGE_DESCRIPTION,
      inputSchema: z.object({ name: z.string().optional().describe('nama halaman (1–100 karakter; default "Page N")') }).strict(),
    },
    ({ name }) => guarded(async () => asText(await client.call('/pages/create', name !== undefined ? { name } : {}))),
  );

  server.registerTool(
    'get_page_tree',
    {
      annotations: toolAnnotations('get_page_tree'),
      description: PAGE_TREE_DESCRIPTION,
      inputSchema: z.object({
        page: z.string().optional().describe('nama atau id halaman; kosongkan untuk halaman aktif sesi'),
        depth: z.number().int().min(0).max(6).optional().describe('kedalaman anak 0–6 (default 2)'),
      }).strict(),
    },
    ({ page, depth }) =>
      guarded(async () => {
        const body = Object.fromEntries(Object.entries({ page, depth }).filter(([, v]) => v !== undefined));
        return asText(await client.call('/pages/tree', body));
      }),
  );

  // Komentar canvas (story 9.3): thread komentar di dokumen aktif. Route agen `/comments*`.
  server.registerTool(
    'list_comments',
    {
      annotations: toolAnnotations('list_comments'),
      description: LIST_COMMENTS_DESCRIPTION,
      inputSchema: z.object({
        status: z.enum(['open', 'resolved', 'all']).optional().describe('filter status thread (default semua)'),
        pageId: z.string().optional().describe('filter halaman (id dari list_pages)'),
        kind: z.enum(['user', 'agent']).optional().describe('filter penulis pembuka thread'),
      }).strict(),
    },
    (args) =>
      guarded(async () => {
        const body = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
        return asText(await client.call('/comments', body));
      }),
  );

  server.registerTool(
    'add_comment',
    {
      annotations: toolAnnotations('add_comment'),
      description: ADD_COMMENT_DESCRIPTION,
      inputSchema: z.object({
        text: z.string().min(1).max(4000).describe('isi komentar (1–4000 karakter)'),
        nodeId: z.string().optional().describe('pin di layer ini (id dari inspect/get_page_tree); pin mengikuti layer di viewer'),
        x: z.number().optional().describe('posisi X pin (koordinat halaman); wajib dengan y bila tanpa nodeId'),
        y: z.number().optional().describe('posisi Y pin (koordinat halaman); wajib dengan x bila tanpa nodeId'),
        pageId: z.string().optional().describe('halaman tujuan titik bebas (id dari list_pages; default halaman aktif sesi)'),
      }).strict(),
    },
    (args) =>
      guarded(async () => {
        const body = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
        return asText(await client.call('/comments/create', body));
      }),
  );

  server.registerTool(
    'reply_to_comment',
    {
      annotations: toolAnnotations('reply_to_comment'),
      description: REPLY_COMMENT_DESCRIPTION,
      inputSchema: z.object({
        threadId: z.string().describe('id thread dari list_comments'),
        text: z.string().min(1).max(4000).describe('isi balasan (1–4000 karakter)'),
      }).strict(),
    },
    ({ threadId, text }) => guarded(async () => asText(await client.call('/comments/reply', { threadId, text }))),
  );

  server.registerTool(
    'resolve_comment',
    {
      annotations: toolAnnotations('resolve_comment'),
      description: RESOLVE_COMMENT_DESCRIPTION,
      inputSchema: z.object({
        threadId: z.string().describe('id thread dari list_comments'),
        resolved: z.boolean().optional().describe('true = tandai selesai (default), false = buka kembali'),
      }).strict(),
    },
    ({ threadId, resolved }) => guarded(async () => asText(await client.call('/comments/resolve', resolved !== undefined ? { threadId, resolved } : { threadId }))),
  );

  server.registerTool(
    'delete_comment',
    {
      annotations: toolAnnotations('delete_comment'),
      description: DELETE_COMMENT_DESCRIPTION,
      inputSchema: z.object({
        threadId: z.string().describe('id thread dari list_comments'),
      }).strict(),
    },
    ({ threadId }) => guarded(async () => asText(await client.call('/comments/delete', { threadId }))),
  );

  // Mailbox fix (spec-comment-to-fix): agen menutup permintaan fix yang dibuat pengguna dari aplikasi.
  server.registerTool(
    'fix_comment',
    {
      annotations: toolAnnotations('fix_comment'),
      description: FIX_COMMENT_DESCRIPTION,
      inputSchema: z.object({
        threadId: z.string().describe('id thread dari list_comments (harus ber-fixRequest open)'),
        outcome: z.enum(['done', 'failed']).describe('hasil fix: done = perbaikan diterapkan, failed = tidak bisa digarap'),
        note: z.string().min(1).max(4000).optional().describe('catatan hasil (jadi pesan di thread; default "Fix done."/"Fix failed.")'),
        slug: z.string().optional().describe('slug dokumen (default dokumen aktif sesi; dengan slug tak perlu open_doc)'),
      }).strict(),
    },
    (args) =>
      guarded(async () => {
        const body = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
        return asText(await client.call('/comments/fix', body));
      }),
  );

  // Audit desain (story 9.6): baca-saja, dihitung pada dokumen tersimpan sesi. Route agen `/analyze/*`.
  server.registerTool(
    'analyze_colors',
    {
      annotations: toolAnnotations('analyze_colors'),
      description:
        'Frekuensi warna di dokumen/board aktif: {colors:[{value, count, bound, token?, candidates?, uses:[{nodeId, prop}], totalUses}]} terurut pakai terbanyak. ' +
        'value hex = literal tak terikat (candidates = ≤3 token color terdekat per jarak RGB); value "{$token:nama}" = terikat. ' +
        'Pakai untuk mengikat literal ke token: setTokens + update nodeId di uses.',
      inputSchema: z.object({
        boardId: z.string().optional().describe('batasi satu board (id dari list_boards; default seluruh dokumen)'),
      }).strict(),
    },
    (args) => guarded(async () => asText(await client.call('/analyze/colors', args.boardId !== undefined ? { boardId: args.boardId } : {}))),
  );

  server.registerTool(
    'analyze_typography',
    {
      annotations: toolAnnotations('analyze_typography'),
      description:
        'Frekuensi gaya teks (node text) di dokumen/board aktif: {styles:[{family?, size?, weight?, style?, lineHeight?, count, nodeIds[], offScale?, suggestedSize?}]} ' +
        'terurut pakai terbanyak. offScale = size literal di luar skala DESIGN.md (suggestedSize = skala terdekat); prop token-bound tampil sebagai "{$token:nama}".',
      inputSchema: z.object({
        boardId: z.string().optional().describe('batasi satu board (id dari list_boards; default seluruh dokumen)'),
      }).strict(),
    },
    (args) => guarded(async () => asText(await client.call('/analyze/typography', args.boardId !== undefined ? { boardId: args.boardId } : {}))),
  );

  server.registerTool(
    'analyze_clusters',
    {
      annotations: toolAnnotations('analyze_clusters'),
      description:
        'Struktur kontainer berulang (kandidat komponen) di dokumen/board aktif: {clusters:[{shape, count, example, nodeIds[], totalNodes}]} ' +
        'untuk grup signature identik (tipe + nama-prop + struktur anak; konten diabaikan) yang muncul ≥ min (default 3). ' +
        'Pakai nodeIds dengan setComponent + instance untuk mengganti pengulangan menjadi komponen.',
      inputSchema: z.object({
        boardId: z.string().optional().describe('batasi satu board (id dari list_boards; default seluruh dokumen)'),
        min: z.number().int().min(2).max(50).optional().describe('batas minimal pengulangan 2–50 (default 3)'),
      }).strict(),
    },
    (args) =>
      guarded(async () => {
        const body = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
        return asText(await client.call('/analyze/clusters', body));
      }),
  );

  // undo/redo agen (spec-agent-undo): hanya langkah execute/paste sesi ini; edit pengguna/agen lain sesudahnya → ditolak.
  for (const dir of ['undo', 'redo'] as const) {
    server.registerTool(
      dir,
      {
        annotations: toolAnnotations(dir),
        description:
          dir === 'undo'
            ? 'Batalkan langkah terakhir SESI INI di dokumen aktif (satu langkah = satu execute/paste yang meng-commit; default 1, steps maks 50). ' +
              'Setiap undo menjadi rev baru di riwayat ("Undo: <description>") dan tampil live di aplikasi. Tidak pernah membatalkan edit pengguna atau agen lain: ' +
              'ada rev lain sesudah langkah sesi ini → CONFLICT (inspect lalu perbaiki maju lewat execute). Tidak ada langkah (sesi baru, daemon restart, dokumen lain) → NOT_FOUND. ' +
              'Mengembalikan {docId, slug, rev, undone:[{description, rev}], boards, available:{undo, redo}, target}.'
            : 'Ulangi langkah yang baru di-undo sesi ini (default 1). Hanya bila tidak ada rev lain sesudah undo; execute/paste baru mengosongkan redo. ' +
              'Penolakan sama dengan undo (CONFLICT/NOT_FOUND). Mengembalikan {docId, slug, rev, redone:[{description, rev}], boards, available:{undo, redo}, target}.',
        inputSchema: z.object({ steps: z.number().int().optional().describe('jumlah langkah 1–50 (default 1)') }).strict(),
      },
      ({ steps }) => guarded(async () => asText(await client.call(`/viewer/${dir}`, steps !== undefined ? { steps } : {}))),
    );
  }

  server.registerTool(
    'execute',
    {
      annotations: toolAnnotations('execute'),
      description: EXECUTE_DESCRIPTION,
      inputSchema: z.object({
        code: z.string().optional().describe('snippet JavaScript (kosongkan bila memperbaiki lewat editId)'),
        description: z.string().optional().describe('WAJIB untuk snippet baru: label riwayat 3–8 kata, mis. "tambah hero landing kopi"; diwarisi saat perbaikan editId'),
        editId: z.string().optional().describe('editId dari error execute sebelumnya (sesi yang sama); jangan dikirim bersama code'),
        edits: z
          .array(z.object({ find: z.string().describe('potongan teks persis yang muncul tepat sekali'), replace: z.string() }))
          .optional()
          .describe('edit find/replace berurutan terhadap snippet editId; kosong = jalankan ulang'),
        dryRun: z.boolean().optional().describe('true = pratinjau: jalankan ops pada salinan, kembalikan changes (added/updated/deleted/moved per node+board, other untuk tokens/halaman) + temuan check tanpa commit/rev/riwayat; ID added/created sekali-pakai'),
      }).strict(),
    },
    async ({ code, description, editId, edits, dryRun }) => {
      // Dihitung per instance server (= satu sesi agen), sukses maupun error.
      const n = ++executes;
      return withExecuteCount(
        await guarded(async () => {
          const body: Record<string, unknown> = {};
          if (code !== undefined) body.code = code;
          if (description !== undefined) body.description = description;
          if (editId !== undefined) body.editId = editId;
          if (edits !== undefined) body.edits = edits;
          if (dryRun !== undefined) body.dryRun = dryRun;
          return asText(await client.call<ExecuteData>('/execute', body), formatExecute);
        }),
        n,
      );
    },
  );

  server.registerTool(
    'screenshot',
    {
      annotations: toolAnnotations('screenshot'),
      description:
        'Render board dokumen aktif ke PNG (default skala 1). Tanpa argumen → board pertama di halaman pertama. ' +
        'nodeId → potret satu node saja (ukuran bounds node). Kirim boardId ATAU nodeId, bukan keduanya (SCHEMA_INVALID). ' +
        'scale 2 → PNG 2× piksel untuk zoom review area terpadat (skill review); scale lain → SCHEMA_INVALID.',
      inputSchema: z.object({
        boardId: z.string().optional().describe('ID board dari created[] execute atau list_boards'),
        nodeId: z.string().optional().describe('ID node yang dipotret sendiri (bukan bersama boardId)'),
        scale: z.number().int().optional().describe('1 (default) atau 2 (zoom review: 2× piksel)'),
      }).strict(),
    },
    ({ boardId, nodeId, scale }) =>
      guarded(async () => {
        const body: Record<string, unknown> = {};
        if (boardId !== undefined) body.boardId = boardId;
        if (nodeId !== undefined) body.nodeId = nodeId;
        if (scale !== undefined) body.scale = scale;
        const r = await client.call<{ boardId: string; nodeId?: string; width: number; height: number; mimeType: string; png: string }>('/screenshot', body);
        return asResult(r, ({ png, ...meta }) => [
          { type: 'image', data: png, mimeType: 'image/png' },
          { type: 'text', text: JSON.stringify(meta) },
        ]);
      }),
  );

  server.registerTool(
    'icon_search',
    {
      annotations: toolAnnotations('icon_search'),
      description: ICON_SEARCH_DESCRIPTION,
      inputSchema: z.object({
        query: z.string().describe('kata kunci, mis. "dumbbell", "arrow right", "github"'),
        lib: z.enum(['lucide', 'simple-icons']).optional().describe('batasi pustaka: lucide (ikon UI) atau simple-icons (logo brand)'),
        limit: z.number().int().optional().describe('jumlah hasil 1–50 (default 10)'),
      }).strict(),
    },
    ({ query, lib, limit }) =>
      guarded(async () => {
        const body: Record<string, unknown> = { query };
        if (lib !== undefined) body.lib = lib;
        if (limit !== undefined) body.limit = limit;
        return asText(await client.call('/icons/search', body));
      }),
  );

  server.registerTool(
    'photo_search',
    {
      annotations: toolAnnotations('photo_search'),
      description: PHOTO_SEARCH_DESCRIPTION,
      inputSchema: z.object({
        query: z.string().describe('kata kunci foto, mis. "kamar hotel" atau "hotel room"'),
        orientation: z.enum(['landscape', 'portrait', 'square']).optional().describe('orientasi foto'),
        limit: z.number().int().optional().describe('jumlah hasil 1–12 (default 6)'),
      }).strict(),
    },
    ({ query, orientation, limit }) =>
      guarded(async () => {
        const body: Record<string, unknown> = { query };
        if (orientation !== undefined) body.orientation = orientation;
        if (limit !== undefined) body.limit = limit;
        type Thumb = { ref: string; mimeType: string; data: string };
        const r = await client.call<{ thumbnails?: Thumb[] } & Record<string, unknown>>('/photos/search', body);
        return asResult(r, ({ thumbnails = [], ...rest }) => {
          const shown = thumbnails.slice(0, PHOTO_THUMBNAILS_MAX);
          return [
            { type: 'text', text: JSON.stringify({ ...rest, previews: shown.map((t) => t.ref) }) },
            ...shown.map((t) => ({ type: 'image' as const, data: t.data, mimeType: t.mimeType })),
          ];
        });
      }),
  );

  server.registerTool(
    'import_image',
    {
      annotations: toolAnnotations('import_image'),
      description: IMPORT_IMAGE_DESCRIPTION,
      inputSchema: z.object({
        path: z.string().optional().describe('path file gambar lokal di mesin daemon (PNG/JPEG/WebP/GIF, ≤12 MB)'),
        dataBase64: z.string().optional().describe('byte gambar sebagai base64 (alternatif path; kirim tepat satu)'),
      }).strict(),
    },
    (args) =>
      guarded(async () => {
        const body = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
        const r = await client.call<{ assetId: string; mime: string; bytes: number; width?: number; height?: number }>('/photos/import', body);
        return asText(r, formatImportImage);
      }),
  );

  server.registerTool(
    'get_selection',
    {
      annotations: toolAnnotations('get_selection'),
      description: GET_SELECTION_DESCRIPTION,
      inputSchema: z.object({ slug: z.string().optional().describe('slug dokumen; kosongkan untuk dokumen aktif sesi (atau dokumen dengan seleksi terakhir)') }).strict(),
    },
    ({ slug }) => guarded(async () => asText(await client.call('/viewer/selection', slug !== undefined ? { slug } : {}))),
  );

  server.registerTool(
    'set_selection',
    {
      annotations: toolAnnotations('set_selection'),
      description: SET_SELECTION_DESCRIPTION,
      inputSchema: z.object({
        addresses: z.array(z.string()).describe('alamat node (ID 8 karakter atau komposit id/id; 0–500; [] = kosongkan seleksi)'),
        slug: z.string().optional().describe('slug dokumen (kosongkan = dokumen aktif sesi)'),
      }).strict(),
    },
    (args) =>
      guarded(async () => {
        const body: Record<string, unknown> = { addresses: args.addresses };
        if (args.slug !== undefined) body.slug = args.slug;
        return asText(await client.call('/viewer/selection/set', body));
      }),
  );

  server.registerTool(
    'visual_diff',
    {
      annotations: toolAnnotations('visual_diff'),
      description: VISUAL_DIFF_DESCRIPTION,
      inputSchema: z.object({
        boardId: z.string().optional().describe('ID board; kosongkan untuk board pertama'),
        nodeId: z.string().optional().describe('ID node: bandingkan hanya bounds node ini (bukan bersama boardId)'),
        fromRev: z.number().int().optional().describe('rev "sebelum"; kosongkan untuk rev sebelum tulis terakhir sesi ini'),
        toRev: z.number().int().optional().describe('rev "sesudah" (default rev kini)'),
        since: z.enum(['last', 'session']).optional().describe("tanpa fromRev: 'last' (default) = sebelum tulis terakhir sesi, 'session' = sebelum tulis pertama sesi"),
      }).strict(),
    },
    (args) =>
      guarded(async () => {
        const body = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
        const r = await client.call<{ png: string } & Record<string, unknown>>('/viewer/visual-diff', body);
        return asResult(r, ({ png, ...meta }) => [
          { type: 'image', data: png, mimeType: 'image/png' },
          { type: 'text', text: JSON.stringify(meta) },
        ]);
      }),
  );

  server.registerTool(
    'layout_check',
    {
      annotations: toolAnnotations('layout_check'),
      description: LAYOUT_CHECK_DESCRIPTION,
      inputSchema: z.object({ boardId: z.string().optional().describe('ID board; kosongkan untuk semua board dokumen aktif') }).strict(),
    },
    ({ boardId }) =>
      guarded(async () => {
        return asText(await client.call<LayoutCheckData>('/layout-check', boardId ? { boardId } : {}), formatLayoutCheck);
      }),
  );

  // spec-check-autofix: fix_check (deskripsi, format, dan registrasi di fix-check.ts).
  registerFixCheckTool(server, client);

  return server;
}
