// Terms of Service — BOILERPLATE. Get this reviewed by a lawyer
// before you launch to paying users.

import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service — KathaKitaab',
};

export default function TermsPage() {
  return (
    <main style={{ maxWidth: 780, margin: '0 auto', padding: '88px 24px 80px', color: 'var(--color-text-dim)', lineHeight: 1.75 }}>
      <Link href="/" style={{ color: 'var(--color-gold)', textDecoration: 'none', fontSize: '0.85rem' }}>← Back</Link>
      <h1 className="font-serif" style={{ fontSize: '2.4rem', color: 'var(--color-gold-light)', marginTop: 24, marginBottom: 6 }}>
        Terms of Service
      </h1>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-dim)', marginBottom: 32 }}>
        Effective 11 May 2026. By using KathaKitaab you agree to these terms.
      </p>

      <h2>1. What KathaKitaab is</h2>
      <p>
        KathaKitaab is an AI storybook engine. You type a title and prompt; we use third-party AI models (currently OpenAI for text and images, Sarvam AI for narration) to generate an interactive storybook and a cinematic movie cut.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 18 to create an account. Children may use generated books under adult supervision. Personalised story mode requires you to confirm you are the child&apos;s parent or guardian.
      </p>

      <h2>3. Free beta</h2>
      <p>
        During the public beta we offer the first 100 signed-in users one (1) free generation, plus unlimited reading of every existing public book. This is a gift, not a contract — we may modify or end the free era at any time. Paid tier terms (when launched) will be presented separately at upgrade time.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to use KathaKitaab to generate, share, or attempt to generate:</p>
      <ul>
        <li>Sexual content involving minors, real or fictional, in any form.</li>
        <li>Content depicting real living persons (politicians, celebrities, private individuals) in defamatory, sexually explicit, or violent scenarios.</li>
        <li>Content that incites violence, terrorism, hatred, or self-harm.</li>
        <li>Content that infringes third-party copyrights or trademarks (do not generate paid characters &mdash; e.g. Disney, Marvel).</li>
        <li>Content that violates Indian law, including but not limited to the IT Act 2000 and the Bharatiya Nyaya Sanhita.</li>
      </ul>
      <p>
        We use automated moderation (OpenAI Moderation API) and reserve the right to remove content and suspend accounts that violate this section.
      </p>

      <h2>5. Ownership of generated content</h2>
      <p>
        The narrative, images, and audio generated for you are AI outputs based on your prompt and our pipeline. Under Indian copyright law, AI outputs do not currently carry copyright. <b>You</b> may use the books you generate for personal and educational purposes, including printing, sharing with family, and classroom use. <b>You may not</b> claim exclusive rights, sell them as your original work, or republish under terms that violate our acceptable-use rules above.
      </p>
      <p>
        KathaKitaab retains the right to display generated books in the public library when they are produced in &quot;world&quot; mode. Personalised and classroom mode books are private to you.
      </p>

      <h2>6. AI accuracy &amp; limitations</h2>
      <p>
        Generated content may contain factual errors, mythological misalignments, or culturally inaccurate elements. Books generated in storybook style with talking animals are fiction. Do not rely on KathaKitaab content as academic citation. Always cross-reference primary sources for school work.
      </p>

      <h2>7. Service availability</h2>
      <p>
        KathaKitaab is provided &quot;as is.&quot; We aim for high availability but make no SLA during the beta period. We may pause generation if our third-party providers (OpenAI, Sarvam) are unavailable or have rate-limited us.
      </p>

      <h2>8. Termination</h2>
      <p>
        We may suspend or terminate your account if you breach these terms or use the service in a way that imposes unreasonable cost on us. You can delete your account anytime via <a href="mailto:hello@kathakitaab.com">hello@kathakitaab.com</a>.
      </p>

      <h2>9. Indemnity</h2>
      <p>
        You agree to indemnify and hold KathaKitaab harmless from any claim arising out of content you generated and shared in violation of section 4 (acceptable use) or section 5 (ownership).
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent allowed by law, KathaKitaab&apos;s total liability for any claim relating to your use of the service is limited to ₹0 during the free beta and to amounts you paid in the 12 months prior to the claim during the paid era.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These terms are governed by the laws of India. Disputes are subject to the exclusive jurisdiction of the courts at Bengaluru, Karnataka.
      </p>

      <h2>12. Changes</h2>
      <p>
        We may update these terms. Material changes will be notified by email to signed-in users at least 14 days before they take effect.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:hello@kathakitaab.com">hello@kathakitaab.com</a>
      </p>

      <hr style={{ margin: '40px 0', borderColor: 'rgba(255,215,140,0.15)' }} />
      <p style={{ fontSize: '0.78rem' }}>
        Draft for beta. Lawyer-reviewed terms will replace this before paid tier launch.
      </p>
    </main>
  );
}
