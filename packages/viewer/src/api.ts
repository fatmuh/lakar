// Klien lakard untuk viewer. Endpoint baca: /viewer/* (termasuk /viewer/connections), /status, dan endpoint sesi (open, screenshot,
// inspect, layout-check) yang tidak mengubah dokumen. Endpoint tulis: kelola file (POST/DELETE /viewer/docs*; sesudahnya
// cache dokumen/screenshot slug terkait dibuang, lalu pendengar `onDocsChanged` dan `onFileEvent` dipanggil), Restore, dan layer manual di bawah.
// History (aplikasi 3): versi lama dari snapshot (GET revs/:rev, POST revs/:rev/screenshot, di-cache per
// `slug@rev`, isinya tidak pernah berubah) dan Restore (tulis, lewat antrean yang sama).
// Kelola halaman (aplikasi 8): tambah/rename/pindah/hapus halaman (tulis, lewat antrean yang sama).
// Ops (editor canvas, AD-7/AD-8): POST /viewer/docs/:slug/ops = satu commit semua-atau-tidak; respons membawa op invers (undo).
// Paste/impor (epic paste-vektor + adopsi open-pencil story 8): POST /viewer/docs/:slug/paste (SVG/HTML) dan
// POST /viewer/docs/:slug/import-url (halaman web → board baru), keduanya satu commit + invers.
// Layer manual (aplikasi 4): `execute` (POST /execute dari sesi viewer sendiri, kode dari codegen.ts), unggah
// gambar (POST /viewer/assets, byte mentah), dan cari ikon (POST /icons/search).
// Folder (aplikasi 10): GET/POST /viewer/folders*, tulis lewat antrean yang sama (memanggil pendengar `onDocsChanged`).
// Komentar (story 9.4): POST /viewer/docs/:slug/comments* (list/create/reply/resolve) — penulis pengguna aplikasi.
// Sinkron antar jendela: setiap permintaan membawa id jendela (`x-lakar-origin`, acak per muat halaman) sehingga event
// `change` dari jendela ini bisa dikenali sebagai gema; perubahan dari jendela lain diterapkan lewat `applyRemote`.
// Memori: blob URL PNG di-revoke saat entri cache dibuang (dengan jeda, supaya <img> yang masih memakainya sempat
// diganti); cache versi lama (`#revDocs`, `#revShots`) dibatasi LRU.
// Bentuk respons AD-11: {ok:true,data} | {ok:false,error}.
import type { FontFaceSource } from '@lakar/render';
import type { DocOp, Finding, FindingSummary, IconGlyph, LakarDocument } from '@lakar/schema';
import type { PasteReport } from './paste.js';

/** Respons GET /viewer/render-deps (dipakai liveBoard.ts; tanpa impor relatif agar api.ts bisa dites di Node). */
export type RenderDepsResult = { fonts: FontFaceSource[]; icons: IconGlyph[]; missing: { fonts: string[]; icons: string[] } };

/** Header sesi (sama dengan SESSION_HEADER @lakar/schema; disalin agar bundle tidak menarik zod). */
const SESSION_HEADER = 'x-lakar-session';
const CLIENT = 'lakar-viewer';
/** Header id jendela (sama dengan ORIGIN_HEADER events.ts). */
const ORIGIN_HEADER = 'x-lakar-origin';

