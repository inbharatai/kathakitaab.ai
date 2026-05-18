'use client';

// ============================================================
// /signin — magic link + password sign-in / sign-up / forgot
//
// Paths:
//   - Magic link: enter email → Supabase sends a sign-in link → user
//     clicks → /auth/callback completes the session.
//   - Password sign-in: existing account, email + password → Supabase
//     signs in directly. Session persisted via @supabase/ssr cookies.
//   - Create account: new user, email + password → Supabase creates
//     account. If auto-confirm is enabled, session is immediate.
//   - Forgot password: email → Supabase sends reset link.
//
// Google login is hidden (not tested end-to-end) but the handler is
// preserved for future re-enable.
//
// All honour ?next= so a user trying to generate gets bounced back
// to the library after sign-in.
//
// Surfaces /signin?error=<message> via a banner when the callback
// route redirects here with a problem.
// ============================================================

import { useState, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { createBrowserAuthClient, getPublicSiteOrigin } from '@/lib/auth/supabaseAuthClient';

function SignInForm() {
  const params = useSearchParams();
  const router = useRouter();
  const next = params.get('next') || '/books';
  const errorParam = params.get('error');
  const client = useMemo(() => createBrowserAuthClient(), []);
  const siteOrigin = useMemo(() => getPublicSiteOrigin(), []);

  const [mode, setMode] = useState<'magic' | 'password'>('magic');
  const [passwordSubMode, setPasswordSubMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [submitError, setSubmitError] = useState('');
  const urlError = errorParam ? decodeURIComponent(errorParam) : '';
  const errorMsg = submitError || urlError;
  const setErrorMsg = setSubmitError;

  if (!client) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <h1 className="font-serif" style={{ color: 'var(--color-gold-light)', marginBottom: 12 }}>
            Auth isn&apos;t set up yet
          </h1>
          <p style={{ color: 'var(--color-text-dim)', lineHeight: 1.6 }}>
            Supabase auth env vars (<code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>)
            aren&apos;t configured. The library still reads anonymously — only generation needs sign-in.
          </p>
          <Link href="/books" className="lp-btn-outline" style={{ display: 'inline-block', marginTop: 18, textDecoration: 'none' }}>
            Back to the library
          </Link>
        </div>
      </main>
    );
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !accepted || !client) return;
    setStatus('sending');
    setErrorMsg('');
    const emailRedirectTo = new URL('/auth/callback', siteOrigin);
    emailRedirectTo.searchParams.set('next', next);
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: emailRedirectTo.toString(),
        shouldCreateUser: true,
      },
    });
    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
      return;
    }
    setStatus('sent');
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || !accepted || !client) return;
    setStatus('sending');
    setErrorMsg('');
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
      return;
    }
    if (data.session) {
      router.push(next);
    }
  }

  async function signUpWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || !accepted || !client) return;
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setStatus('sending');
    setErrorMsg('');
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${siteOrigin}/auth/callback?next=${next}`,
      },
    });
    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
      return;
    }
    if (data.session) {
      // Auto-confirmed — session is ready immediately.
      router.push(next);
    } else {
      // Needs email confirmation.
      setStatus('sent');
    }
  }

  async function sendPasswordReset(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !client) return;
    setStatus('sending');
    setErrorMsg('');
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteOrigin}/auth/callback?next=${next}`,
    });
    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
      return;
    }
    setStatus('sent');
  }

  async function signInWithGoogle() {
    if (!accepted || !client) return;
    setErrorMsg('');
    const redirectTo = new URL('/auth/callback', siteOrigin);
    redirectTo.searchParams.set('next', next);
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo.toString(),
      },
    });
    if (error) {
      setErrorMsg(error.message);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: 24 }}>
      {/* Top bar — brand link doubles as "back" so a visitor who
          changed their mind can return to the landing page with one
          click. Without this the /signin page felt like a dead end. */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 4px 24px', maxWidth: 1100, margin: '0 auto', width: '100%',
      }}>
        <Link href="/" style={{
          textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: '1.5rem' }} aria-hidden>←</span>
          <span style={{
            fontWeight: 800, fontSize: '1.05rem',
            background: 'linear-gradient(135deg, #E8832A, #D4A847)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            KathaKitaab
          </span>
        </Link>
        <Link href="/books" style={{
          color: 'var(--color-text-dim)', textDecoration: 'none', fontSize: '0.86rem',
        }}>
          Browse the library →
        </Link>
      </nav>

      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          width: '100%', maxWidth: 440,
          padding: 32,
          background: 'rgba(43,27,21,0.55)',
          border: '1px solid rgba(212,168,71,0.25)',
          borderRadius: 18,
          boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{
          fontSize: '0.72rem', color: 'var(--color-gold)', textTransform: 'uppercase',
          letterSpacing: '0.22em', marginBottom: 12, textAlign: 'center',
        }}>
          Free Beta · First 100 Users
        </div>
        <h1 className="font-serif" style={{
          fontSize: '1.85rem', textAlign: 'center', margin: 0,
          color: 'var(--color-gold-light)', lineHeight: 1.25,
        }}>
          Sign in to make a story
        </h1>
        <p style={{
          fontSize: '0.9rem', color: 'var(--color-text-dim)', lineHeight: 1.6,
          textAlign: 'center', marginTop: 10, marginBottom: 22,
        }}>
          Reading every existing book is free and needs no account. Sign in only to generate a new one.
        </p>

        {errorMsg && (
          <div style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 16,
            background: 'rgba(255,80,80,0.12)', border: '1px solid rgba(255,80,80,0.35)',
            color: '#ff8a8a', fontSize: '0.84rem',
          }}>
            {errorMsg}
          </div>
        )}

        {status === 'sent' ? (
          <div style={{ textAlign: 'center', padding: '18px 0' }}>
            <div style={{ fontSize: '2.2rem', marginBottom: 8 }}>✉️</div>
            <p style={{ color: 'var(--color-gold-light)', fontWeight: 600 }}>Check your inbox</p>
            <p style={{ color: 'var(--color-text-dim)', fontSize: '0.85rem', marginTop: 6 }}>
              We sent a message to <b>{email}</b>. Follow the instructions in your email to continue.
            </p>
          </div>
        ) : (
          <>
            {/* Mode toggle */}
            <div style={{
              display: 'flex', gap: 8, marginBottom: 16,
              background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 4,
            }}>
              <button
                type="button"
                onClick={() => { setMode('magic'); setErrorMsg(''); }}
                className="btn-secondary"
                style={{
                  flex: 1, padding: '8px 0', fontSize: '0.82rem',
                  background: mode === 'magic' ? 'rgba(212,168,71,0.2)' : 'transparent',
                  border: mode === 'magic' ? '1px solid rgba(212,168,71,0.4)' : '1px solid transparent',
                  color: mode === 'magic' ? 'var(--color-gold-light)' : 'var(--color-text-dim)',
                }}
              >
                Magic Link
              </button>
              <button
                type="button"
                onClick={() => { setMode('password'); setErrorMsg(''); }}
                className="btn-secondary"
                style={{
                  flex: 1, padding: '8px 0', fontSize: '0.82rem',
                  background: mode === 'password' ? 'rgba(212,168,71,0.2)' : 'transparent',
                  border: mode === 'password' ? '1px solid rgba(212,168,71,0.4)' : '1px solid transparent',
                  color: mode === 'password' ? 'var(--color-gold-light)' : 'var(--color-text-dim)',
                }}
              >
                Password
              </button>
            </div>

            {mode === 'magic' ? (
              <form onSubmit={sendMagicLink} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={status === 'sending'}
                  style={{
                    padding: '12px 16px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(212,168,71,0.3)',
                    borderRadius: 10, color: 'white', fontSize: '0.95rem', outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={!email || !accepted || status === 'sending'}
                  className="btn-primary"
                  style={{ width: '100%', opacity: (!email || !accepted || status === 'sending') ? 0.5 : 1 }}
                >
                  {status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
                </button>
              </form>
            ) : (
              <>
                {/* Password sub-mode toggle */}
                <div style={{
                  display: 'flex', gap: 6, marginBottom: 12,
                }}>
                  <button
                    type="button"
                    onClick={() => { setPasswordSubMode('signin'); setErrorMsg(''); }}
                    style={{
                      flex: 1, padding: '6px 0', fontSize: '0.78rem', borderRadius: 6,
                      background: passwordSubMode === 'signin' ? 'rgba(212,168,71,0.15)' : 'transparent',
                      border: '1px solid rgba(212,168,71,0.3)',
                      color: passwordSubMode === 'signin' ? 'var(--color-gold-light)' : 'var(--color-text-dim)',
                      cursor: 'pointer',
                    }}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPasswordSubMode('signup'); setErrorMsg(''); }}
                    style={{
                      flex: 1, padding: '6px 0', fontSize: '0.78rem', borderRadius: 6,
                      background: passwordSubMode === 'signup' ? 'rgba(212,168,71,0.15)' : 'transparent',
                      border: '1px solid rgba(212,168,71,0.3)',
                      color: passwordSubMode === 'signup' ? 'var(--color-gold-light)' : 'var(--color-text-dim)',
                      cursor: 'pointer',
                    }}
                  >
                    Create Account
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPasswordSubMode('forgot'); setErrorMsg(''); }}
                    style={{
                      flex: 1, padding: '6px 0', fontSize: '0.78rem', borderRadius: 6,
                      background: passwordSubMode === 'forgot' ? 'rgba(212,168,71,0.15)' : 'transparent',
                      border: '1px solid rgba(212,168,71,0.3)',
                      color: passwordSubMode === 'forgot' ? 'var(--color-gold-light)' : 'var(--color-text-dim)',
                      cursor: 'pointer',
                    }}
                  >
                    Forgot
                  </button>
                </div>

                {passwordSubMode === 'signin' && (
                  <form onSubmit={signInWithPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <input
                      type="email"
                      required
                      placeholder="you@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      disabled={status === 'sending'}
                      style={{
                        padding: '12px 16px',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(212,168,71,0.3)',
                        borderRadius: 10, color: 'white', fontSize: '0.95rem', outline: 'none',
                      }}
                    />
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="Password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        disabled={status === 'sending'}
                        style={{
                          width: '100%', padding: '12px 44px 12px 16px',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(212,168,71,0.3)',
                          borderRadius: 10, color: 'white', fontSize: '0.95rem', outline: 'none',
                        }}
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword(s => !s)}
                        style={{
                          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                          background: 'transparent', border: 'none', color: 'var(--color-text-dim)',
                          cursor: 'pointer', fontSize: '0.8rem',
                        }}
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <button
                      type="submit"
                      disabled={!email || !password || !accepted || status === 'sending'}
                      className="btn-primary"
                      style={{ width: '100%', opacity: (!email || !password || !accepted || status === 'sending') ? 0.5 : 1 }}
                    >
                      {status === 'sending' ? 'Signing in…' : 'Sign in'}
                    </button>
                  </form>
                )}

                {passwordSubMode === 'signup' && (
                  <form onSubmit={signUpWithPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <input
                      type="email"
                      required
                      placeholder="you@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      disabled={status === 'sending'}
                      style={{
                        padding: '12px 16px',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(212,168,71,0.3)',
                        borderRadius: 10, color: 'white', fontSize: '0.95rem', outline: 'none',
                      }}
                    />
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="Password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        disabled={status === 'sending'}
                        style={{
                          width: '100%', padding: '12px 44px 12px 16px',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(212,168,71,0.3)',
                          borderRadius: 10, color: 'white', fontSize: '0.95rem', outline: 'none',
                        }}
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword(s => !s)}
                        style={{
                          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                          background: 'transparent', border: 'none', color: 'var(--color-text-dim)',
                          cursor: 'pointer', fontSize: '0.8rem',
                        }}
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        placeholder="Confirm password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        disabled={status === 'sending'}
                        style={{
                          width: '100%', padding: '12px 44px 12px 16px',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(212,168,71,0.3)',
                          borderRadius: 10, color: 'white', fontSize: '0.95rem', outline: 'none',
                        }}
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowConfirmPassword(s => !s)}
                        style={{
                          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                          background: 'transparent', border: 'none', color: 'var(--color-text-dim)',
                          cursor: 'pointer', fontSize: '0.8rem',
                        }}
                      >
                        {showConfirmPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <button
                      type="submit"
                      disabled={!email || !password || !confirmPassword || !accepted || status === 'sending'}
                      className="btn-primary"
                      style={{ width: '100%', opacity: (!email || !password || !confirmPassword || !accepted || status === 'sending') ? 0.5 : 1 }}
                    >
                      {status === 'sending' ? 'Creating…' : 'Create account'}
                    </button>
                  </form>
                )}

                {passwordSubMode === 'forgot' && (
                  <form onSubmit={sendPasswordReset} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <input
                      type="email"
                      required
                      placeholder="you@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      disabled={status === 'sending'}
                      style={{
                        padding: '12px 16px',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(212,168,71,0.3)',
                        borderRadius: 10, color: 'white', fontSize: '0.95rem', outline: 'none',
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!email || status === 'sending'}
                      className="btn-primary"
                      style={{ width: '100%', opacity: (!email || status === 'sending') ? 0.5 : 1 }}
                    >
                      {status === 'sending' ? 'Sending…' : 'Send reset link'}
                    </button>
                  </form>
                )}
              </>
            )}

            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 20,
              fontSize: '0.8rem', color: 'var(--color-text-dim)', lineHeight: 1.6,
            }}>
              <input
                type="checkbox"
                checked={accepted}
                onChange={e => setAccepted(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                I agree to the{' '}
                <Link href="/terms" style={{ color: 'var(--color-gold)' }}>Terms</Link>{' '}
                and{' '}
                <Link href="/privacy" style={{ color: 'var(--color-gold)' }}>Privacy Policy</Link>.
              </span>
            </label>
          </>
        )}
      </motion.div>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
