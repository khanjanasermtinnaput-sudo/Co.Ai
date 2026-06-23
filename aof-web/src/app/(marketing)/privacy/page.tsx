import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Co.AI Privacy Policy — how we collect, use, and protect your data.",
  alternates: { canonical: "https://coagentix.app/privacy" },
};

const EFFECTIVE = "19 June 2026";

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-4xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Effective date: {EFFECTIVE}</p>

      <div className="mt-10 space-y-10 text-base leading-7">
        <Section title="1. Who we are">
          <p>
            Coagentix (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) operates the Co.AI platform at{" "}
            <a href="https://coagentix.app" className="text-primary hover:underline">coagentix.app</a>.
            This Privacy Policy describes how we collect, use, and protect your information when you
            use our services.
          </p>
        </Section>

        <Section title="2. Information we collect">
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Account information:</strong> email address and display name provided via Google OAuth (Supabase Auth).</li>
            <li><strong>Conversation data:</strong> messages you send and receive within the platform.</li>
            <li><strong>API keys:</strong> provider keys you save in Settings are stored AES-256-GCM encrypted at rest. We never store or transmit them in plaintext.</li>
            <li><strong>Usage data:</strong> anonymous request counts for rate limiting and analytics. No personally identifiable information is attached.</li>
            <li><strong>Log data:</strong> standard server logs (IP address, timestamp, HTTP method, path) for security monitoring. Retained for 30 days.</li>
          </ul>
        </Section>

        <Section title="3. How we use your information">
          <ul className="list-disc pl-5 space-y-2">
            <li>To provide, maintain, and improve the Co.AI platform.</li>
            <li>To authenticate you and enforce subscription entitlements.</li>
            <li>To detect and prevent abuse, fraud, and security incidents.</li>
            <li>To send transactional emails (account verification, password reset). We do not send marketing emails without explicit consent.</li>
          </ul>
        </Section>

        <Section title="4. Data sharing">
          <p>
            We do not sell your personal data. We share data only with:
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-3">
            <li><strong>AI providers</strong> (Anthropic, Google, DeepSeek, etc.) solely to fulfil your requests — your messages are transmitted directly to the chosen provider.</li>
            <li><strong>Supabase</strong> for authentication and database storage.</li>
            <li><strong>Vercel / Render</strong> for hosting. Standard processor agreement applies.</li>
          </ul>
        </Section>

        <Section title="5. Data retention">
          <p>
            Conversation history is stored per your account and deleted when you delete your account.
            API keys are deleted on request or on account deletion. Server logs are purged after 30 days.
          </p>
        </Section>

        <Section title="6. Your rights">
          <p>
            You may access, correct, export, or delete your personal data at any time via Settings, or
            by contacting us at{" "}
            <a href="mailto:privacy@coagentix.app" className="text-primary hover:underline">
              privacy@coagentix.app
            </a>. We respond within 30 days.
          </p>
        </Section>

        <Section title="7. Cookies">
          <p>
            We use only technically necessary cookies (session token). See our{" "}
            <a href="/cookies" className="text-primary hover:underline">Cookie Policy</a> for details.
          </p>
        </Section>

        <Section title="8. Security">
          <p>
            We use HTTPS everywhere, AES-256-GCM encryption for secrets at rest, and conduct regular
            security reviews. No system is perfectly secure; please report vulnerabilities to{" "}
            <a href="mailto:security@coagentix.app" className="text-primary hover:underline">
              security@coagentix.app
            </a>.
          </p>
        </Section>

        <Section title="9. Changes to this policy">
          <p>
            We may update this policy and will notify you via the platform or email for material
            changes. Continued use after changes constitutes acceptance.
          </p>
        </Section>

        <Section title="10. Contact">
          <p>
            Questions about privacy?{" "}
            <a href="mailto:privacy@coagentix.app" className="text-primary hover:underline">
              privacy@coagentix.app
            </a>
          </p>
        </Section>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight mb-3">{title}</h2>
      {children}
    </section>
  );
}