/** Id acak jendela ini (pola `[A-Za-z0-9_-]`, cocok dengan validasi daemon). */
function newOrigin(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `w${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
const ORIGIN = newOrigin();

/** Batas entri cache versi lama (LRU). */
export const REV_DOCS_MAX = 40;
export const REV_SHOTS_MAX = 60;
/** Jeda sebelum blob URL yang dibuang dari cache di-revoke (<img> lama sempat diganti PNG baru). */
export const REVOKE_DELAY_MS = 30_000;

/** Board awal New file (sama dengan `BoardChoice` di files.ts; tanpa impor relatif agar api.ts bisa dites di Node). */
export type BoardChoice = { preset: 'desktop' | 'tablet' | 'mobile' } | { preset: 'custom'; width: number; height: number };
/** Kelola file dari aplikasi yang memengaruhi tab title bar (dipancarkan setelah tulis sukses). */
export type FileEvent = ({ type: 'rename'; from: string; to: string } | { type: 'archive'; slug: string } | { type: 'delete'; slug: string; archived: boolean }) & {
  /** Terjadi di jendela lain (diterima lewat stream). */
  remote?: boolean;
};
/** Folder viewer (metadata, bukan direktori); id stabil `f` + 10 karakter. */
export type Folder = { id: string; name: string; createdAt: string };
/** `GET /viewer/folders`: folder urut nama + keanggotaan slug → id folder (slug aktif saja). */
export type FolderState = { folders: Folder[]; membership: Record<string, string> };
/**
 * Ringkasan `GET /viewer/docs`. Field opsional (aplikasi 11, kolom List view): `createdAt` = entri riwayat pertama,
 * `lastClient` = klien penulis terakhir, `lastAgent` = harness agennya (spec-agent-identity-history), `check` = hasil check terakhir yang mencakup semua board pada rev ini.
 */
export type DocSummary = {
  slug: string;
  rev: number;
  updatedAt: string;
  boardCount: number;
  firstBoardId: string | null;
  createdAt?: string;
  lastClient?: string;
  lastAgent?: string;
  check?: { error: number; warning: number };
  /** Dokumen room `@lakar/sync` yang digabung (story 5): bukan file lokal — tanpa history/snapshot/folder. */
  remote?: boolean;
  /** Origin sync server room (`remote` saja). */
  server?: string;
  /** Jumlah peer di room, termasuk klien daemon (`remote` saja). */
  peers?: number;
  /** Koneksi room hidup (`remote` saja; false = menyambung ulang). */
  connected?: boolean;
};
/** Status pool render (`/status` → `pool`); `lastError` mis. "Chrome atau Edge tidak ditemukan …" di aplikasi desktop. */
export type PoolStatus = { size: number; ready: number; browserVersion?: string; lastError?: string };
export type DaemonStatus = { version: string; host: string; port: number; dataDir: string; node?: string; pool?: PoolStatus | null };
/** Config server MCP stdio dari `GET /viewer/connections`; `null` bila entry MCP tidak ditemukan. */
export type McpServerConfig = { command: string; args: string[]; env: { LAKAR_URL: string } };
export type Connections = { url: string; mcp: McpServerConfig | null };
/**
 * Baris harness dari `GET /viewer/connections/harnesses` (Install in an agent): state terdeteksi/terpasang,
 * path file config, dan pratinjau entri (`preview`, untuk dialog Confirm + badge "Adds N lines").
 * `failed` tidak pernah muncul di GET — hanya sebagai `state` hasil POST (`HarnessResult`).
 */
export type HarnessState = 'installed' | 'not-installed' | 'not-found' | 'manual';
export type HarnessFormat = 'json' | 'toml' | 'jsonc' | 'manual';
export type HarnessInfo = {
  id: string;
  label: string;
  state: HarnessState;
  configPath: string | null;
  detected: boolean;
  installed: boolean;
  matches: boolean;
  format: HarnessFormat;
  preview: string | null;
  linesAdded: number;
};
/** Hasil `POST /viewer/connections/harnesses/:id/install|uninstall`; `message` terisi saat `state:'failed'`. */
export type HarnessResult = { id: string; state: HarnessState | 'failed'; message?: string; backup?: string };
/** Hasil `POST …/:id/revert` (Undo toast / pulihkan `.bak`) dan `POST …/:id/reveal` (buka file di file manager OS). */
export type HarnessRevertResult = { id: string; restored: boolean };
export type HarnessRevealResult = { id: string; opened: boolean };
export type Screenshot = { boardId: string; width: number; height: number; url: string };
export type InspectNode = Record<string, unknown> & { id: string; name: string; type?: string; bounds?: [number, number, number, number]; children?: InspectNode[]; childCount?: number };
export type InspectResult = { docId: string; rev: number; boardId: string; node: InspectNode; truncated?: boolean };
export type HistoryEntry = { rev: number; description: string; opsSummary: string; opCount: number; at: string; session: string; client?: string; agent?: string; snapshot?: boolean; label?: string };
/** Hasil execute dari viewer (subset respons `/execute`). */
export type ExecuteResult = { docId: string; rev: number; created: { id: string; name: string }[]; check?: { boards?: string[] } };
export type UploadedAsset = { assetId: string; mime: string; width: number; height: number };
export type IconResult = { lib: string; icon: string; title?: string; aliasOf?: string };
/** Hasil operasi halaman (`/viewer/docs/:slug/pages…`). */
export type PageResult = { slug: string; rev: number; pageId: string };
/** Peer room (story 5): `kind` membedakan chip bulat (human) dan kotak (agent) di title bar. */
export type RoomPeer = { peerId: string; name: string; kind: 'human' | 'agent'; access: 'edit' | 'view'; presence?: unknown };
/** Hasil `POST /viewer/rooms/join`. */
export type RoomJoin = { slug: string; server: string; name: string; rev: number; peers: number; connected: boolean };
/** Hasil `GET /viewer/rooms/:slug/peers`. */
export type RoomPeers = { slug: string; connected: boolean; peers: RoomPeer[]; self?: string };
/**
 * Hasil `POST /viewer/docs/:slug/ops`: `inverse` = op yang membatalkan commit ini (kosong bila tanpa efek). ID node baru
 * per op diketahui lewat `refs` (ref lokal → ID; kirim `ref` pada add/duplicate). `created` = semua node yang muncul
 * di commit ini, termasuk subtree yang disisip ulang `insert` (undo hapus) dengan ID lamanya, jadi bukan hanya node baru.
 */
export type OpsResult = { slug: string; rev: number; created: { id: string; name: string; path: string[] }[]; inverse: DocOp[]; refs: Record<string, string> };
/** Body paste (route `POST /viewer/docs/:slug/paste`, epic paste-vektor story 3–4; `kind` default `svg`). */
export type PasteBody = { content: string; parentId: string; kind?: 'svg' | 'html' | 'figma' | 'pen'; x?: number; y?: number; name?: string; description?: string; width?: number };
/** Hasil paste: seperti ops (`inverse` untuk undo) + node akar baru dan laporan importer. */
export type PasteResult = OpsResult & { nodeId: string; report: PasteReport };
/** Body impor URL (route `POST /viewer/docs/:slug/import-url`, epic adopsi open-pencil story 8). */
export type ImportUrlBody = { url: string; pageId?: string; x?: number; y?: number; name?: string; description?: string; width?: number; screen?: 'landing' | 'app' | 'mobile' };
/** Hasil impor URL: seperti paste + `boardId` board baru dan metadata halaman yang diambil. */
export type ImportUrlResult = OpsResult & { nodeId: string; boardId: string; report: PasteReport; page: { url: string; finalUrl: string; title?: string } };

// ---- Sign-in cloud (spec-cloud-auth story D): status/start/logout lewat `/viewer/auth/*`.
// Session disimpan daemon (dataDir/session.json) — viewer tidak pernah memegang token. ----

/** Profil akun dari `/viewer/auth/status` (`user`, bentuk `CloudUser` daemon). */
export type CloudUser = { id: string; email: string; name?: string; avatarUrl?: string };
/** Provider sign-in yang diiklankan service; `email` = magic link (butuh alamat email). */
export type AuthProvider = 'google' | 'github' | 'email';
/** `GET /viewer/auth/status`: `configured:false` = LAKAR_CLOUD_URL belum diset; `host` = host service; `providers` hanya ada bila service menjawab. `onboarding` aditif (spec-first-run-signin) — daemon lama tanpa field → gate tidak tampil. */
export type AuthStatus = {
  signedIn: boolean;
  configured: boolean;
  user?: CloudUser;
  providers?: string[];
  host?: string;
  onboarding?: { signin: 'pending' | 'skipped' | 'completed' | 'disabled' };
};
/** Body `POST /viewer/auth/start`: OAuth (`google`/`github`) → `{url}` untuk dibuka di browser sistem; magic link (`email`) → `{sent:true}`. */
export type AuthStartBody = { provider: 'google' | 'github' } | { provider: 'email'; email: string };
export type AuthStartResult = { url: string } | { sent: true };

// ---- Share link (plan-share-link-ui): proxy daemon → @lakar/api; kunci cloud hanya di daemon. ----

/** Izin satu share link (lihat selalu ada — token = izin). */
export type SharePermissions = { comment: boolean; download: boolean };
/** Satu baris "Active links" di dialog Share (meta service + url halaman tamu). */
export type ShareLink = {
  token: string;
  slug: string;
  title: string;
  permissions: SharePermissions;
  url: string;
  createdAt: string;
  /** ISO kedaluwarsa; null = Never. */
  expiresAt: string | null;
  views: number;
  boards: { id: string; name: string; w: number; h: number }[];
};
/** `GET /viewer/docs/:slug/shares`: `configured:false` = cloud env belum diset di lakard. */
export type ShareList = { configured: boolean; host?: string; shares: ShareLink[] };
/** Hasil upload/refresh snapshot share. */
export type ShareUpload = { token: string; url: string; boards: number };
/** Body PATCH share: izin parsial dan/atau kedaluwarsa (null = Never). */
export type SharePatch = { permissions?: Partial<SharePermissions>; expiresAt?: string | null };

/** Font terpasang (GET /viewer/fonts). */
export type FontFamily = { family: string; weights: number[]; styles: string[] };
export type LayoutCheck = { docId: string; rev: number; boards: unknown; summary: FindingSummary; findings: Finding[]; ranAt: number };

// ---- Komentar (epic kolaborasi-agen story 9.4) ----

/** Penulis pesan komentar (bentuk `CommentAuthor` @lakar/schema; disalin agar bundle tidak menarik zod). */
export type CommentAuthor = { kind: 'user' | 'agent'; name: string };
export type CommentMessage = { author: CommentAuthor; text: string; at: string };
/**
 * Permintaan fix pada thread (skema v12, spec-comment-to-fix): `open` = menunggu agen; `done`/`failed` = ditutup
 * agen (`agent` = harness penutup, `note` opsional); `cancelled` = dibatalkan pengguna. `at` = transisi terakhir.
 */
export type CommentFixRequest = { status: 'open' | 'done' | 'failed' | 'cancelled'; agent?: string; at: string; note?: string };
/**
 * Thread komentar di root dokumen (skema v10): pin di layer (`nodeId`) atau titik bebas koordinat halaman
 * (`x`,`y`). `pageName`/`nodeName` hanya diisi respons list viewer (nama untuk panel; aditif).
 */
export type CommentThread = {
  id: string;
  pageId: string;
  nodeId?: string;
  x: number;
  y: number;
  status: 'open' | 'resolved';
  resolvedAt?: string;
  fixRequest?: CommentFixRequest;
  messages: CommentMessage[];
  pageName?: string;
  nodeName?: string;
};
/** Body thread baru: pin di layer (`nodeId`) atau titik bebas (`x`,`y` wajib; `pageId` → halaman itu). */
export type CommentCreateBody = { text: string; nodeId?: string; pageId?: string; x?: number; y?: number };
export type CommentCreateResult = { slug: string; rev: number; thread: CommentThread };
export type CommentReplyResult = { slug: string; rev: number; threadId: string; message: CommentMessage; thread: CommentThread };
export type CommentResolveResult = { slug: string; rev: number; threadId: string; status: 'open' | 'resolved'; resolvedAt?: string };
export type CommentDeleteResult = { slug: string; rev: number; threadId: string };
export type CommentFixResult = { slug: string; rev: number; threadId: string; fixRequest: CommentFixRequest; thread: CommentThread };

/** lakard tidak bisa dihubungi (jaringan). */
export class OfflineError extends Error {}

/** Error AD-11 dari lakard. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// ---- Status koneksi (banner offline) ----

type Listener = () => void;
let offline = false;
const listeners = new Set<Listener>();
const retryListeners = new Set<Listener>();

function setOffline(v: boolean) {
  if (offline === v) return;
  offline = v;
  for (const l of listeners) l();
}
export const connection = {
  isOffline: () => offline,
  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /** Komponen yang memuat data mendaftar di sini; tombol Retry memanggil semuanya. */
  onRetry(l: Listener) {
    retryListeners.add(l);
    return () => {
      retryListeners.delete(l);
    };
  },
  retry() {
    for (const l of retryListeners) l();
  },
};

