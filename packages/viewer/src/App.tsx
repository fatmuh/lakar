// Kerangka aplikasi: title bar bertab (TitleBar.tsx), routing hash (`#/` Recents, `#/files`, `#/files/<id>` folder, `#/archive`, `#/settings`
// General, `#/settings/connections` Connections, `#/settings/updates` Updates (hanya desktop), `#/d/<slug>` Viewer; lihat `parseRoute`
// di files.ts), banner offline.
// Tab dokumen (aplikasi 7): daftar slug di localStorage (`TABS_KEY`); membuka dokumen menambah/mengaktifkan tabnya,
// Close lewat x / klik tengah / Ctrl/Cmd+W. Rename/archive/delete dari aplikasi (`api.onFileEvent`) ikut ke tab.
// Hanya Viewer tab aktif yang ter-mount; state tampilan per dokumen disimpan di viewState.ts.
// Sinkron antar jendela: App berlangganan `activityHub` (satu stream per jendela) dan menerapkan perubahan dari
// jendela lain (`remoteEffect` → `api.applyRemote`): daftar dimuat ulang, tab ikut rename. Archive/delete dokumen
// yang sedang tampil membiarkan tabnya; Viewer menampilkan pesan dan menutup tab lewat `requestCloseTab`.
// Agen di dokumen terbuka (spec-agent-open-doc): dokumen yang tampil dilaporkan ke daemon (focusSync.ts) supaya
// `open_doc` tanpa slug memakainya; dokumen baru dari agen (event `openTab` untuk jendela ini) dibuka sebagai tab.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { activityHub, openTabRequest, remoteDocCall, remoteEffect } from './activity';
import { Toast, type ToastState } from './AddLayer';
import { api, connection, type AuthStatus } from './api';
import { sessionExpired, shouldShowGate } from './cloudAuth';
import { Dashboard } from './Dashboard';
import { CONNECTIONS_HASH, docHash, parseRoute, type Route } from './files';
import { JoinRoomDialog } from './JoinRoomDialog';
import { attachFocusReporter, windowActivate } from './focusSync';
import { NewFileDialog } from './NewFileDialog';
import { OfflineBanner } from './OfflineBanner';
import { OnboardingGate, type GateDoneReason } from './OnboardingGate';
import { applyFileEvent, closeTab, onOpenInNewTab, onRequestCloseTab, openTab, pruneTabs, readTabs, serializeTabs, TABS_KEY } from './tabs';
import { TitleBar } from './TitleBar';
import { initUpdates } from './updates';
import { dropViewState, moveViewState } from './viewState';
import { Viewer } from './Viewer';
import { PresentView } from './PresentView';

export { CONNECTIONS_HASH } from './files';

export const openDoc = (slug: string) => {
  location.hash = docHash(slug);
};
export const openDashboard = () => {
  location.hash = '#/';
};

function loadTabs(): string[] {
  try {
    return readTabs(localStorage.getItem(TABS_KEY));
  } catch {
    return [];
  }
}

