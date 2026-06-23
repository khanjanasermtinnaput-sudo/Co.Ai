import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "Co.AI Cookie Policy — what cookies we use and why.",
  alternates: { canonical: "https://coagentix.app/cookies" },
};

export default function CookiesPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-4xl font-bold tracking-tight">Cookie Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: 19 June 2026</p>

      <div className="mt-10 space-y-10 text-base leading-7">
        <p>
          This Cookie Policy explains what cookies are, which ones Co.AI uses, and how you can
          control them.
        </p>

        <Section title="What are cookies?">
          <p>
            Cookies are small text files placed on your device by a website. They are widely used to
            make websites work efficiently and to provide information to site owners.
          </p>
        </Section>

        <Section title="Cookies we use">
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 font-medium">Name</th>
                  <th className="text-left py-2 pr-4 font-medium">Purpose</th>
                  <th className="text-left py-2 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {[
                  ["sb-*", "Supabase authentication session (strictly necessary)", "Session / 1 week"],
                  ["__vercel_*", "Vercel edge configuration (strictly necessary)", "Session"],
                  ["theme", "Your chosen colour scheme preference (functional)", "1 year"],
                ].map(([name, purpose, duration]) => (
                  <tr key={name}>
                    <td className="py-2.5 pr-4 font-mono text-xs">{name}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{purpose}</td>
                    <td className="py-2.5 text-muted-foreground">{duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Analytics &amp; tracking">
          <p>
            We do <strong>not</strong> use advertising cookies, third-party trackers, or analytics
            that profile individual users. We use aggregated, anonymised server-side metrics only.
          </p>
        </Section>

        <Section title="How to control cookies">
          <p>
            You can control or delete cookies through your browser settings. Note that disabling the
            authentication cookie will prevent you from signing in. See your browser&apos;s help
            documentation for instructions on managing cookies.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions?{" "}
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