async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, session?: string, keepalive?: boolean): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(session ? { [SESSION_HEADER]: session } : {}),
        [ORIGIN_HEADER]: ORIGIN,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      // Permintaan yang harus selamat saat halaman ditutup (pagehide).
      ...(keepalive ? { keepalive: true } : {}),
    });
  } catch (e) {
    setOffline(true);
    throw new OfflineError(e instanceof Error ? e.message : String(e));
  }
  let json: { ok: boolean; data?: T; error?: { code: string; message: string; hint: string } };
  try {
    json = await res.json();
  } catch {
    // Proxy/dev server tanpa lakard di belakangnya (502/504) dihitung offline.
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      setOffline(true);
      throw new OfflineError(`HTTP ${res.status}`);
    }
    setOffline(false);
    throw new ApiError('EXEC_ERROR', `respons lakard bukan JSON (HTTP ${res.status})`, 'periksa log lakard', res.status);
  }
  setOffline(false);
  if (!json.ok) {
    const err = json.error ?? { code: 'EXEC_ERROR', message: `HTTP ${res.status}`, hint: '' };
    throw new ApiError(err.code, err.message, err.hint, res.status);
  }
  return json.data as T;
}

/** Revoke blob URL screenshot `shot` sesudah `REVOKE_DELAY_MS` (gagal render → tidak ada URL). */
function revokeLater(shot: Promise<Screenshot>) {
  shot.then(
    (s) => {
      const t = setTimeout(() => URL.revokeObjectURL(s.url), REVOKE_DELAY_MS);
      (t as { unref?: () => void }).unref?.();
    },
    () => {},
  );
}

/** Pakai entri LRU: pindah ke ujung terbaru. */
function touch<V>(map: Map<string, V>, key: string, value: V) {
  map.delete(key);
  map.set(key, value);
}

/** Buang entri tertua sampai `map` ≤ `max`; `evicted` dipanggil untuk tiap entri yang dibuang. */
function trim<V>(map: Map<string, V>, max: number, evicted?: (v: V) => void) {
  while (map.size > max) {
    const [k, v] = map.entries().next().value as [string, V];
    map.delete(k);
    evicted?.(v);
  }
}

const pagesPath = (slug: string, pageId?: string) => `/viewer/docs/${encodeURIComponent(slug)}/pages${pageId ? `/${encodeURIComponent(pageId)}` : ''}`;
const commentsPath = (slug: string) => `/viewer/docs/${encodeURIComponent(slug)}/comments`;
const harnessPath = (id: string) => `/viewer/connections/harnesses/${encodeURIComponent(id)}`;

// ---- Klien ----

class ViewerClient {
  #session: Promise<string> | undefined;
  /** Slug aktif sesi viewer (POST /docs/open memindahkannya). */
  #active: string | undefined;
  /** Slug yang terlihat di GET /viewer/docs: hanya ini yang boleh dibuka (open_doc membuat dokumen baru). */
  #known = new Set<string>();
  /** Antrean serial: open + permintaan dokumen tidak boleh saling menyela dalam satu sesi. */
  #queue: Promise<unknown> = Promise.resolve();
  /** Rev dokumen aktif menurut respons `/docs/open` terakhir. */
  #activeRev = -1;
  /** Screenshot per `slug@rev:boardId` (rev dari daemon). */
  #shots = new Map<string, Promise<Screenshot>>();
  /** Screenshot terbaru per `slug:boardId` dengan rev render-nya: board yang tidak berubah sejak `seenRev` dipakai ulang. */
  #latest = new Map<string, { rev: number; shot: Promise<Screenshot> }>();
  /** Permintaan screenshot yang sedang antre, per argumen pemanggil. */
  #pending = new Map<string, Promise<Screenshot>>();
  /** Dokumen versi lama per `slug@rev` (snapshot tidak berubah). */
  #revDocs = new Map<string, Promise<LakarDocument>>();
  /** PNG board versi lama per `slug@rev:boardId`. */
  #revShots = new Map<string, Promise<Screenshot>>();
  /** Pendengar perubahan daftar file (kelola file dari aplikasi). */
  #changed = new Set<() => void>();
  /** Pendengar rename/archive/delete dengan slug (tab title bar). */
  #fileEvents = new Set<(e: FileEvent) => void>();

