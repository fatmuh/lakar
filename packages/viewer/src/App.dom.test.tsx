// Kerangka App (spec-agent-open-doc): event stream `openTab` membuka dokumen baru di jendela ini (location.hash), dan
// reporter fokus melaporkan dokumen yang tampil lewat PUT /viewer/focus (mount, pindah dokumen, reconnect stream).
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { api } from './api';
import { App } from './App';
import { docHash } from './files';
import { dom, FakeEventSource, renderUi, stream } from './test/dom';
import { makeDoc } from './test/fixtures';

/** Daemon tiruan minimum untuk App + Dashboard + Viewer. */
function daemon() {
  const d = dom().daemon;
  d.on('GET', '/viewer/docs', () => ({ docs: [] }));
  d.on('GET', '/viewer/archive', () => ({ docs: [] }));
  d.on('GET', '/viewer/folders', () => ({ folders: [], membership: {} }));
  d.on('GET', /^\/viewer\/docs\/([^/]+)$/, (_req, m) => ({ doc: { ...makeDoc(1), id: `Doc-${m[1]}` } }));
  d.on('PUT', '/viewer/focus', (req) => ({ slug: (req.body as { slug: string | null }).slug, focused: null }));
  return d;
}
const focusBodies = () => dom().daemon.find('PUT', '/viewer/focus').map((r) => (r.body as { slug: string | null }).slug);

describe('App — openTab dari agen', () => {
  it('openTab untuk jendela ini (atau tanpa origin) membuka dokumen sebagai tab aktif', async () => {
    daemon();
    location.hash = '#/';
    renderUi(<App />);
    stream.hello();
    stream.event('openTab', { openTab: { slug: 'landing-baru' } });
    expect(location.hash).toBe(docHash('landing-baru'));
    await waitFor(() => expect(document.title).toBe('landing-baru · Lakar'));

    stream.event('openTab', { openTab: { slug: 'kedua', origin: api.origin } });
    expect(location.hash).toBe(docHash('kedua'));
  });

  it('openTab untuk jendela lain diabaikan', () => {
    daemon();
    location.hash = '#/';
    renderUi(<App />);
    stream.hello();
    stream.event('openTab', { openTab: { slug: 'bukan-untukku', origin: 'jendela-lain' } });
    expect(location.hash).toBe('#/');
  });

  it('stream membawa origin jendela (?origin=) supaya openTab hanya menuju jendela yang hidup', () => {
    daemon();
    renderUi(<App />);
    expect(stream.current().url).toBe(`/viewer/events?origin=${encodeURIComponent(api.origin)}`);
  });
});

// ---- Gate sign-in first-run (spec-first-run-signin task D): tampil hanya saat daemon bilang
// `onboarding.signin === 'pending'` + boot ke Dashboard; selain itu fail-open (tanpa gate). ----

const AUTH_PENDING = { signedIn: false, configured: true, providers: ['google', 'github', 'email'], host: 'api.lakar.dev', onboarding: { signin: 'pending' } };
/** Daemon + auth status; `status` `undefined` = route tidak terdaftar (daemon lama / request gagal). */
function daemonAuth(status: Record<string, unknown> | undefined) {
  const d = daemon();
  if (status !== undefined) d.on('GET', '/viewer/auth/status', () => status);
  return d;
}

describe('App — gate first-run sign-in', () => {
  it('pending + boot ke Dashboard → gate tampil; TitleBar minimal (tanpa tab/menu)', async () => {
    daemonAuth(AUTH_PENDING);
    location.hash = '#/';
    renderUi(<App />);
    await waitFor(() => expect(document.querySelector('#onboarding-title')?.textContent).toBe('Welcome to Lakar'));
    expect(document.querySelector('.titlebar')).not.toBeNull();
    expect(document.querySelector('.titlebar .tabs')).toBeNull();
    expect(document.querySelector('.titlebar-menu')).toBeNull();
    expect(document.querySelector('main.body')).toBeNull();
  });

  it('field onboarding hilang (daemon lama), non-pending, configured:false, signed in → tanpa gate', async () => {
    const { onboarding, ...tanpaField } = AUTH_PENDING;
    // Route terakhir menang di FakeDaemon — daftar ulang auth/status per iterasi cukup.
    for (const status of [undefined, tanpaField, { ...AUTH_PENDING, onboarding: { signin: 'completed' } }, { ...AUTH_PENDING, onboarding: { signin: 'disabled' } }, { ...AUTH_PENDING, configured: false }, { ...AUTH_PENDING, signedIn: true }]) {
      daemonAuth(status as Record<string, unknown> | undefined);
      location.hash = '#/';
      const { unmount } = renderUi(<App />);
      await waitFor(() => expect(document.querySelector('main.body')).not.toBeNull());
      expect(document.querySelector('.onboarding')).toBeNull();
      unmount();
    }
  });

  it('boot ke deep link dokumen → gate tidak tampil (E11), dokumen langsung terbuka', async () => {
    daemonAuth(AUTH_PENDING);
    location.hash = docHash('demo');
    renderUi(<App />);
    await waitFor(() => expect(document.querySelector('main.body')).not.toBeNull());
    expect(document.querySelector('.onboarding')).toBeNull();
  });

  it('tanpa jalur skip: tidak ada tombol "Continue without an account" / "Continue offline"', async () => {
    daemonAuth(AUTH_PENDING);
    location.hash = '#/';
    renderUi(<App />);
    await waitFor(() => expect(document.querySelector('.onboarding')).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'Continue without an account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue offline' })).not.toBeInTheDocument();
  });

  it('sign-in selesai (SSE auth) → S5 → gate hilang, Dashboard tampil', async () => {
    daemonAuth(AUTH_PENDING);
    location.hash = '#/';
    const { user } = renderUi(<App />);
    await waitFor(() => expect(document.querySelector('.onboarding')).not.toBeNull());
    stream.event('auth', { auth: { signedIn: true, user: { id: 'u1', email: 'ana@studio.id' } } });
    await user.click(await screen.findByRole('button', { name: 'Open Lakar' }));
    await waitFor(() => expect(document.querySelector('main.body')).not.toBeNull());
    expect(document.querySelector('.onboarding')).toBeNull();
  });
});

