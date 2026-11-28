// Gate sign-in first-run (spec-first-run-signin task D): layar penuh pengganti <main> Dashboard
// selama `shouldShowGate` benar. S1 `out` (provider/email) → S2 `waiting` (OAuth di browser) →
// S3 `sent` (magic link terkirim, resend dikunci 30 dtk) → S5 `success` (auto-lanjut 1,5 dtk);
// S4 `unreachable` (service tak menjawab: Try again) dan S4b `no-methods`. Sign-in wajib: tidak
// ada jalur skip/offline — penanda `skipped` lama di daemon tetap dihormati (back-compat), tapi
// UI tak lagi menawarkannya. Gate adalah halaman, bukan dialog: tanpa Esc/klik-luar dan tanpa
// autofocus di S1; perpindahan state memindahkan fokus ke judul baru. SSE `auth` ditangani di
// sini: `signedIn:true` → S5 + fokus jendela desktop (E8); `onboarding` ≠ pending dari jendela
// lain → tutup (E9).
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { activityHub } from './activity';
import { type AuthStatus, type CloudUser } from './api';
import { GATE_ERRORS, gateErrorText, initialsOf } from './cloudAuth';
import { focusWindow } from './desktop';
import { useNow } from './hooks';
import { BrandIcon, Icon, LakarMark } from './icons';
import { useCloudSignIn } from './useCloudSignIn';

/** Gate hanya tertutup oleh sign-in — tanpa jalur skip/offline. */
export type GateDoneReason = 'signedIn';

/** Tampilan gate = gabungan fase hook sign-in + kondisi `status.providers` + sukses (S5). */
type GateView = 'out' | 'waiting' | 'sent' | 'unreachable' | 'no-methods' | 'success';

const EMAIL_OK = /^\S+@\S+\.\S+$/;
/** Kunci resend magic link di klien — melengkapi rate limit service 5/15 menit (E6). */
const RESEND_COOLDOWN_MS = 30_000;
/** S5 tampil singkat lalu otomatis masuk workspace. */
const SUCCESS_DELAY_MS = 1500;

const OAUTH: readonly ('google' | 'github')[] = ['google', 'github'];