  /** Id jendela ini (dikirim di setiap permintaan sebagai `x-lakar-origin`). */
  readonly origin = ORIGIN;

  /**
   * Terapkan perubahan dari jendela lain (`remoteEffect` activity.ts): buang cache slug terkait, beri tahu
   * pendengar daftar, lalu pendengar tab bila ada event file.
   */
  applyRemote(effect: { invalidate: string[]; fileEvent?: FileEvent }) {
    this.#invalidate(...effect.invalidate);
    if (effect.fileEvent) {
      const e = { ...effect.fileEvent, remote: true };
      for (const l of this.#fileEvents) l(e);
    }
  }

  /** Daftar mungkin usang (restore/halaman di jendela lain, stream tersambung ulang): beri tahu pendengar daftar. */
  notifyDocsChanged() {
    this.#invalidate();
  }

  /** Ukuran cache (untuk test kebocoran memori). */
  cacheSizes() {
    return { shots: this.#shots.size, latest: this.#latest.size, revDocs: this.#revDocs.size, revShots: this.#revShots.size };
  }

  status() {
    return request<DaemonStatus>('GET', '/status');
  }

  connections() {
    return request<Connections>('GET', '/viewer/connections');
  }

  /**
   * Instalasi MCP ke harness (GET/POST `/viewer/connections/harnesses*`; "Install in an agent"). Bukan tulis
   * dokumen, jadi tidak lewat antrean `#write` dan tidak membuang cache; kegagalan bisnis tetap 200
   * (`state:'failed'` + `message`).
   */
  harnesses() {
    return request<{ harnesses: HarnessInfo[] }>('GET', '/viewer/connections/harnesses').then((d) => d.harnesses);
  }

  installHarness(id: string): Promise<HarnessResult> {
    return request<HarnessResult>('POST', `${harnessPath(id)}/install`);
  }

  uninstallHarness(id: string): Promise<HarnessResult> {
    return request<HarnessResult>('POST', `${harnessPath(id)}/uninstall`);
  }

  /** Pulihkan `<file>.bak` ke file config (`restored:false` bila backup tidak ada). */
  revertHarness(id: string): Promise<HarnessRevertResult> {
    return request<HarnessRevertResult>('POST', `${harnessPath(id)}/revert`);
  }

  /** Buka file config harness di file manager OS (`opened:false` bila file tidak ada). */
  revealHarness(id: string): Promise<HarnessRevealResult> {
    return request<HarnessRevealResult>('POST', `${harnessPath(id)}/reveal`);
  }

  async listDocs(): Promise<DocSummary[]> {
    const { docs } = await request<{ docs: DocSummary[] }>('GET', '/viewer/docs');
    this.#known = new Set(docs.map((d) => d.slug));
    return docs;
  }

  async getDoc(slug: string): Promise<LakarDocument> {
    const { doc } = await request<{ doc: LakarDocument }>('GET', `/viewer/docs/${encodeURIComponent(slug)}`);
    this.#known.add(slug);
    return doc;
  }

  // ---- Room `@lakar/sync` (story 5) ----

  /** Gabung room: `{server, token}` → slug `room-<token6>` yang tampil di Dashboard sebagai remote. */
  joinRoom(server: string, token: string, name?: string): Promise<RoomJoin> {
    return request<RoomJoin>('POST', '/viewer/rooms/join', { server, token, ...(name !== undefined ? { name } : {}) });
  }

  /** Keluar room (koneksi WS ditutup; dokumen tidak disimpan lokal). */
  leaveRoom(slug: string): Promise<{ slug: string; server: string }> {
    return request('POST', `/viewer/rooms/${encodeURIComponent(slug)}/leave`);
  }

  /** Daftar peer + status koneksi room (untuk chip title bar; sisanya event `peers` di stream). */
  listRoomPeers(slug: string): Promise<RoomPeers> {
    return request('GET', `/viewer/rooms/${encodeURIComponent(slug)}/peers`);
  }

  /** Siarkan presence klien ini ke peer room (kursor/seleksi; payload bebas). */
  sendRoomPresence(slug: string, presence: unknown): Promise<{ slug: string }> {
    return request('PUT', `/viewer/rooms/${encodeURIComponent(slug)}/presence`, { presence });
  }

  /**
   * Deps render canvas live (GET /viewer/render-deps): face font (`family:weight:style`) dan glyph ikon (`lib/nama`).
   * Kunci yang tidak dikenal daemon kembali di `missing`, bukan error.
   */
  async renderDeps(keys: { fonts: readonly string[]; icons: readonly string[] }): Promise<RenderDepsResult> {
    const qs = new URLSearchParams();
    for (const f of keys.fonts) qs.append('font', f);
    for (const i of keys.icons) qs.append('icon', i);
    const s = qs.toString();
    return request<RenderDepsResult>('GET', `/viewer/render-deps${s ? `?${s}` : ''}`);
  }

  /** Font terpasang di lakard (GET /viewer/fonts): keluarga + bobot + gaya, urut nama (panel Design). */
  async fonts(): Promise<FontFamily[]> {
    const { families } = await request<{ families: FontFamily[] }>('GET', '/viewer/fonts');
    return families;
  }

  /** Riwayat revisi dokumen (GET /viewer/docs/:slug/history), urut rev turun. */
  async getHistory(slug: string): Promise<HistoryEntry[]> {
    const { entries } = await request<{ entries: HistoryEntry[] }>('GET', `/viewer/docs/${encodeURIComponent(slug)}/history`);
    return entries;
  }

  /** Versi bernama (spec-viewer-named-versions): tag `rev` (default terkini) dengan `name`; snapshot rev itu di-pin. */
  async nameVersion(slug: string, name: string, rev?: number): Promise<{ rev: number; name: string; at: string }> {
    return request('POST', `/viewer/docs/${encodeURIComponent(slug)}/versions`, { name, ...(rev !== undefined ? { rev } : {}) });
  }

  /** Hapus label versi bernama di `rev` (snapshot kembali masuk retensi biasa). */
  async unnameVersion(slug: string, rev: number): Promise<void> {
    await request('DELETE', `/viewer/docs/${encodeURIComponent(slug)}/versions/${rev}`);
  }

  /** File terarsip (GET /viewer/archive). */
  async listArchive(): Promise<DocSummary[]> {
    const { docs } = await request<{ docs: DocSummary[] }>('GET', '/viewer/archive');
    return docs;
  }

  /** Dipanggil setelah New file/rename/duplicate/archive/unarchive/delete berhasil. */
  onDocsChanged(l: () => void): () => void {
    this.#changed.add(l);
    return () => {
      this.#changed.delete(l);
    };
  }

  /** Dipanggil setelah rename/archive/delete berhasil, dengan slug terkait (sesudah pendengar `onDocsChanged`). */
  onFileEvent(l: (e: FileEvent) => void): () => void {
    this.#fileEvents.add(l);
    return () => {
      this.#fileEvents.delete(l);
    };
  }

  /** Buang cache dokumen + screenshot untuk `slugs`, lalu beri tahu pendengar. */
  #invalidate(...slugs: string[]) {
    for (const slug of slugs) {
      this.#known.delete(slug);
      if (this.#active === slug) this.#active = undefined;
      for (const map of [this.#shots, this.#revShots]) {
        for (const [k, shot] of [...map]) {
          if (!k.startsWith(`${slug}@`)) continue;
          map.delete(k);
          revokeLater(shot);
        }
      }
      for (const map of [this.#pending, this.#revDocs] as Map<string, unknown>[]) for (const k of [...map.keys()]) if (k.startsWith(`${slug}@`)) map.delete(k);
      for (const k of [...this.#latest.keys()]) if (k.startsWith(`${slug}:`)) this.#latest.delete(k);
    }
    for (const l of this.#changed) l();
  }

  /** Tulis lewat antrean sesi: tidak menyela open + permintaan dokumen yang sedang berjalan. */
  #write<T>(fn: () => Promise<T>, slugs: (result: T) => string[], event?: (result: T) => FileEvent): Promise<T> {
    const run = async () => {
      const result = await fn();
      this.#invalidate(...slugs(result));
      if (event) {
        const e = event(result);
        for (const l of this.#fileEvents) l(e);
      }
      return result;
    };
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  createFile(name: string, board: BoardChoice): Promise<{ slug: string; rev: number }> {
    return this.#write(
      () => request<{ slug: string; rev: number }>('POST', '/viewer/docs', { name, board }),
      (r) => [r.slug],
    );
  }

  renameFile(slug: string, name: string): Promise<{ slug: string }> {
    return this.#write(
      () => request<{ slug: string }>('POST', `/viewer/docs/${encodeURIComponent(slug)}/rename`, { name }),
      (r) => [slug, r.slug],
      (r) => ({ type: 'rename', from: slug, to: r.slug }),
    );
  }

  duplicateFile(slug: string): Promise<{ slug: string }> {
    return this.#write(
      () => request<{ slug: string }>('POST', `/viewer/docs/${encodeURIComponent(slug)}/duplicate`),
      (r) => [r.slug],
    );
  }

  archiveFile(slug: string): Promise<{ slug: string }> {
    return this.#write(
      () => request<{ slug: string }>('POST', `/viewer/docs/${encodeURIComponent(slug)}/archive`),
      () => [slug],
      () => ({ type: 'archive', slug }),
    );
  }

  unarchiveFile(slug: string): Promise<{ slug: string }> {
    return this.#write(
      () => request<{ slug: string }>('POST', `/viewer/docs/${encodeURIComponent(slug)}/unarchive`),
      () => [slug],
    );
  }

  /** Hapus permanen; `archived` menghapus salinan di arsip. */
  deleteFile(slug: string, archived = false): Promise<{ slug: string }> {
    return this.#write(
      () => request<{ slug: string }>('DELETE', `/viewer/docs/${encodeURIComponent(slug)}${archived ? '?archived=true' : ''}`),
      () => [slug],
      () => ({ type: 'delete', slug, archived }),
    );
  }

  /** Folder + keanggotaan (GET /viewer/folders). */
  listFolders(): Promise<FolderState> {
    return request<FolderState>('GET', '/viewer/folders');
  }

  /** Folder baru; nama 1–60 karakter, bentrok (tanpa peka huruf besar) → ApiError CONFLICT. */
  createFolder(name: string): Promise<Folder> {
    return this.#write(
      () => request<{ folder: Folder }>('POST', '/viewer/folders', { name }).then((d) => d.folder),
      () => [],
    );
  }

  renameFolder(id: string, name: string): Promise<Folder> {
    return this.#write(
      () => request<{ folder: Folder }>('POST', `/viewer/folders/${encodeURIComponent(id)}/rename`, { name }).then((d) => d.folder),
      () => [],
    );
  }

  /** Hapus folder; file di dalamnya kembali ke root (tidak ada file yang dihapus). */
  deleteFolder(id: string): Promise<{ id: string; moved: string[] }> {
    return this.#write(
      () => request<{ id: string; moved: string[] }>('DELETE', `/viewer/folders/${encodeURIComponent(id)}`),
      () => [],
    );
  }

