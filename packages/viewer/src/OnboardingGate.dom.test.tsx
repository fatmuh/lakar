// Gate sign-in first-run (spec-first-run-signin task D): S1 provider/email, S2 menunggu OAuth,
// S3 magic link terkirim + cooldown resend, S4 cloud tak menjawab (Try again), S5 sukses dari
// SSE `auth` (jendela mana pun), E9 penanda onboarding jendela lain menutup gate ini, Esc tidak
// menutup. Sign-in wajib: tidak ada jalur skip/offline — form email memvalidasi on-submit dan
// error menggantikan baris hint.
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthStatus, CloudUser } from './api';
import { OnboardingGate } from './OnboardingGate';
import { dom, fail, renderUi, stream } from './test/dom';

const USER: CloudUser = { id: 'u1', email: 'ana@studio.id', name: 'Ana Putri' };

const base: AuthStatus = { signedIn: false, configured: true, providers: ['google', 'github', 'email'], host: 'api.lakar.dev', onboarding: { signin: 'pending' } };

function renderGate(status: Partial<AuthStatus> = {}) {
  const onDone = vi.fn();
  const onRetry = vi.fn();
  const ui = renderUi(<OnboardingGate status={{ ...base, ...status }} onDone={onDone} onRetry={onRetry} />);
  stream.hello();
  return { ...ui, onDone, onRetry };
}

const title = () => document.querySelector('#onboarding-title')?.textContent;

describe('OnboardingGate — S1 `out`', () => {
  it('menampilkan judul, benefit, tiga metode (Google/GitHub/email), dan tanpa jalur skip/offline', () => {
    renderGate();
    expect(title()).toBe('Welcome to Lakar');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send link' })).toBeInTheDocument();
    expect(document.body.textContent).toContain('We’ll email you a sign-in link');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Continue without an account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue offline' })).not.toBeInTheDocument();
  });

  it('provider yang tidak diiklankan tidak dirender; hanya email → tanpa divider "or"', () => {
    renderGate({ providers: ['email'] });
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
    expect(screen.queryByText('or')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
  });

  it('Esc tidak menutup gate (sign-in wajib)', async () => {
    const { user, onDone } = renderGate();
    await user.keyboard('{Escape}');
    expect(onDone).not.toHaveBeenCalled();
    expect(title()).toBe('Welcome to Lakar');
  });
});

describe('OnboardingGate — event lintas jendela', () => {
  it('event auth dari jendela lain membawa onboarding (E9) → gate menutup tanpa S5', async () => {
    const { onDone } = renderGate();
    stream.event('auth', { auth: { signedIn: false, onboarding: 'completed' } });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('signedIn'));
    expect(title()).not.toBe('You’re signed in');
  });
});

describe('OnboardingGate — S2 `waiting` (OAuth)', () => {
  it('klik Google → auth/start → buka URL → S2; Cancel kembali ke S1; SSE signedIn → S5', async () => {
    const d = dom().daemon;
    d.on('POST', '/viewer/auth/start', (req) => ((req.body as { provider: string }).provider === 'email' ? { sent: true } : { url: 'https://api.lakar.dev/api/auth/google?nonce=n1' }));
    const { user, onDone } = renderGate();
    const popup = vi.spyOn(window, 'open').mockReturnValue({ location: {} } as unknown as Window);
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(title()).toBe('Finish signing in in your browser'));
    expect(document.body.textContent).toContain('a Google sign-in page');
    expect(document.body.textContent).toContain('Waiting for sign-in…');
    popup.mockRestore();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(title()).toBe('Welcome to Lakar');

    // Callback tetap datang sesudah Cancel → S5 (E14).
    stream.event('auth', { auth: { signedIn: true, user: USER } });
    await waitFor(() => expect(title()).toBe('You’re signed in'));
    const account = document.querySelector('.onboarding-account');
    expect(account?.textContent).toContain('Ana Putri');
    expect(account?.textContent).toContain('ana@studio.id');
    expect(account?.textContent).toContain('AP');
    await user.click(screen.getByRole('button', { name: 'Open Lakar' }));
    expect(onDone).toHaveBeenCalledWith('signedIn');
  });

  it('S5 tanpa klik → auto onDone signedIn sesudah jeda singkat', async () => {
    const { onDone } = renderGate();
    stream.event('auth', { auth: { signedIn: true, user: USER } });
    await waitFor(() => expect(title()).toBe('You’re signed in'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('signedIn'), { timeout: 3_000 });
  });
});

describe('OnboardingGate — S3 `sent` (magic link)', () => {
  it('submit email → auth/start → S3; resend terkunci 30 dtk; "Use a different email" → S1', async () => {
    const bodies: unknown[] = [];
    dom().daemon.on('POST', '/viewer/auth/start', (req) => {
      bodies.push(req.body);
      return { sent: true };
    });
    const { user } = renderGate();
    await user.type(screen.getByPlaceholderText('you@example.com'), 'ana@studio.id');
    await user.click(screen.getByRole('button', { name: 'Send link' }));
    await waitFor(() => expect(title()).toBe('Check your email'));
    expect(bodies).toEqual([{ provider: 'email', email: 'ana@studio.id' }]);
    expect(document.body.textContent).toContain('Open it on this computer');
    expect(document.querySelector('.onboarding-address')?.textContent).toBe('ana@studio.id');
    expect(document.body.textContent).toContain('Check your spam or promotions folder');

    const resend = screen.getByRole<HTMLButtonElement>('button', { name: /^Resend in / });
    expect(resend.disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(title()).toBe('Welcome to Lakar');
  });

  it('alamat tidak valid → error menggantikan hint, tanpa POST', async () => {
    const d = dom().daemon;
    const { user } = renderGate();
    await user.type(screen.getByPlaceholderText('you@example.com'), 'bukan-email');
    await user.click(screen.getByRole('button', { name: 'Send link' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid email address.');
    expect(d.find('POST', '/viewer/auth/start')).toHaveLength(0);
    expect(title()).toBe('Welcome to Lakar');
  });

  it('rate limit 429 (E6) → err.ratelimit menggantikan hint, tetap di S1', async () => {
    dom().daemon.on('POST', '/viewer/auth/start', () => {
      throw fail('EXPORT_FAILED', 500, 'service auth membatasi magic link (HTTP 429): slow down');
    });
    const { user } = renderGate();
    await user.type(screen.getByPlaceholderText('you@example.com'), 'ana@studio.id');
    await user.click(screen.getByRole('button', { name: 'Send link' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Too many sign-in emails. Wait a few minutes, then try again.'));
    expect(title()).toBe('Welcome to Lakar');
  });
});

describe('OnboardingGate — S4 `unreachable` / S4b `no-methods`', () => {
  it('providers hilang → pesan koneksi + Try again (onRetry); tanpa jalan keluar lain', async () => {
    const { user, onDone, onRetry } = renderGate({ providers: undefined });
    expect(title()).toBe('Welcome to Lakar');
    expect(screen.getByRole('note').textContent).toContain('Can’t reach the sign-in service');
    expect(screen.queryByRole('button', { name: 'Continue offline' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(dom().daemon.find('POST', '/viewer/onboarding')).toHaveLength(0);
  });

  it('providers [] → no-methods: tanpa tombol provider, Try again tetap tersedia', async () => {
    const { user, onDone, onRetry } = renderGate({ providers: [] });
    expect(document.body.textContent).toContain('No sign-in methods are available on this service yet.');
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