/** Ganti hash tanpa entri history baru; `hashchange` tidak dipicu, jadi route diperbarui pemanggil. */
function replaceHash(hash: string) {
  history.replaceState(history.state, '', hash);
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const [tabs, setTabs] = useState<string[]>(() => (route.name === 'viewer' ? openTab(loadTabs(), route.slug) : loadTabs()));
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState<ReadonlySet<string> | undefined>(undefined);
  const [toast, setToast] = useState<ToastState | undefined>(undefined);
  const offline = useSyncExternalStore(connection.subscribe, connection.isOffline);
  // ---- Gate sign-in first-run (spec-first-run-signin): keputusan sekali per pemuatan halaman. ----
  /** Route saat boot — deep link (`viewer`/`present`/`join`) menekan gate untuk pemuatan ini. */
  const bootRoute = useRef<Route['name'] | undefined>(undefined);
  if (bootRoute.current === undefined) bootRoute.current = route.name;
  const [authStatus, setAuthStatus] = useState<AuthStatus | undefined>(undefined);
  const [gateDone, setGateDone] = useState<GateDoneReason | undefined>(undefined);
  /** Sign-out eksplisit (event `auth` signedIn:false tanpa reason 'expired') — gate dipaksa tampil meski
   * `onboarding.signin` sudah 'completed' permanen (spec: signout kembali ke onboarding, bukan tetap di app). */
  const [signedOut, setSignedOut] = useState(false);
  const loadAuth = useCallback(() => {
    api.authStatus().then(
      (s) => {
        sessionExpired.noteStatus(s);
        setAuthStatus(s);
      },
      () => {},
    );
  }, []);
  useEffect(loadAuth, [loadAuth]);
  // Gate tertutup hanya lewat sign-in (`gateDone` diset OnboardingGate) — tanpa jalur skip/offline.
  const gate = gateDone === undefined && (shouldShowGate(authStatus, bootRoute.current, false) || signedOut);
  const gateRef = useRef(gate);
  gateRef.current = gate;
  // Route `present` melaporkan slug-nya juga: fokus agen (`open_doc` tanpa slug) tetap menunjuk dokumen yang dipresentasikan.
  const active = route.name === 'viewer' || route.name === 'present' ? route.slug : undefined;
  // Ref untuk pendengar event (tanpa daftar ulang tiap render).
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(location.hash));
      setMenuOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Membuka dokumen (kartu, Open, hash) → tab aktif bila sudah ada, kalau belum ditambah di akhir.
  useEffect(() => {
    if (route.name === 'viewer') setTabs((t) => openTab(t, route.slug));
  }, [route]);

  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, serializeTabs(tabs));
    } catch {
      // penyimpanan tidak tersedia: tab hanya untuk sesi ini
    }
  }, [tabs]);

  // Saat mulai: buang tab yang dokumennya sudah tidak ada (dokumen yang sedang tampil tetap, Viewer menampilkan error-nya).
  useEffect(() => {
    api.listDocs().then(
      (docs) => setTabs((t) => pruneTabs(t, new Set(docs.map((d) => d.slug)), activeRef.current)),
      () => {},
    );
  }, []);

  // Updater aplikasi desktop: sekali per mount (cek + unduh latar bila kebijakan auto). No-op di browser.
  useEffect(() => initUpdates(), []);

  // `#/join?server=…&token=…`: token room adalah capability — sesudah route terbaca (prefill dialog),
  // bersihkan query dari entri history supaya token tidak tersimpan di riwayat navigasi.
  useEffect(() => {
    if (route.name === 'join' && (route.server !== undefined || route.token !== undefined)) replaceHash('#/join');
  }, [route]);

  useEffect(() => {
    const titles: Record<Route['name'], string> = { recents: 'Lakar', files: 'Files · Lakar', archive: 'Archive · Lakar', settings: 'Settings · Lakar', connections: 'Connections · Lakar', updates: 'Updates · Lakar', join: 'Join room · Lakar', viewer: 'Lakar', present: 'Lakar' };
    // Halaman folder (`#/files/<id>`): Dashboard mengganti judul dengan nama folder setelah folder dimuat.
    document.title = route.name === 'viewer' || route.name === 'present' ? `${route.slug} · Lakar` : titles[route.name];
  }, [route]);

  /** Terapkan daftar tab baru; `navigate` → tampilkan `next` (Dashboard bila undefined) tanpa entri history baru. */
  const apply = useCallback((next: string[], navigate: boolean, slug: string | undefined) => {
    tabsRef.current = next;
    setTabs(next);
    if (navigate) {
      const hash = slug !== undefined ? docHash(slug) : '#/';
      replaceHash(hash);
      setRoute(parseRoute(hash));
    }
  }, []);

  const close = useCallback(
    (slug: string) => {
      const r = closeTab(tabsRef.current, slug, activeRef.current);
      dropViewState(slug);
      // Tab tetangga atau Dashboard menggantikan entri history tab yang ditutup.
      apply(r.tabs, activeRef.current === slug, r.next);
    },
    [apply],
  );

  useEffect(() => onOpenInNewTab((slug) => setTabs((t) => openTab(t, slug))), []);

  // Pesan "diarsip/dihapus di jendela lain" di Viewer: tutup tabnya lalu buka Dashboard/Archive.
  useEffect(
    () =>
      onRequestCloseTab((slug, hash) => {
        const r = closeTab(tabsRef.current, slug, activeRef.current);
        dropViewState(slug);
        apply(r.tabs, false, undefined);
        location.hash = hash;
      }),
    [apply],
  );

  /** Toast "session expired" sekali per pemuatan (E4 — dedupe; event bisa berulang antar jalur). */
  const expiredToastShown = useRef(false);

  // Perubahan dari jendela/tab viewer lain (stream): gema jendela ini diabaikan di `remoteEffect`.
  useEffect(
    () =>
      activityHub.listen({
        onEvent: (e) => {
          if (e.type === 'change') {
            const effect = remoteEffect(e.change, api.origin);
            if (effect) api.applyRemote(effect);
          } else if (e.type === 'openTab') {
            // Agen membuat dokumen baru: tampilkan di jendela ini (route menambah tabnya).
            const slug = openTabRequest(e, api.origin);
            if (slug !== undefined) location.hash = docHash(slug);
          } else if (e.type === 'auth') {
            // Status sign-in berubah di luar jendela ini (callback OAuth, skip jendela lain,
            // session dicabut service) — muat ulang; `reason:'expired'` → toast + chip (E4).
            if (e.auth.reason === 'expired') {
              sessionExpired.markExpired();
              if (!expiredToastShown.current) {
                expiredToastShown.current = true;
                setToast({
                  message: 'Your Lakar Cloud session expired.',
                  kind: 'info',
                  action: { label: 'Sign in', run: () => (location.hash = CONNECTIONS_HASH) },
                });
              }
            }
            if (e.auth.signedIn) sessionExpired.clear();
            // Sign-out eksplisit (reason lain: 'expired' tetap toast saja, E4) → buka gate onboarding lagi.
            if (e.auth.signedIn === false && e.auth.reason !== 'expired') {
              setGateDone(undefined);
              setSignedOut(true);
            }
            loadAuth();
          } else if (remoteDocCall(e, api.origin)) api.notifyDocsChanged();
        },
        // Event selama putus tidak diputar ulang: muat ulang daftar.
        onReconnect: () => api.notifyDocsChanged(),
      }),
    [loadAuth],
  );

  // Dokumen yang tampil di jendela ini → daemon (`open_doc` tanpa slug). Dashboard = null.
  const focusReporter = useRef<ReturnType<typeof attachFocusReporter> | undefined>(undefined);
  useEffect(() => {
    const r = attachFocusReporter(activeRef.current ?? null, (slug, opts) => api.putFocus(slug, opts), (l) => activityHub.listen(l), windowActivate);
    focusReporter.current = r;
    // Jendela ditutup/dipindah ke bfcache: lepas dokumennya; kembali dari bfcache → laporkan lagi.
    const onHide = () => r.hide();
    const onShow = (e: PageTransitionEvent) => e.persisted && r.update(activeRef.current ?? null);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
      r.dispose();
      if (focusReporter.current === r) focusReporter.current = undefined;
    };
  }, []);
  useEffect(() => {
    focusReporter.current?.update(active ?? null);
  }, [active]);

  // Rename/archive/delete dari aplikasi, jendela ini atau jendela lain (keputusan di `applyFileEvent`). Perubahan oleh agen lewat MCP sengaja tidak disinkronkan.
  useEffect(
    () =>
      api.onFileEvent((e) => {
        const r = applyFileEvent(tabsRef.current, activeRef.current, e);
        if (r.view.type === 'move') moveViewState(r.view.from, r.view.to);
        else if (r.view.type === 'drop') dropViewState(r.view.slug);
        apply(r.tabs, r.navigate, r.next);
      }),
    [apply],
  );

  // Ctrl/Cmd+W menutup tab dokumen aktif. Abaikan auto-repeat, kolom ketik, dan dialog/menu terbuka.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'w') return;
      const slug = activeRef.current;
      const t = e.target;
      const editable = t instanceof HTMLElement && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable);
      if (slug === undefined || e.repeat || editable || gateRef.current || document.querySelector('.modal-scrim, .menu-layer')) return;
      e.preventDefault();
      close(slug);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // "+": dialog New file. Slug terpakai (aktif + arsip) dimuat sekali; gagal → pratinjau mengandalkan server.
  const startNew = () => {
    setCreating(new Set());
    Promise.all([api.listDocs(), api.listArchive()]).then(
      ([docs, archive]) => setCreating((c) => (c ? new Set([...docs, ...archive].map((d) => d.slug)) : c)),
      () => {},
    );
  };

  // Mode Present (spec-prototype-mode): layar penuh tanpa chrome aplikasi; Esc/✕ kembali ke dokumen.
  if (route.name === 'present') return <PresentView slug={route.slug} flowId={route.flow} onExit={() => (location.hash = docHash(route.slug))} />;

  return (
    <div className="app">
      <TitleBar tabs={tabs} active={active} onMenu={() => setMenuOpen((v) => !v)} onClose={close} onNew={startNew} minimal={gate} />
      {offline && <OfflineBanner />}
      {gate && authStatus ? (
        <OnboardingGate status={authStatus} onDone={setGateDone} onRetry={loadAuth} />
      ) : (
        <main className="body">
          {route.name === 'viewer' ? (
            <Viewer key={route.slug} slug={route.slug} />
          ) : (
            <Dashboard
              page={route.name === 'join' ? 'recents' : route.name}
              {...(route.name === 'files' && route.folder ? { folder: route.folder } : {})}
              menuOpen={menuOpen}
              onCloseMenu={() => setMenuOpen(false)}
              onOpenMenu={() => setMenuOpen((v) => !v)}
            />
          )}
        </main>
      )}
      {!gate && route.name === 'join' && <JoinRoomDialog initialServer={route.server} initialToken={route.token} onClose={() => (location.hash = '#/')} />}
      {!gate && creating && <NewFileDialog taken={creating} onClose={() => setCreating(undefined)} />}
      {toast && <Toast toast={toast} onClose={() => setToast(undefined)} />}
    </div>
  );
}