  /** Pindahkan file ke folder `folder` (null = root Files). */
  moveToFolder(slug: string, folder: string | null): Promise<{ slug: string; folder: string | null }> {
    return this.#write(
      () => request<{ slug: string; folder: string | null }>('POST', '/viewer/folders/move', { slug, folder }),
      () => [],
    );
  }

  /** Isi dokumen pada rev `rev` (snapshot). Tanpa snapshot → ApiError NOT_FOUND. */
  getRevision(slug: string, rev: number): Promise<LakarDocument> {
    const key = `${slug}@${rev}`;
    let hit = this.#revDocs.get(key);
    if (!hit) {
      hit = request<{ doc: LakarDocument }>('GET', `/viewer/docs/${encodeURIComponent(slug)}/revs/${rev}`).then((d) => d.doc);
      hit.catch(() => this.#revDocs.get(key) === hit && this.#revDocs.delete(key));
    }
    touch(this.#revDocs, key, hit);
    trim(this.#revDocs, REV_DOCS_MAX);
    return hit;
  }

  /** PNG board versi lama (POST revs/:rev/screenshot), tanpa sesi; di-cache per `slug@rev:boardId`. */
  revScreenshot(slug: string, rev: number, boardId: string): Promise<Screenshot> {
    const key = `${slug}@${rev}:${boardId}`;
    let hit = this.#revShots.get(key);
    if (!hit) {
      hit = request<{ boardId: string; width: number; height: number; png: string }>('POST', `/viewer/docs/${encodeURIComponent(slug)}/revs/${rev}/screenshot`, { boardId }).then((d) => ({
        boardId: d.boardId,
        width: d.width,
        height: d.height,
        url: pngUrl(d.png),
      }));
      hit.catch(() => this.#revShots.get(key) === hit && this.#revShots.delete(key));
    }
    touch(this.#revShots, key, hit);
    trim(this.#revShots, REV_SHOTS_MAX, revokeLater);
    return hit;
  }

  /** Pulihkan rev `rev` sebagai rev baru (POST /viewer/docs/:slug/restore). `baseRev` = rev terkini yang dilihat; usang → CONFLICT. */
  restore(slug: string, rev: number, baseRev?: number): Promise<{ slug: string; rev: number; restoredFrom: number }> {
    return this.#write(
      () =>
        request<{ slug: string; rev: number; restoredFrom: number }>('POST', `/viewer/docs/${encodeURIComponent(slug)}/restore`, {
          rev,
          ...(baseRev !== undefined ? { baseRev } : {}),
        }),
      () => [slug],
    );
  }

  // ---- Kelola halaman (aplikasi 8): POST/DELETE /viewer/docs/:slug/pages…, lewat antrean tulis yang sama. ----

  /** Halaman baru di akhir (nama default "Page N" bila `name` kosong). */
  addPage(slug: string, name?: string): Promise<PageResult> {
    return this.#write(
      () => request<PageResult>('POST', pagesPath(slug), name === undefined ? {} : { name }),
      () => [slug],
    );
  }

  /** Ganti nama halaman (di-trim daemon, 1–100 karakter). */
  renamePage(slug: string, pageId: string, name: string): Promise<PageResult> {
    return this.#write(
      () => request<PageResult>('POST', `${pagesPath(slug, pageId)}/rename`, { name }),
      () => [slug],
    );
  }

  /** Pindah halaman ke indeks `index` (0..n-1); indeks sama → rev tetap. */
  movePage(slug: string, pageId: string, index: number): Promise<PageResult> {
    return this.#write(
      () => request<PageResult>('POST', `${pagesPath(slug, pageId)}/move`, { index }),
      () => [slug],
    );
  }

  /**
   * Terapkan `ops` sebagai satu commit semua-atau-tidak (lewat antrean tulis). Op gagal → ApiError (error op
   * pertama, prefiks `ops[i]`), dokumen tidak berubah. Undo/redo = kirim `inverse` hasil sebelumnya.
   */
  applyOps(slug: string, ops: DocOp[], description?: string): Promise<OpsResult> {
    return this.#write(
      () => request<OpsResult>('POST', `/viewer/docs/${encodeURIComponent(slug)}/ops`, { ops, ...(description !== undefined ? { description } : {}) }),
      () => [slug],
    );
  }

  /**
   * Tempel SVG (importer daemon, AD-15) ke board/frame `parentId` sebagai satu commit (lewat antrean tulis).
   * Respons membawa `inverse` seperti `applyOps` (undo paste) dan laporan atribut yang dibuang.
   */
  paste(slug: string, body: PasteBody): Promise<PasteResult> {
    return this.#write(
      () => request<PasteResult>('POST', `/viewer/docs/${encodeURIComponent(slug)}/paste`, body),
      () => [slug],
    );
  }

  /**
   * Impor halaman web dari URL (POST /viewer/docs/:slug/import-url) sebagai board baru: daemon fetch http(s)
   * eksplisit (anti-SSRF, 15 s/10 MB, tanpa skrip) lalu menjalankan pipeline HTML yang sama dengan paste.
   * Respons membawa `inverse` seperti `applyOps` (undo impor) dan `report` laporan importer.
   */
  importUrl(slug: string, body: ImportUrlBody): Promise<ImportUrlResult> {
    return this.#write(
      () => request<ImportUrlResult>('POST', `/viewer/docs/${encodeURIComponent(slug)}/import-url`, body),
      () => [slug],
    );
  }

  /**
   * Laporkan seleksi canvas ke daemon (PUT /viewer/docs/:slug/selection, AD-9). Hanya di memori daemon: bukan tulis
   * dokumen, jadi tidak lewat antrean tulis dan tidak membuang cache.
   */
  putSelection(slug: string, addresses: readonly string[]): Promise<{ slug: string; rev: number; addresses: string[] }> {
    return request('PUT', `/viewer/docs/${encodeURIComponent(slug)}/selection`, { addresses });
  }

  /**
   * Laporkan dokumen yang tampil di jendela ini (PUT /viewer/focus; null = Dashboard). Hanya di memori daemon, dipakai
   * `open_doc` tanpa slug: bukan tulis dokumen, jadi tidak lewat antrean tulis. `keepalive` untuk laporan `pagehide`
   * (jalur cepat; jaminannya stream `/viewer/events` jendela ini yang tertutup).
   */
  putFocus(slug: string | null, opts: { keepalive?: boolean } = {}): Promise<{ slug: string | null; focused: string | null }> {
    return request('PUT', '/viewer/focus', { slug }, undefined, opts.keepalive);
  }

  /** Hapus halaman beserta board-nya; halaman terakhir → ApiError CONFLICT. */
  deletePage(slug: string, pageId: string): Promise<PageResult> {
    return this.#write(
      () => request<PageResult>('DELETE', pagesPath(slug, pageId)),
      () => [slug],
    );
  }

  // ---- Komentar (story 9.4): POST /viewer/docs/:slug/comments/{create,reply,resolve} — penulis pesan = pengguna
  // aplikasi ("You"). Route list `…/comments` tidak dipakai klien (thread ikut dokumen) — tetap ada untuk konsumen lain. ----

  /** Thread baru: pin di layer (`nodeId`) atau titik bebas (`x`,`y`; `pageId` opsional → halaman pertama). */
  addComment(slug: string, body: CommentCreateBody): Promise<CommentCreateResult> {
    return this.#write(
      () => request<CommentCreateResult>('POST', `${commentsPath(slug)}/create`, body),
      () => [slug],
    );
  }

  /** Balas thread `threadId` (pesan pengguna di akhir thread). */
  replyComment(slug: string, threadId: string, text: string): Promise<CommentReplyResult> {
    return this.#write(
      () => request<CommentReplyResult>('POST', `${commentsPath(slug)}/reply`, { threadId, text }),
      () => [slug],
    );
  }

  /** Hapus thread permanen (bukan resolve — dokumen kehilangan threadnya; restore lewat History). */
  deleteComment(slug: string, threadId: string): Promise<CommentDeleteResult> {
    return this.#write(
      () => request<CommentDeleteResult>('POST', `${commentsPath(slug)}/delete`, { threadId }),
      () => [slug],
    );
  }

  /** Tandai thread resolved / buka kembali (`resolved` default true). Idempoten — status sama → rev tetap. */
  resolveComment(slug: string, threadId: string, resolved?: boolean): Promise<CommentResolveResult> {
    return this.#write(
      () => request<CommentResolveResult>('POST', `${commentsPath(slug)}/resolve`, { threadId, ...(resolved !== undefined ? { resolved } : {}) }),
      () => [slug],
    );
  }

  /**
   * Minta agen memperbaiki thread ini (mailbox, spec-comment-to-fix): fixRequest `open` + pesan prompt di thread.
   * `agent` = harness yang dituju (opsional). Idempoten — sudah open → rev tetap.
   */
  requestFix(slug: string, threadId: string, agent?: string): Promise<CommentFixResult> {
    return this.#write(
      () => request<CommentFixResult>('POST', `${commentsPath(slug)}/${encodeURIComponent(threadId)}/fix`, agent !== undefined ? { agent } : {}),
      () => [slug],
    );
  }

  /** Batalkan permintaan fix yang masih open. Idempoten — sudah cancelled → rev tetap; terminal lain → 409. */
  cancelFix(slug: string, threadId: string): Promise<CommentFixResult> {
    return this.#write(
      () => request<CommentFixResult>('POST', `${commentsPath(slug)}/${encodeURIComponent(threadId)}/fix`, { outcome: 'cancelled' }),
      () => [slug],
    );
  }

  /**
   * Export PNG board (POST /viewer/docs/:slug/export): byte PNG + nama file dari `content-disposition`.
   * `nodeId` (Copy as PNG) = satu node tersimpan di dalam board itu; board lain/tidak ada → 404 NOT_FOUND.
   * Tanpa sesi; error tetap berbentuk AD-11 (JSON).
   */
  async exportPng(slug: string, boardId: string, scale: 1 | 2, nodeId?: string): Promise<{ blob: Blob; filename: string }> {
    let res: Response;
    try {
      res = await fetch(`/viewer/docs/${encodeURIComponent(slug)}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ boardId, scale, ...(nodeId !== undefined ? { nodeId } : {}) }),
      });
    } catch (e) {
      setOffline(true);
      throw new OfflineError(e instanceof Error ? e.message : String(e));
    }
    if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/png')) {
      setOffline(false);
      return { blob: await res.blob(), filename: exportFileName(res.headers.get('content-disposition'), `${slug}@${scale}x.png`) };
    }
    let json: { ok?: boolean; error?: { code: string; message: string; hint: string } } | undefined;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (!json && (res.status === 502 || res.status === 504)) {
      setOffline(true);
      throw new OfflineError(`HTTP ${res.status}`);
    }
    setOffline(false);
    const err = json?.error ?? { code: 'EXPORT_FAILED', message: `HTTP ${res.status}`, hint: '' };
    throw new ApiError(err.code, err.message, err.hint, res.status);
  }

  /**
   * Ekspor seleksi ke berkas di disk (seksi Export tab Design): POST /viewer/docs/:slug/export-file. Daemon menulis
   * langsung ke `dir` (absolut/`~`) dengan ekstensi dari `format`; nama benturan diberi suffix. Balasan: path tertulis.
   */
  async exportFile(
    slug: string,
    body: { boardId: string; nodeId?: string; scale: 1 | 2; format: 'png' | 'svg'; dir: string; name: string },
  ): Promise<{ path: string; bytes: number; dropped: string[] }> {
    let res: Response;
    try {
      res = await fetch(`/viewer/docs/${encodeURIComponent(slug)}/export-file`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      setOffline(true);
      throw new OfflineError(e instanceof Error ? e.message : String(e));
    }
    let json: { ok?: boolean; data?: { path: string; bytes: number; dropped: string[] }; error?: { code: string; message: string; hint: string } } | undefined;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (!json && (res.status === 502 || res.status === 504)) {
      setOffline(true);
      throw new OfflineError(`HTTP ${res.status}`);
    }
    if (res.ok && json?.ok && json.data) {
      setOffline(false);
      return json.data;
    }
    setOffline(false);
    const err = json?.error ?? { code: 'EXPORT_FAILED', message: `HTTP ${res.status}`, hint: '' };
    throw new ApiError(err.code, err.message, err.hint, res.status);
  }

  #sessionId(): Promise<string> {
    this.#session ??= request<{ sessionId: string }>('POST', '/sessions', { client: CLIENT }).then(
      (d) => d.sessionId,
      (e) => {
        this.#session = undefined;
        throw e;
      },
    );
    return this.#session;
  }

  /**
   * Jalankan `fn` dengan sesi yang dokumen aktifnya `slug`; `fn` menerima rev dari respons `/docs/open`.
   * `minRev` (rev yang sudah dilihat pemanggil) lebih baru dari rev aktif → buka ulang untuk rev terkini.
   * Sesi hilang (daemon restart, 401) → buat ulang sekali.
   */
  #withDoc<T>(slug: string, fn: (session: string, rev: number) => Promise<T>, minRev = -1): Promise<T> {
    const run = async (): Promise<T> => {
      if (!this.#known.has(slug)) {
        await this.listDocs();
        if (!this.#known.has(slug)) throw docGone(slug);
      }
      for (let attempt = 0; ; attempt++) {
        const session = await this.#sessionId();
        try {
          if (this.#active !== slug || this.#activeRev < minRev) {
            this.#active = undefined;
            // open_doc membuat dokumen bila slug tidak ada: pastikan dokumen masih ada tepat sebelum membuka.
            try {
              await request('GET', `/viewer/docs/${encodeURIComponent(slug)}`);
            } catch (e) {
              if (e instanceof ApiError && e.code === 'NOT_FOUND') {
                this.#known.delete(slug);
                throw docGone(slug);
              }
              throw e;
            }
            const opened = await request<{ rev: number }>('POST', '/docs/open', { slug }, session);
            this.#active = slug;
            this.#activeRev = opened.rev;
          }
          return await fn(session, this.#activeRev);
        } catch (e) {
          if (attempt === 0 && e instanceof ApiError && e.status === 401) {
            this.#session = undefined;
            this.#active = undefined;
            continue;
          }
          throw e;
        }
      }
    };
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  /**
   * PNG board (renderer yang sama dengan bench, AD-6), di-cache per `slug@rev:boardId` dengan rev yang
   * benar-benar dirender daemon (respons `/docs/open`), bukan rev dari pemanggil (`seenRev` hanya petunjuk).
   * `seenRev` = rev terakhir board ini berubah: PNG yang dirender pada rev ≥ `seenRev` masih benar dan dipakai ulang,
   * jadi saat rev dokumen naik hanya board tersentuh yang dirender ulang.
   */
  screenshot(slug: string, seenRev: number, boardId: string): Promise<Screenshot> {
    const latest = this.#latest.get(`${slug}:${boardId}`);
    if (latest && latest.rev >= seenRev) return latest.shot;
    const pendingKey = `${slug}@${seenRev}:${boardId}`;
    let pending = this.#pending.get(pendingKey);
    if (!pending) {
      pending = this.#withDoc(
        slug,
        (s, rev) => {
          const key = `${slug}@${rev}:${boardId}`;
          let hit = this.#shots.get(key);
          if (!hit) {
            hit = request<{ boardId: string; width: number; height: number; mimeType: string; png: string }>('POST', '/screenshot', { boardId }, s).then((d) => ({
              boardId: d.boardId,
              width: d.width,
              height: d.height,
              url: pngUrl(d.png),
            }));
            const latestKey = `${slug}:${boardId}`;
            const entry = { rev, shot: hit };
            hit.catch(() => {
              this.#shots.delete(key);
              if (this.#latest.get(latestKey) === entry) this.#latest.delete(latestKey);
            });
            this.#shots.set(key, hit);
            const prev = this.#latest.get(latestKey);
            if (!prev || prev.rev <= rev) {
              this.#latest.set(latestKey, entry);
              // PNG rev lama board ini tidak dipakai lagi (rev hanya naik): buang dan revoke URL-nya.
              if (prev && prev.rev < rev) {
                const oldKey = `${slug}@${prev.rev}:${boardId}`;
                if (this.#shots.get(oldKey) === prev.shot) this.#shots.delete(oldKey);
                revokeLater(prev.shot);
              }
            }
          }
          return hit;
        },
        seenRev,
      );
      const done = () => this.#pending.delete(pendingKey);
      pending.then(done, done);
      this.#pending.set(pendingKey, pending);
    }
    return pending;
  }

  inspect(slug: string, id: string, depth = 0): Promise<InspectResult> {
    return this.#withDoc(slug, (s) => request<InspectResult>('POST', '/inspect', { id, depth }, s));
  }

  /**
   * Jalankan snippet `code` pada dokumen `slug` dari sesi viewer (layer manual). Transaksi, history, dan
   * `layout_check` sama dengan execute agen; gagal → ApiError (dokumen di-rollback daemon).
   */
  execute(slug: string, code: string, description: string): Promise<ExecuteResult> {
    return this.#withDoc(slug, async (s) => {
      const r = await request<ExecuteResult>('POST', '/execute', { code, description }, s);
      if (this.#active === slug) this.#activeRev = Math.max(this.#activeRev, r.rev);
      return r;
    });
  }

  /** Unggah gambar (byte mentah) ke store aset daemon. Bukan gambar → 400, > 20 MB → 413 (ApiError). */
  async uploadAsset(file: Blob): Promise<UploadedAsset> {
    let res: Response;
    try {
      res = await fetch('/viewer/assets', { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
    } catch (e) {
      setOffline(true);
      throw new OfflineError(e instanceof Error ? e.message : String(e));
    }
    let json: { ok?: boolean; data?: UploadedAsset; error?: { code: string; message: string; hint: string } } | undefined;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (!json && (res.status === 502 || res.status === 503 || res.status === 504)) {
      setOffline(true);
      throw new OfflineError(`HTTP ${res.status}`);
    }
    setOffline(false);
    if (json?.ok && json.data) return json.data;
    const err = json?.error ?? { code: res.status === 413 ? 'SCHEMA_INVALID' : 'EXEC_ERROR', message: res.status === 413 ? 'Image is larger than 20 MB' : `HTTP ${res.status}`, hint: '' };
    throw new ApiError(err.code, err.message, err.hint, res.status);
  }

  /** Cari ikon katalog (POST /icons/search, butuh sesi; tanpa dokumen aktif). Sesi hilang → buat ulang sekali. */
  async iconSearch(query: string, limit = 48): Promise<IconResult[]> {
    for (let attempt = 0; ; attempt++) {
      const session = await this.#sessionId();
      try {
        const { results } = await request<{ results: IconResult[] }>('POST', '/icons/search', { query, limit }, session);
        return results;
      } catch (e) {
        if (attempt === 0 && e instanceof ApiError && e.status === 401) {
          this.#session = undefined;
          this.#active = undefined;
          continue;
        }
        throw e;
      }
    }
  }

  layoutCheck(slug: string): Promise<LayoutCheck> {
    return this.#withDoc(slug, async (s) => ({ ...(await request<Omit<LayoutCheck, 'ranAt'>>('POST', '/layout-check', {}, s)), ranAt: Date.now() }));
  }

  // ---- Sign-in cloud (spec-cloud-auth story D): `/viewer/auth/*`; token session tetap di daemon. ----

  /** Status sign-in cloud (`GET /viewer/auth/status`). `providers` diisi bila service menjawab; `host` = host LAKAR_CLOUD_URL. */
  authStatus(): Promise<AuthStatus> {
    return request<AuthStatus>('GET', '/viewer/auth/status');
  }

  /**
   * Mulai sign-in (POST /viewer/auth/start): `{provider:'google'|'github'}` → `{url}` yang dibuka viewer
   * di browser sistem (`window.open` di browser; `openExternal` desktop.ts di aplikasi Tauri —
   * `window.open` no-op di sana); `{provider:'email', email}` → `{sent:true}` (magic link terkirim).
   */
  authStart(body: AuthStartBody): Promise<AuthStartResult> {
    return request<AuthStartResult>('POST', '/viewer/auth/start', body);
  }

  /** Sign out (POST /viewer/auth/logout): hapus session lokal + revoke di service. Idempoten. */
  authLogout(): Promise<{ signedIn: false }> {
    return request<{ signedIn: false }>('POST', '/viewer/auth/logout');
  }
  // ---- Share link (plan-share-link-ui): proxy `/viewer/*` ke @lakar/api; tanpa sesi dokumen. ----

  /** Daftar share aktif dokumen `slug` (+ `configured:false` bila cloud env lakard belum diset). */
  listShares(slug: string): Promise<ShareList> {
    return request<ShareList>('GET', `/viewer/docs/${encodeURIComponent(slug)}/shares`);
  }

  /** Buat link baru: render snapshot board lalu upload ke service (daemon yang merender). */
  createShare(slug: string, permissions?: SharePermissions): Promise<ShareUpload> {
    return request<ShareUpload>('POST', `/viewer/docs/${encodeURIComponent(slug)}/share`, permissions ? { permissions } : undefined);
  }

  /** Ubah izin dan/atau kedaluwarsa link `token` (`expiresAt:null` = Never). */
  patchShare(token: string, patch: SharePatch): Promise<Record<string, unknown>> {
    return request('PATCH', `/viewer/shares/${encodeURIComponent(token)}`, patch);
  }

  /** Revoke link `token` — semua GET publiknya langsung 404. */
  revokeShare(token: string): Promise<{ token: string; revoked: boolean }> {
    return request('DELETE', `/viewer/shares/${encodeURIComponent(token)}`);
  }

  /** "Update snapshot": render ulang `slug` dan ganti PNG/doc link `token` (URL & komentar tetap). */
  refreshShare(token: string, slug: string): Promise<ShareUpload> {
    return request<ShareUpload>('POST', `/viewer/shares/${encodeURIComponent(token)}/refresh`, { slug });
  }
}

const docGone = (slug: string) => new ApiError('NOT_FOUND', `dokumen ${slug} tidak ada`, 'pilih dokumen dari Dashboard', 404);

function pngUrl(base64: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
}

/** Nama file dari header `content-disposition` (`filename="…"`); tanpa nama → `fallback`. */
export function exportFileName(disposition: string | null, fallback: string): string {
  const m = /filename="([^"]+)"/i.exec(disposition ?? '') ?? /filename=([^;]+)/i.exec(disposition ?? '');
  const name = m?.[1]?.trim();
  return name && !/[\\/]/.test(name) ? name : fallback;
}

export const api = new ViewerClient();

/** URL pratinjau SVG ikon katalog (GET /viewer/icons/:lib/:icon). */
export const iconPreviewUrl = (lib: string, icon: string) => `/viewer/icons/${encodeURIComponent(lib)}/${encodeURIComponent(icon)}`;

export function errorText(e: unknown): string {
  if (e instanceof OfflineError) return "Can't reach lakard";
  if (e instanceof ApiError) return e.hint ? `${e.message} (${e.hint})` : e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