describe('App — sign-out kembali ke gate (spec-signout-gate)', () => {
  it('event auth signedIn:false (sign-out eksplisit) → gate onboarding tampil lagi; reason:expired tetap toast', async () => {
    daemonAuth({ signedIn: true, configured: true, user: { id: 'u1', email: 'ana@studio.id' }, onboarding: { signin: 'completed' } });
    location.hash = '#/';
    renderUi(<App />);
    stream.hello();
    await waitFor(() => expect(document.querySelector('main.body')).not.toBeNull());
    // Sign-out eksplisit → gate onboarding tampil walau onboarding.signin 'completed'.
    daemonAuth({ signedIn: false, configured: true, providers: ['google', 'github', 'email'], onboarding: { signin: 'completed' } });
    stream.event('auth', { auth: { signedIn: false } });
    await waitFor(() => expect(document.querySelector('.onboarding')).not.toBeNull());
    // Status terbaru (signed out) sampai ke gate.
    await screen.findByRole('button', { name: 'Continue with Google' });
  });
});

describe('App — session expired (E4)', () => {
  it('event auth reason:expired → satu toast dengan aksi Sign in; event berulang tidak menduplikasi', async () => {
    daemonAuth({ signedIn: true, configured: true, user: { id: 'u1', email: 'ana@studio.id' } });
    location.hash = '#/';
    renderUi(<App />);
    stream.hello();
    stream.event('auth', { auth: { signedIn: false, reason: 'expired' } });
    stream.event('auth', { auth: { signedIn: false, reason: 'expired' } });
    await waitFor(() => expect(document.querySelectorAll('.toast')).toHaveLength(1));
    expect(document.querySelector('.toast')?.textContent).toContain('session expired');
    await screen.findByRole('button', { name: 'Sign in' });
    // Gate tidak tampil — onboarding tidak pending di skenario ini.
    expect(document.querySelector('.onboarding')).toBeNull();
  });
});

describe('App — reporter fokus (PUT /viewer/focus)', () => {
  it('melapor null di Dashboard, slug saat dokumen dibuka, dan ulang sesudah stream tersambung lagi', async () => {
    daemon();
    location.hash = '#/';
    renderUi(<App />);
    await waitFor(() => expect(focusBodies()).toEqual([null]));
    stream.hello();

    location.hash = docHash('demo');
    await waitFor(() => expect(focusBodies()).toEqual([null, 'demo']));
    // Semua laporan membawa id jendela (daemon menyimpan fokus per origin).
    expect(dom().daemon.find('PUT', '/viewer/focus').every((r) => r.headers['x-lakar-origin'] === api.origin)).toBe(true);

    // Stream putus → hub menyambung ulang sesudah backoff 1 dtk; hello kedua = reconnect → lapor ulang.
    const first = stream.current();
    stream.drop();
    await waitFor(() => expect(FakeEventSource.instances.filter((s) => !s.closed && s !== first)).toHaveLength(1), { timeout: 2_500 });
    stream.hello();
    await waitFor(() => expect(focusBodies()).toEqual([null, 'demo', 'demo']));
  });

  it('jendela aktif lagi (focus) → lapor ulang dokumen yang tampil', async () => {
    daemon();
    location.hash = docHash('demo');
    renderUi(<App />);
    await waitFor(() => expect(focusBodies()).toEqual(['demo']));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(focusBodies()).toEqual(['demo', 'demo']));
  });
});