export function OnboardingGate({
  status,
  onDone,
  onRetry,
}: {
  status: AuthStatus;
  onDone: (reason: GateDoneReason) => void;
  /** Muat ulang `authStatus` (Try again di S4 — cache providers daemon hanya menyimpan sukses). */
  onRetry: () => void;
}): ReactElement {
  const signin = useCloudSignIn({ formatError: gateErrorText });
  const [email, setEmail] = useState('');
  /** Error validasi alamat email lokal — ditampilkan di baris hint form. */
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [successUser, setSuccessUser] = useState<CloudUser | undefined>(undefined);
  /** Waktu kirim/resend magic link terakhir — dasar hitung mundur `Resend in m:ss`. */
  const [lastSentAt, setLastSentAt] = useState(0);
  const now = useNow(successUser === undefined && signin.phase === 'sent' ? 1000 : 60_000);

  const providers = status.providers;
  const offered = (p: 'google' | 'github' | 'email') => providers?.includes(p) ?? false;
  const oauth = OAUTH.filter(offered);
  /** Error form email: validasi lokal lebih dulu, lalu error sign-in (OAuth/gagal kirim). */
  const formError = emailError ?? signin.error;
  const view: GateView =
    successUser !== undefined ? 'success' : providers === undefined ? 'unreachable' : providers.length === 0 ? 'no-methods' : signin.phase;

  // Perpindahan state → fokus ke judul baru (pembaca layar mengumumkannya). Mount awal tidak
  // memindahkan fokus: halaman terbaca dari atas secara alami (spec: autofocus tidak ada).
  const titleRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) titleRef.current?.focus();
    else mounted.current = true;
  }, [view]);

  // SSE `auth`: sign-in selesai di jendela/tab mana pun → S5; penanda berubah di jendela lain → tutup.
  useEffect(
    () =>
      activityHub.listen({
        onEvent: (e) => {
          if (e.type !== 'auth') return;
          if (e.auth.signedIn) {
            setSuccessUser(e.auth.user ?? { id: '', email: '' });
            void focusWindow();
          } else if (e.auth.onboarding !== undefined) {
            onDone('signedIn');
          }
        },
      }),
    [onDone],
  );

  // S5: auto-lanjut ke workspace sesudah jeda singkat (atau langsung lewat "Open Lakar").
  useEffect(() => {
    if (successUser === undefined) return;
    const t = setTimeout(() => onDone('signedIn'), SUCCESS_DELAY_MS);
    return () => clearTimeout(t);
  }, [successUser, onDone]);

  const resendIn = Math.max(0, RESEND_COOLDOWN_MS - (now - lastSentAt));

  const send = async (to: string) => {
    setLastSentAt(Date.now());
    await signin.sendLink(to);
  };

  const title = (text: string) => (
    <h1 id="onboarding-title" ref={titleRef} tabIndex={-1} className="onboarding-title">
      {text}
    </h1>
  );
  let body: ReactElement;
  /** Isi kaki panel kanan: daftar benefit (S1) atau satu caption per state. */
  let pane: ReactElement | string;
  if (view === 'unreachable' || view === 'no-methods') {
    const unreachable = view === 'unreachable';
    body = (
      <>
        <div className="onboarding-heading">
          {title('Welcome to Lakar')}
          <p className="onboarding-tagline">The design canvas your coding agents drive.</p>
        </div>
        <div className="onboarding-stack">
          <div className="onboarding-note" role="note">
            <Icon name="alert" size={16} className="onboarding-note-icon" />
            <div className="onboarding-note-copy">
              <p className="onboarding-note-title">{unreachable ? 'Can’t reach the sign-in service' : 'Sign-in isn’t available yet'}</p>
              <p className="onboarding-note-text">
                {unreachable
                  ? 'Check your connection, then try again. Sign-in is needed once to set up this install.'
                  : 'No sign-in methods are available on this service yet.'}
              </p>
            </div>
          </div>
          <button type="button" className="btn primary onboarding-btn" onClick={onRetry}>
            <Icon name="refresh" size={15} />
            Try again
          </button>
        </div>
      </>
    );
    pane = 'Sign-in is required on first run. Once you’re in, your files work offline.';
  } else if (view === 'waiting') {
    const provider = signin.waitingProvider === 'github' ? 'GitHub' : 'Google';
    body = (
      <>
        <div className="onboarding-heading">
          {title('Finish signing in in your browser')}
          <p className="onboarding-tagline">We opened a {provider} sign-in page in your default browser. Come back here when you’re done.</p>
        </div>
        <p className="onboarding-status" aria-live="polite">
          <Icon name="loaderCircle" size={16} className="spin" />
          Waiting for sign-in…
        </p>
        <div className="onboarding-stack onboarding-stack-tight">
          <button type="button" className="btn onboarding-btn" onClick={() => void signin.reopen()}>
            <Icon name="externalLink" size={15} />
            Open browser again
          </button>
          <button type="button" className="btn onboarding-btn ghost" onClick={signin.cancel}>
            Cancel
          </button>
        </div>
      </>
    );
    pane = 'Leave this window open — Lakar picks up the session as soon as the browser hands it back.';
  } else if (view === 'sent') {
    body = (
      <>
        <div className="onboarding-heading onboarding-heading-badge">
          <span className="onboarding-badge" aria-hidden="true">
            <Icon name="mailCheck" size={20} />
          </span>
          {title('Check your email')}
          <div className="onboarding-sent-body">
            <p className="onboarding-tagline">We sent a sign-in link to</p>
            <strong className="onboarding-address">{signin.sentTo}</strong>
            <p className="onboarding-tagline">Open it on this computer — the link signs in this copy of Lakar and expires in 15 minutes.</p>
          </div>
        </div>
        <div className="onboarding-stack onboarding-stack-tight">
          <button type="button" className="btn onboarding-btn" disabled={resendIn > 0} onClick={() => void send(signin.sentTo)}>
            <Icon name="refresh" size={15} />
            {resendIn > 0 ? `Resend in ${Math.floor(resendIn / 60_000)}:${String(Math.ceil((resendIn % 60_000) / 1000)).padStart(2, '0')}` : 'Resend'}
          </button>
          <button
            type="button"
            className="btn onboarding-btn ghost"
            onClick={() => {
              setEmail(signin.sentTo);
              setEmailError(undefined);
              signin.cancel();
            }}
          >
            Use a different email
          </button>
        </div>
        <p className="onboarding-hint">Not there? Check your spam or promotions folder.</p>
      </>
    );
    pane = 'One link, one device. Nothing to remember, nothing stored but the session.';
  } else if (view === 'success') {
    const u = successUser!;
    const name = u.name?.trim();
    body = (
      <>
        <div className="onboarding-heading onboarding-heading-badge">
          <span className="onboarding-badge success" aria-hidden="true">
            <Icon name="circleCheck" size={20} />
          </span>
          {title('You’re signed in')}
          {(name || u.email) && (
            <div className="onboarding-account">
              <span className="onboarding-avatar" aria-hidden="true">
                {initialsOf(u)}
              </span>
              <span className="onboarding-identity">
                <span className="onboarding-identity-name">{name || u.email}</span>
                {name && <span className="onboarding-identity-email">{u.email}</span>}
              </span>
            </div>
          )}
        </div>
        <button type="button" className="btn primary onboarding-btn" data-autofocus onClick={() => onDone('signedIn')}>
          Open Lakar
          <Icon name="arrowRight" size={15} />
        </button>
      </>
    );
    pane = 'Your workspace is ready. Files stay local; the cloud only carries sharing and rooms.';
  } else {
    // S1 `out`: provider + email (semua metode setara visual); benefit pindah ke panel kanan.
    body = (
      <>
        <div className="onboarding-heading">
          {title('Welcome to Lakar')}
          <p className="onboarding-tagline">The design canvas your coding agents drive. Sign in once to get started.</p>
        </div>
        <div className="onboarding-providers">
          {oauth.map((p) => (
            <button key={p} type="button" className="btn onboarding-btn" disabled={signin.busy !== undefined} onClick={() => void signin.start(p)}>
              <BrandIcon name={p} size={16} />
              {signin.busy === p ? 'Opening…' : p === 'google' ? 'Continue with Google' : 'Continue with GitHub'}
            </button>
          ))}
          {offered('email') && oauth.length > 0 && (
            <div className="onboarding-divider" role="separator">
              <span>or</span>
            </div>
          )}
          {offered('email') && (
            <form
              className="onboarding-email"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                const value = email.trim();
                if (!EMAIL_OK.test(value)) {
                  setEmailError(GATE_ERRORS.email);
                  return;
                }
                setEmailError(undefined);
                void send(value);
              }}
            >
              <div className="onboarding-email-field">
                <label className="onboarding-email-input">
                  <Icon name="mail" size={15} />
                  <input
                    type="email"
                    aria-label="Email address"
                    aria-describedby="onboarding-email-hint"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setEmailError(undefined);
                    }}
                  />
                </label>
                <button type="submit" className="btn primary onboarding-email-send" disabled={signin.busy !== undefined}>
                  {signin.busy === 'email' ? 'Sending…' : 'Send link'}
                  {signin.busy !== 'email' && <Icon name="arrowRight" size={14} />}
                </button>
              </div>
              <p id="onboarding-email-hint" className={formError ? 'onboarding-hint danger' : 'onboarding-hint'} role={formError ? 'alert' : undefined}>
                {formError ?? 'We’ll email you a sign-in link — no password needed.'}
              </p>
            </form>
          )}
        </div>
      </>
    );
    pane = (
      <ul className="onboarding-benefits">
        <li>
          <span className="onboarding-benefit-icon" aria-hidden="true">
            <Icon name="link" size={14} />
          </span>
          Share snapshots by link — viewers never need an account.
        </li>
        <li>
          <span className="onboarding-benefit-icon" aria-hidden="true">
            <Icon name="radio" size={14} />
          </span>
          Review designs live with others in rooms.
        </li>
        <li>
          <span className="onboarding-benefit-icon" aria-hidden="true">
            <Icon name="shieldCheck" size={14} />
          </span>
          Your files stay on this device.
        </li>
      </ul>
    );
  }

  return (
    <main className="onboarding" aria-labelledby="onboarding-title">
      <div className="onboarding-panel">
        <div className="onboarding-column">
          <div className="onboarding-brand">
            <span className="onboarding-logo" aria-hidden="true">
              <LakarMark size={16} />
            </span>
            <span className="onboarding-wordmark">Lakar</span>
          </div>
          <div className="onboarding-content">{body}</div>
        </div>
        <div className="onboarding-pane">
          {/* Vinyet kanvas dekoratif: frame terpilih + kursor agen (bukan konten). */}
          <div className="onboarding-vignette" aria-hidden="true">
            <div className="onboarding-vignette-art">
              <div className="onboarding-mock">
                <span className="onboarding-mock-bar" />
                <span className="onboarding-mock-hero" />
                <span className="onboarding-mock-line" />
                <span className="onboarding-mock-line short" />
              </div>
              <div className="onboarding-mock-back" />
              <div className="onboarding-selection">
                <span />
                <span />
                <span />
                <span />
              </div>
              <Icon name="pointer" size={16} className="onboarding-cursor" />
              <span className="onboarding-agent-tag">agent</span>
            </div>
          </div>
          {typeof pane === 'string' ? <p className="onboarding-caption">{pane}</p> : pane}
        </div>
      </div>
    </main>
  );
}
