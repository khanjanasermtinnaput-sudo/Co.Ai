import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the CoAgentix team.",
  alternates: { canonical: "https://coagentix.app/contact" },
};

const CONTACTS = [
  { label: "General enquiries", email: "hello@coagentix.app" },
  { label: "Security reports",  email: "security@coagentix.app" },
  { label: "Privacy / GDPR",    email: "privacy@coagentix.app" },
  { label: "Legal",             email: "legal@coagentix.app" },
];

export default function ContactPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-4xl font-bold tracking-tight">Contact Us</h1>
      <p className="mt-4 text-xl text-muted-foreground leading-relaxed">
        We read every email. Response time is typically within 1–2 business days.
      </p>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {CONTACTS.map(({ label, email }) => (
          <div
            key={email}
            className="rounded-xl border border-border/50 bg-card p-6 flex flex-col gap-2"
          >
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <a
              href={`mailto:${email}`}
              className="text-base font-medium text-primary hover:underline break-all"
            >
              {email}
            </a>
          </div>
        ))}
      </div>

      <section className="mt-16 rounded-xl border border-border/50 bg-card p-8">
        <h2 className="text-xl font-semibold tracking-tight">Security disclosures</h2>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          If you discover a security vulnerability, please email{" "}
          <a href="mailto:security@coagentix.app" className="text-primary hover:underline">
            security@coagentix.app
          </a>{" "}
          with a detailed description. We follow responsible disclosure practices and aim to
          acknowledge reports within 24 hours. Please do not publicly disclose the issue until
          we have had an opportunity to address it.
        </p>
      </section>
    </article>
  );
}
