import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Blog",
  description: "Insights, product updates, and engineering deep-dives from the Coagentix team.",
  alternates: { canonical: "https://coagentix.app/blog" },
};

const POSTS = [
  {
    slug: "introducing-coagentix",
    date: "2026-06-19",
    title: "Introducing Coagentix: Many Minds, One Intelligence",
    summary:
      "We're building the professional AI platform for developers — one that coordinates a fleet of specialised agents instead of relying on a single model to do everything.",
    tags: ["Product", "Launch"],
  },
  {
    slug: "coagentix-code-architecture",
    date: "2026-06-19",
    title: "How Coagentix Code works: TMAP under the hood",
    summary:
      "A technical walkthrough of the multi-agent TMAP pipeline — how tasks flow from the Chief Agent through the Planner, Coder, Reviewer, and Validator before a single file is written.",
    tags: ["Engineering", "AI"],
  },
  {
    slug: "security-design",
    date: "2026-06-19",
    title: "Security by design: how we store your API keys",
    summary:
      "Your provider API keys are encrypted with AES-256-GCM and a scrypt-derived master key before they ever touch the database. Here's exactly how that works.",
    tags: ["Security", "Engineering"],
  },
];

export default function BlogPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-4xl font-bold tracking-tight">Blog</h1>
      <p className="mt-4 text-xl text-muted-foreground">
        Insights, updates, and engineering from the Coagentix team.
      </p>

      <ul className="mt-14 space-y-12">
        {POSTS.map((post) => (
          <li key={post.slug}>
            <article>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <time dateTime={post.date}>
                  {new Date(post.date).toLocaleDateString("en-US", {
                    year: "numeric", month: "long", day: "numeric",
                  })}
                </time>
                <span>·</span>
                <div className="flex gap-1.5">
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                <Link href={`/blog/${post.slug}`} className="hover:text-primary transition-colors">
                  {post.title}
                </Link>
              </h2>
              <p className="mt-2 text-base leading-7 text-muted-foreground">{post.summary}</p>
              <Link
                href={`/blog/${post.slug}`}
                className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
              >
                Read more →
              </Link>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
