// Privacy Policy — BOILERPLATE. Get this reviewed by a lawyer
// familiar with India's DPDP Act + GDPR before you launch to paying
// users. Especially the section on children's data (personalised
// stories) and AI subprocessors.

import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy — KathaKitaab.ai',
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 780, margin: '0 auto', padding: '88px 24px 80px', color: 'var(--color-text-dim)', lineHeight: 1.75 }}>
      <Link href="/" style={{ color: 'var(--color-gold)', textDecoration: 'none', fontSize: '0.85rem' }}>← Back</Link>
      <h1 className="font-serif" style={{ fontSize: '2.4rem', color: 'var(--color-gold-light)', marginTop: 24, marginBottom: 6 }}>
        Privacy Policy
      </h1>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-dim)', marginBottom: 32 }}>
        Effective 11 May 2026. This is a plain-language summary; the legal text below governs.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Anonymous cookie ID</b> (<code>katha:owner</code>) on first visit so you can read and delete your own private books without an account.</li>
        <li><b>Sign-in account</b> when you choose to create a book: your email address and your name as shared by your sign-in provider (Google).</li>
        <li><b>What you type into the generator</b>: book title, prompt, classroom or personalisation details.</li>
        <li><b>Generated content</b>: the scenes, images, and audio we make for you. Stored on Supabase Storage (EU/India region).</li>
        <li><b>Operational logs</b>: timestamps, request IDs, error messages — never your story content.</li>
      </ul>

      <h2>What we never collect</h2>
      <ul>
        <li>Payment cards directly — when paid tier launches it will run through Razorpay; we only see Razorpay&apos;s tokenised reference.</li>
        <li>Behavioural tracking from third parties (no Google Analytics, no Facebook pixel).</li>
        <li>For personalised stories: a child&apos;s last name, school, or address. We accept first name only.</li>
      </ul>

      <h2>Why we collect it</h2>
      <ul>
        <li>To show you the book you made and let you delete it.</li>
        <li>To enforce the free-era cap and per-user generation quota fairly.</li>
        <li>To debug errors when generation fails.</li>
        <li>To send you a sign-in link (the only operational email we use today).</li>
      </ul>

      <h2>Who else processes your data</h2>
      <p>
        We use third-party AI providers to generate content. Your prompt and the resulting scenes are sent to them under their data-processing terms. The current subprocessors:
      </p>
      <ul>
        <li><b>OpenAI</b> — narrative text and scene images (gpt-4o-mini, gpt-image-1).</li>
        <li><b>Sarvam AI</b> — narration audio (Bulbul v3).</li>
        <li><b>Supabase</b> — storage and database.</li>
        <li><b>Upstash</b> — Redis cache.</li>
        <li><b>Vercel</b> — hosting.</li>
        <li><b>Sentry</b> (when enabled) — error monitoring; sanitised logs only.</li>
        <li><b>PostHog</b> (when enabled) — anonymous analytics.</li>
      </ul>

      <h2>Children&apos;s data</h2>
      <p>
        KathaKitaab is intended for use by parents, teachers, and adults on behalf of children. We are not a children&apos;s service under COPPA / GDPR-K / DPDP. Personalised-story mode accepts a child&apos;s <b>first name only</b> and an age band — never identifying information. By creating a personalised story you confirm you are the parent or guardian. We do not retain the prompt content beyond the book&apos;s 30-day storage window.
      </p>

      <h2>Your rights</h2>
      <p>You can at any time:</p>
      <ul>
        <li>Delete any book you own from inside the app.</li>
        <li>Email <a href="mailto:privacy@kathakitaab.ai">privacy@kathakitaab.ai</a> to request deletion of your account and all associated data within 30 days.</li>
        <li>Export your books on request (we will provide JSON of the book record).</li>
      </ul>

      <h2>Retention</h2>
      <p>
        Generated books are retained for 30 days from last access, then auto-deleted from cache. Public books shipped with the app (Ramayana seed) are retained indefinitely. Account records are deleted within 30 days of a deletion request.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:hello@kathakitaab.ai">hello@kathakitaab.ai</a>. Data requests: <a href="mailto:privacy@kathakitaab.ai">privacy@kathakitaab.ai</a>.
      </p>

      <hr style={{ margin: '40px 0', borderColor: 'rgba(255,215,140,0.15)' }} />
      <p style={{ fontSize: '0.78rem' }}>
        This document is a draft for beta. The operator will publish a final reviewed version before paid tier launch.
      </p>
    </main>
  );
}
