---
type: sprint-change-proposal
title: "Viewer tanpa prompt, aplikasi desktop lintas OS, dan B paralel dengan G1"
date: 2026-11-21
proposer: Fathur
approver: Adam (menunggu)
status: disetujui pengusul (Fathur, 2026-11-21), menunggu Adam
scope: major
sources:
  - _bmad-output/initiative-lakar/initiative-lakar.md
  - _bmad-output/initiative-lakar/tickets/tickets.toml
  - _bmad-output/initiative-lakar/tickets/epic-b-lihat-arahkan/epic-b-lihat-arahkan.md
  - _bmad-output/initiative-lakar/tickets/epic-g1-inti-lengkap/epic-g1-inti-lengkap.md
  - design/README.md
  - design/lakar-ui.pen
---

# Sprint Change Proposal: viewer tanpa prompt, aplikasi desktop lintas OS, B paralel dengan G1

Status: **draft, menunggu keputusan Adam**. Dokumen sumber (initiative, tickets, epic) belum diubah. Semua perubahan di bawah baru berlaku setelah Adam menyetujui.

## 1. Ringkasan masalah

Pemicunya bukan story yang gagal. Ada tiga usulan perubahan arah dari Fathur, yang muncul saat eksplorasi desain UI B di pen.dev (2026-11-21, `design/`):

1. **Model interaksi UI B.** R10 dan epic B mengasumsikan Lakar punya *panel prompt*. Prompt sebenarnya sudah diberikan di harness masing-masing (Claude Code, Codex, klien ACP lain), dan agen bekerja lewat MCP `lakar`. Panel prompt di Lakar akan menduplikasi harness dan menambah cakupan (integrasi model, autentikasi, biaya) tanpa nilai yang jelas. Usulannya: **UI B menjadi viewer**. Lakar menampilkan hasil, aktivitas tool call secara live, temuan `layout_check`, dan riwayat. Seleksi di canvas tetap menjadi konteks agen.
2. **Target rilis.** Inisiatif hanya menargetkan `lakard` sebagai systemd user service di VPS. Usulannya: tambahkan **aplikasi desktop ringan untuk Windows, macOS, dan Linux** (Tauri, daemon Node sebagai sidecar, render memakai Chrome/Edge yang sudah ada di sistem), dibangun lewat GitHub Actions. **`lakard` di VPS tetap dipertahankan** untuk bench dan G1.
3. **Urutan kerja.** C4 menetapkan B baru boleh dimulai setelah G1 lulus. G1 sudah 11 dari 16 story *built* di branch `g1`. Story yang tersisa: revisi skill, baseline pen.dev C/D/E (terhambat batas paket pen.dev), refactor, rilis, dan putaran resmi A–E. Usulannya: **B dikerjakan paralel dengan G1**.

Jenis masalah: *strategic pivot* (model interaksi dan target rilis), ditambah perubahan prioritas (urutan).

