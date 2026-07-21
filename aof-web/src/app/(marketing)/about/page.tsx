import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "Learn about Co.AI — the advanced multi-agent AI platform built for developers, teams, and forward-thinking companies.",
  alternates: { canonical: "https://coagentix.app/about" },
};

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-4xl font-bold tracking-tight">About Co.AI</h1>
      <p className="mt-4 text-xl text-muted-foreground leading-relaxed">
        Many Minds. One Intelligence.
      </p>

      <section className="mt-12 space-y-6 text-base leading-7">
        <p>
          Co.AI is an advanced multi-agent AI platform that brings together a fleet of specialised AI
          agents — Co.AI for conversation, CoCode for software engineering, and Projects for
          long-running collaboration — into a single, coherent workspace.
        </p>
        <p>
          We believe the best results come from many models reasoning together: a planner, a coder,
          a reviewer, a validator, each contributing their strengths, all orchestrated by a chief
          agent that knows when to delegate, when to push back, and when to ship.
        </p>
        <p>
          Our platform is built for developers who care about correctness, transparency, and speed.
          Every provider failure is surfaced as a structured error — never hidden behind a fake
          answer. Every model selection is explained. Every plan is reviewable before a single line
          of code is written.
        </p>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">Our values</h2>
        <ul className="mt-6 space-y-4 text-base leading-7">
          {[
            ["Transparency",  "We surface failures, not fake successes. You always know which model responded and why."],
            ["Speed",         "CoCode goes from idea to runnable multi-file project in seconds, not hours."],
            ["Security",      "Your API keys are encrypted at rest with AES-256-GCM and a scrypt-derived master key. They never leave our servers in plaintext."],
            ["Openness",      "Bring Your Own Key. Use any provider — Gemini, OpenRouter, DeepSeek, and more."],
          ].map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
              <span><strong>{title}:</strong> {body}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">Contact</h2>
        <p className="mt-4 text-base leading-7">
          Questions, partnerships, or press enquiries?{" "}
          <a href="/contact" className="text-primary hover:underline">Reach out to us</a>.
        </p>
      </section>
    </article>
  );
}