Bukti dan konteks:
- `design/README.md`: 4 bagian desain (Dashboard, Pages, Viewer, Agent presence), lengkap dengan komponen, token, motion, dan 7 celah API daemon.
- `tickets.toml`, epic G1: 11/16 story *built* di `origin/g1` (commit terakhir 2026-11-19), belum di-merge ke `main`.
- `main` sekarang sudah punya CI (build + test) dan review otomatis PR (PR #1, merge `74cab16`).

## 2. Analisis dampak

### Checklist

| Item | Status | Catatan |
|---|---|---|
| 1.1 Story pemicu | N/A | Pemicu dari eksplorasi desain, bukan story |
| 1.2 Definisi masalah | Done | Pivot strategis dan perubahan prioritas (bagian 1) |
| 1.3 Bukti | Done | `design/`, `tickets.toml`, status branch `g1` |
| 2.1 Epic yang sedang berjalan (G1) | Done | G1 tetap bisa selesai sesuai rencana; tidak ada story G1 yang berubah |
| 2.2 Perubahan level epic | Action-needed | Epic B diubah; ada epic baru untuk desktop |
| 2.3 Epic mendatang | Done | Hanya B yang terdampak |
| 2.4 Epic usang atau baru | Action-needed | Epic baru: rilis desktop lintas OS |
| 2.5 Urutan dan prioritas | Action-needed | B paralel dengan G1 (C4 diubah) |
| 3.1 Requirement (pengganti PRD) | Action-needed | R10 diubah, R13 baru, C4 diubah, C9 dipertegas |
| 3.2 Arsitektur | Action-needed | Render, sidecar, dan API daemon baru. Dokumen arsitektur tidak ada di git lokal, jadi perlu `bmad-architecture` |
| 3.3 UX | Action-needed | Belum ada spesifikasi UX B. Jalankan `bmad-ux` dengan `design/` sebagai input |
| 3.4 Artefak lain | Action-needed | Workflow rilis GitHub Actions, code signing, kecocokan test di Windows |
| 4.1 Opsi penyesuaian langsung | Viable | Ubah epic B dan R10, tambah epic dan story baru |
| 4.2 Opsi rollback | Not viable | Tidak ada pekerjaan yang perlu dibatalkan |
| 4.3 Opsi tinjau ulang MVP | Viable sebagian | Outcome inisiatif tetap; R10 dipersempit, target rilis ditambah |
| 4.4 Pilihan jalur | Done | Hybrid: penyesuaian langsung + epic baru (bagian 3) |

### Dampak ke epic

- **G0** (selesai): tidak terdampak.
- **G1** (berjalan): tidak ada story yang berubah. Risikonya ada pada perebutan perhatian dan API daemon. B butuh API daemon yang stabil, sedangkan story G1 yang tersisa (refactor sweep dan rilis) bisa mengubah daemon. Mitigasinya ada di bagian 3.
- **B** (belum di-refine): Description, Done-when, dan `after` berubah (detail di bagian 4.2).
- **Epic baru, "Rilis desktop lintas OS"**: membungkus daemon dan viewer B sebagai aplikasi Tauri untuk Windows, macOS, dan Linux, dengan build dan rilis lewat GitHub Actions. Epic ini bergantung pada viewer B.

### Konflik dengan artefak

- **Requirement** (`initiative-lakar.md`): R10 (panel prompt), C4 (urutan), dan Done-when inisiatif ("UI berjalan dari `lakard` di VPS"). Perlu ditambahkan R13 untuk desktop.
- **Arsitektur:**
  - **AD-6** (satu modul render): tetap berlaku, tapi aplikasi desktop memakai browser sistem lewat channel `playwright-core` (`chrome`/`msedge`), bukan chromium-headless-shell yang dibundel. Konsistensi render antara canvas dan PNG bench perlu diverifikasi, karena versi browser bisa berbeda.
  - **AD-18** (pool Chromium): pool tetap ada; cara mendapatkan browser-nya berbeda di desktop.
  - **AD-17** (sesi), **AD-11** (error), **AD-4** (`baseRev`): menjadi dasar stream event dan riwayat.
  - **Spine systemd dan Node 26 di `/opt`**: di desktop, daemon dijalankan oleh Tauri sebagai sidecar. Node 26 dibundel (misalnya Node SEA) atau dijalankan dari runtime yang ikut dalam paket.
  - **API baru yang dibutuhkan viewer** (dari `design/README.md`): seleksi sebagai konteks agen (tool MCP baru atau field di `status`/`inspect`), stream event live per tool call beserta node target, identitas harness per sesi, riwayat versi dan Restore, format error `execute` yang ramah pengguna, operasi file (rename, delete, export PNG), dan health check.
- **UX:** spesifikasi B belum ada (open question inisiatif). `design/` menjadi input `bmad-ux`.
- **Artefak lain:**
  - Workflow rilis GitHub Actions dengan matrix Windows, macOS, dan Linux.
  - Code signing: Apple Developer ID dan notarisasi untuk macOS, sertifikat untuk Windows. Tanpa ini aplikasi tetap bisa dipasang, tapi dengan peringatan.
  - Kecocokan test di Windows: run lokal 2026-11-21 dengan Node 26 menghasilkan 98 test gagal dari 902, kebanyakan di `photos.test.ts`. Di CI Linux semuanya lolos.

## 3. Jalur yang direkomendasikan

**Hybrid: penyesuaian langsung ditambah epic baru.** Tidak ada rollback, dan outcome inisiatif tidak berubah.

- **Penyesuaian langsung:** R10 dipersempit menjadi model viewer, C4 diubah agar B boleh paralel, dan epic B diperbarui.
- **Epic baru:** rilis desktop lintas OS dengan requirement R13.
- **Pengaman untuk paralel:**
  1. API daemon yang dibutuhkan B ditambahkan sebagai **endpoint baru**. Endpoint yang dipakai bench dan G1 tidak diubah, dan tool MCP v1 tetap dibekukan selama putaran bench (sesuai `packages/mcp/README.md`).
  2. Koding B dimulai setelah `bmad-architecture` dan `bmad-ux` untuk B selesai.
  3. Putaran resmi G1 (story 14) tetap memakai rilis `lakard` di VPS, tanpa kode UI dan desktop.
  4. Gerbang G1 tidak berubah (≥ 4/5 setara atau lebih baik, ≥ 1 lebih baik, nol emoji, waktu ≤ 1,5×).

**Alasan:**
- Panel prompt menduplikasi harness. Model viewer lebih kecil cakupannya dan selaras dengan cara kerja agen lewat MCP.
- Desktop sebagai *tambahan* tidak mengganggu bench dan G1, yang bergantung pada `lakard` di VPS.
- Mengerjakan B paralel memanfaatkan waktu tunggu G1 yang terhambat batas paket pen.dev.

**Estimasi dan risiko:**

| Bagian | Usaha | Risiko |
|---|---|---|
| Perubahan dokumen (R10, C4, R13, epic B) | Rendah | Rendah |
| Arsitektur dan API daemon baru | Sedang | Sedang: kestabilan API selama G1 berjalan |
| Viewer B (web UI) | Tinggi | Sedang |
| Desktop: Tauri, sidecar Node 26, browser sistem | Tinggi | Tinggi: Node 26 di sidecar, perbedaan render browser sistem vs headless-shell, code signing |
| Kecocokan test di Windows | Sedang | Rendah |

**Dampak waktu:** G1 tidak bertambah lama asalkan pengaman di atas dipatuhi. B dan desktop menambah pekerjaan baru yang berjalan paralel.

## 4. Usulan perubahan rinci

### 4.1 Requirement (`initiative-lakar.md`)

**R10.** Lama:
> R10 (forge §Keputusan terkunci, B): pengguna melihat dan mengarahkan agen dari canvas Lakar: pan/zoom, seleksi sebagai konteks agen, panel prompt, progres live, dan riwayat. Terbukti bila Adam memilih node di canvas, memberi prompt, lalu melihat perubahan muncul live dan tercatat di riwayat.

Baru:
> R10 (forge §Keputusan terkunci, B; diubah 2026-11-21): pengguna melihat dan mengarahkan agen dari canvas Lakar: pan/zoom, seleksi sebagai konteks agen, progres live (aktivitas tool call per harness, temuan `layout_check`), dan riwayat. Prompt diberikan di harness terpisah (Claude Code, Codex, klien ACP); Lakar tidak memiliki kotak prompt. Terbukti bila Adam memilih node di canvas, memberi prompt di harness yang merujuk seleksi itu, lalu melihat perubahan muncul live di canvas dan tercatat di riwayat.

Alasan: panel prompt menduplikasi harness. Seleksi tetap menjadi jalur untuk mengarahkan agen.

**R13 (baru):**
> R13 (keputusan 2026-11-21): Lakar tersedia sebagai aplikasi desktop untuk Windows, macOS, dan Linux yang menjalankan daemon secara lokal dan menampilkan viewer B. Aplikasi ini memakai renderer yang sama (AD-6) dengan browser sistem, dan dibangun serta dirilis lewat GitHub Actions. Terbukti bila installer ketiga OS terbentuk dari satu tag rilis, aplikasi berjalan tanpa Node atau Chromium terpasang terpisah, dan harness MCP bisa terhubung ke daemon lokalnya. `lakard` di VPS tetap menjadi target rilis untuk bench.

**C4.** Lama:
> C4: urutannya A tanpa UI → benchmark → B. B dimulai hanya setelah G1 lulus. Kalau G0 gagal, pekerjaan lanjutan berhenti sampai arah dievaluasi.

Baru:
> C4 (diubah 2026-11-21): urutannya A tanpa UI → benchmark, dengan B dan rilis desktop boleh dikerjakan paralel dengan G1 setelah arsitektur dan UX B disetujui. Syaratnya: perubahan daemon untuk B hanya berupa endpoint baru, tool MCP v1 tetap beku selama putaran bench, dan putaran resmi G1 memakai rilis `lakard` di VPS. Kalau G1 gagal, pekerjaan B berhenti sampai arah dievaluasi.

**C9 (dipertegas, tanpa mengubah isi):** tambahkan kalimat *"C9 berlaku untuk mesin bersama (VPS); aplikasi desktop berjalan di mesin pengguna dan tidak tunduk pada C9."*

**Done when (inisiatif).** Lama:
> Adam mengarahkan agen dari canvas B: memilih node, memberi prompt, dan melihat progres live serta riwayat.

Baru:
> Adam mengarahkan agen dengan memilih node di canvas B dan memberi prompt di harness, lalu melihat progres live serta riwayat di Lakar. Installer desktop Windows, macOS, dan Linux terbentuk dari satu tag rilis.

**Boundaries.** Tambahkan touch point:
> GitHub Actions: CI, review otomatis PR, dan rilis desktop lintas OS; owner: epic rilis desktop.

### 4.2 Epic B (`epic-b-lihat-arahkan.md`)

- **`after`:** `[epic-g1-inti-lengkap]` menjadi `[]`. B paralel dengan G1, dengan syarat C4 yang baru.
- **Description.** Lama: *"... pan/zoom, seleksi sebagai konteks agen, panel prompt, progres live lewat WebSocket, dan riwayat. Epic dimulai setelah G1 lulus."* Baru: *"... pan/zoom, seleksi sebagai konteks agen, progres live lewat WebSocket (aktivitas tool call per harness, temuan `layout_check`), dan riwayat. Tidak ada kotak prompt. Epic boleh paralel dengan G1 sesuai C4 (2026-11-21)."*
- **Done when, butir 1.** Lama: *"Adam memilih node di canvas, memberi prompt, lalu melihat perubahan muncul live dan tercatat di riwayat."* Baru: *"Adam memilih node di canvas, memberi prompt di harness yang merujuk seleksi itu, lalu melihat perubahan muncul live dan tercatat di riwayat."*
- **Done when, butir 3.** Lama: *"UI didesain di pen.dev (MCP pencil, dokumen baru) dan dikodekan setelah `/baseline-ui`."* Baru: *"UI dikodekan sesuai `design/lakar-ui.pen` (layar, komponen, token, state, motion) setelah `/baseline-ui`; setiap layar diperiksa terhadap frame desain yang sesuai."*
- **Done when, butir 4.** Lama: *"UI berjalan dari service `lakard` di VPS."* Baru: *"UI berjalan dari service `lakard` di VPS dan di aplikasi desktop (epic rilis desktop)."*
- **Notes:** open question "panel prompt vs model viewer" ditandai *Decision* setelah disetujui.

### 4.3 Epic baru: rilis desktop lintas OS

```toml
[[epic]]
id = 4
slug = "epic-rilis-desktop-lintas-os"
title = "Rilis desktop: Lakar sebagai aplikasi Windows, macOS, dan Linux"
description = "Tauri membungkus viewer B dan menjalankan daemon Node 26 sebagai sidecar; render memakai Chrome/Edge sistem lewat channel playwright-core; installer ketiga OS dibangun dan dirilis lewat GitHub Actions dari satu tag."
covers = ["R13", "R3"]
after = [{ epic = 3, needs = "viewer B berjalan di web dan API daemon B stabil" }]
```

Calon story (di-refine lewat `bmad-create-epics-and-stories`):
1. Daemon dijalankan sebagai sidecar Tauri dengan Node 26 yang dibundel.
2. Render memakai browser sistem: deteksi Chrome/Edge, fallback dengan pesan yang jelas, dan uji selisih render terhadap headless-shell.
3. Aplikasi menampilkan viewer B, dengan ikon tray dan daemon tetap jalan saat jendela ditutup.
4. Konfigurasi MCP untuk harness mengarah ke daemon lokal (halaman Connections).
5. Workflow rilis: matrix Windows, macOS, dan Linux; installer `.exe`/`.msi`, `.dmg`, `.AppImage`/`.deb` diunggah ke GitHub Releases saat ada tag.
6. Code signing dan notarisasi (opsional, bergantung pada akun Apple dan sertifikat Windows).
7. Kecocokan test di Windows (98 test gagal pada run lokal 2026-11-21).

### 4.4 Arsitektur (lewat `bmad-architecture`)

Keputusan baru yang perlu dicatat (AD baru atau revisi):
- Sidecar daemon di Tauri dan cara membundel Node 26.
- Render dengan browser sistem (channel `chrome`/`msedge`) vs chromium-headless-shell, serta batas toleransi selisih render terhadap PNG bench (AD-6).
- API daemon untuk viewer:
  - stream event WebSocket: tool call mulai/selesai, node target, sesi dan identitas harness;
  - seleksi sebagai konteks agen;
  - riwayat dan Restore (dasar AD-4 `baseRev` dan riwayat transaksi G0);
  - operasi file;
  - health check.
- Kebijakan pembekuan: tool MCP v1 tidak berubah selama putaran bench; penambahan tool (mis. `get_selection`) menunggu putaran resmi G1 selesai.

### 4.5 UX (lewat `bmad-ux`)

- **Sumber kebenaran visual: `design/lakar-ui.pen`.** UI B dan aplikasi desktop dibangun sesuai desain ini: layar, tata letak, komponen, token warna, tipografi, state (waiting, offline, error, history, export), dan spesifikasi motion. `bmad-ux` tidak mendesain ulang; tugasnya menurunkan DESIGN.md dan EXPERIENCE.md dari `design/lakar-ui.pen` dan `design/README.md`.
- Perubahan visual di luar desain ini dilakukan di `design/lakar-ui.pen` lebih dulu (MCP pencil), baru kemudian di kode.
- Output: DESIGN.md (token, komponen, layar) dan EXPERIENCE.md (alur viewer, state, presence agen, motion, responsif desktop/tablet/mobile) untuk B, masing-masing dengan rujukan ke frame di `design/lakar-ui.pen`.

## 5. Handoff implementasi

**Lingkup: Major.** Model interaksi, target rilis, dan urutan epic berubah.

| Peran | Tanggung jawab |
|---|---|
| Adam (pemilik inisiatif, approver) | Menyetujui, merevisi, atau menolak proposal ini; mengisi Decision di inisiatif dan epic |
| PM (`bmad-agent-pm` / `bmad-prd`) | Menerapkan perubahan R10, R13, C4, C9, dan Done-when ke `initiative-lakar.md` setelah disetujui |
| Architect (`bmad-architecture`) | Keputusan sidecar, render browser sistem, dan API daemon viewer; kebijakan pembekuan MCP |
| UX (`bmad-ux`) | Menurunkan DESIGN.md dan EXPERIENCE.md B dari `design/lakar-ui.pen` (tanpa desain ulang) |
| PO/Dev (`bmad-create-epics-and-stories`, `bmad-sprint-planning`) | Me-refine epic B dan epic desktop menjadi story; sprint status |
| Dev (`bmad-build` / `bmad-build-auto`) | Implementasi per story; PR otomatis direview CI dan Claude (GLM 5.3) |

**Kriteria sukses:**
- Proposal disetujui Adam dan perubahan dokumen diterapkan.
- Arsitektur dan UX B disetujui sebelum koding B dimulai.
- UI B dan aplikasi desktop sesuai `design/lakar-ui.pen`: setiap layar yang diimplementasikan cocok dengan frame desainnya (tata letak, komponen, token, state).
- G1 lulus gerbangnya tanpa regresi akibat pekerjaan B (tool MCP v1 tetap sama selama putaran).
- Installer ketiga OS terbentuk dari satu tag rilis.

## Persetujuan

- [x] Fathur (pengusul) menyetujui isi proposal, 2026-11-21, dengan catatan: implementasi UI wajib mengikuti `design/lakar-ui.pen`.
- [ ] Adam menyetujui (tanggal, catatan):
- Keputusan per butir: R10 [ ], R13 [ ], C4 [ ], epic B [ ], epic desktop [ ]
