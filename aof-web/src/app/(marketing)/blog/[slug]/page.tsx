import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

// ── Blog post content ──────────────────────────────────────────────────────────

const POSTS: Record<string, { title: string; date: string; tags: string[]; content: string }> = {
  "introducing-coagentix": {
    title: "Introducing Co.AI: Many Minds, One Intelligence",
    date: "2026-06-19",
    tags: ["Product", "Launch"],
    content: `
Co.AI is an advanced multi-agent AI platform for developers — one that coordinates a fleet of specialised agents instead of relying on a single model to do everything.

## The problem with single-model AI

Every major AI product today sends your request to one model and hopes for the best. Sometimes that works. But for complex, multi-step tasks — writing a full feature, auditing a codebase, researching and writing a technical document — a single model suffers from:

- **Context overflow**: large tasks simply don't fit in one call
- **No specialisation**: the same model writes prose and writes code, with no separation of concerns
- **No verification**: the model grades its own homework
- **Silent failure**: when the model gets it wrong, there's no second opinion

## The Co.AI approach

We built TMAP — the Task-Model-Agent Pipeline — a multi-agent system where each agent has a defined role:

1. **Chief Agent** — breaks the task into a structured plan
2. **Planner** — refines the plan, identifies dependencies and risks
3. **Coder / Writer** — executes each step in isolation
4. **Reviewer** — reads the output with a critical eye
5. **Validator** — runs automated checks and catches regressions

No single agent sees the whole conversation. Each one gets exactly the context it needs to do its job well.

## Provider diversity by design

Co.AI routes tasks to the best available provider — Anthropic, Gemini, DeepSeek, Qwen, Llama, or OpenRouter — based on task type and model availability. If a provider is down or rate-limited, the next one in the chain picks up without interrupting you.

You bring your own keys. We never bill you for model tokens.

## What's next

We're shipping CoCode — a professional coding assistant powered by TMAP — and Co.AI, a multi-provider chat interface with full session memory. Both are available today.

[Get started →](/chat)
    `.trim(),
  },

  "coagentix-code-architecture": {
    title: "How CoCode works: TMAP under the hood",
    date: "2026-06-19",
    tags: ["Engineering", "AI"],
    content: `
TMAP — the Task-Model-Agent Pipeline — is the engine behind CoCode. Here's exactly how a coding task flows through the system.

## The pipeline at a glance

\`\`\`
User request
  └─► Chief Agent       (task decomposition)
        └─► Planner     (dependency graph, risk assessment)
              └─► Coder (parallel sub-task execution)
                    └─► Reviewer  (output critique)
                          └─► Validator (automated checks)
\`\`\`

Each stage runs as a separate LLM call with a specialised system prompt. Stages are isolated — the Coder doesn't see the Reviewer's notes, so it can't pre-emptively defend its choices.

## Chief Agent: task decomposition

The Chief receives your raw request and produces a structured JSON plan:

\`\`\`json
{
  "objective": "Add rate limiting to /api/chat",
  "steps": [
    { "id": 1, "action": "read", "target": "src/app/api/chat/route.ts" },
    { "id": 2, "action": "implement", "description": "Add sliding-window rate limiter", "depends_on": [1] },
    { "id": 3, "action": "test", "description": "Write unit test for rate limiter", "depends_on": [2] }
  ]
}
\`\`\`

Steps with no dependencies run in parallel. The Chief also selects the best provider for each step based on the task type (coding vs. reasoning vs. research).

## Planner: risk and dependency refinement

The Planner reads the Chief's plan and enriches it:

- Flags steps that touch shared state (race conditions)
- Identifies missing context that would cause the Coder to hallucinate
- Adds a rollback step if the task modifies a database schema

## Coder: isolated execution

Each coding step gets its own context window: the relevant file contents, the specific instruction, and nothing else. This prevents context bleed between steps.

If a step fails, the Coder retries with the error message injected into context. After three failures, it escalates to the Reviewer.

## Reviewer: structured critique

The Reviewer reads the Coder's output against the original plan and produces a structured critique:

- ✅ Correctness (does it solve the stated problem?)
- ✅ Safety (SQL injection, XSS, secret leakage?)
- ✅ Completeness (are edge cases handled?)
- ✅ Style (does it match the surrounding code?)

Failing criteria trigger a targeted re-execution of just the failing step — not the whole pipeline.

## Validator: automated checks

The final stage runs whatever the project supports: TypeScript compiler, ESLint, Jest, Playwright. A build failure is fed back into the pipeline as a structured error, and the Coder gets one more attempt with the exact error output.

## Provider routing

TMAP v2 adds DARS — the Distributed Agent Routing System — which maintains a health score for each configured provider and routes each pipeline stage to the fastest healthy one. If Anthropic is rate-limiting, DARS silently routes the next call to Gemini.

The circuit breaker opens after 3 consecutive failures and half-opens after 60 seconds to test recovery.
    `.trim(),
  },

  "security-design": {
    title: "Security by design: how we store your API keys",
    date: "2026-06-19",
    tags: ["Security", "Engineering"],
    content: `
When you add an API key in Co.AI Settings, it's encrypted before it ever touches the database. Here's exactly how.

## The threat model

We're protecting against:

1. **Database breach** — the attacker gets a full dump of the \`provider_keys\` table
2. **Server-side key exposure** — a compromised server process reads keys from memory
3. **Log leakage** — a key accidentally lands in an application log

We are NOT trying to protect against a fully compromised server with root access — that's a deployment security problem, not an application security problem.

## Encryption scheme: AES-256-GCM with scrypt KDF

Every key is encrypted with AES-256-GCM before being written to Supabase.

The encryption key is derived from:
- \`COAGENTIX_MASTER_KEY\` (a 32-byte random secret from your environment)
- The user's Supabase UUID (a per-user salt)
- A random 16-byte salt generated per encryption

\`\`\`
dk = scrypt(COAGENTIX_MASTER_KEY + userId, salt, N=16384, r=8, p=1, dklen=32)
ciphertext, tag = AES-256-GCM.encrypt(dk, iv, plaintext)
stored = base64(salt) + ":" + base64(iv) + ":" + base64(ciphertext + tag)
\`\`\`

The scrypt parameters (N=16384) make brute-forcing the master key computationally expensive even if the database is breached.

## Why GCM?

AES-GCM is an authenticated encryption mode — it produces a 128-bit authentication tag that detects tampering. A decryption call that returns the wrong tag throws an error immediately rather than returning corrupt plaintext.

## What's stored in Supabase

The \`provider_keys\` table stores:

| Column | Value |
|--------|-------|
| \`user_id\` | Supabase UUID |
| \`provider\` | e.g. \`anthropic\` |
| \`encrypted_key\` | \`salt:iv:ciphertext+tag\` (base64) |
| \`updated_at\` | timestamp |

The plaintext key **never** touches the database. The master key **never** touches the database. A breach of this table yields only ciphertext — useless without the master key and the Supabase user UUID.

## Redaction in logs

Every error object in Co.AI passes through a redactor before being logged or shown in the Developer Mode panel:

\`\`\`typescript
const SECRET_PATTERNS = [
  /\\b(sk|sk-or|sk-ant|gsk|key)[-_][A-Za-z0-9._-]{6,}\\b/g,
  /\\bBearer\\s+[A-Za-z0-9._-]{8,}\\b/gi,
  /"?api[_-]?key"?\\s*[:=]\\s*"?[A-Za-z0-9._-]{8,}"?/gi,
];
\`\`\`

Any string that looks like a key is replaced with \`«redacted»\` before it can leak into logs or error UI.

## Row-level security

The \`provider_keys\` table enforces RLS in Supabase:

\`\`\`sql
create policy "Users can only access their own keys"
  on provider_keys for all
  using (auth.uid() = user_id);
\`\`\`

Even if the application code has a bug that passes the wrong user ID to a query, Supabase's RLS layer enforces ownership at the database level.
    `.trim(),
  },
};

// ── Route ─────────────────────────────────────────────────────────────────────

type Props = { params: { slug: string } };

export function generateStaticParams() {
  return Object.keys(POSTS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = POSTS[params.slug];
  if (!post) return { title: "Not Found" };
  return {
    title: post.title,
    alternates: { canonical: `https://coagentix.app/blog/${params.slug}` },
  };
}

export default function BlogPostPage({ params }: Props) {
  const post = POSTS[params.slug];
  if (!post) notFound();

  const lines = post.content.split("\n");

  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <Link href="/blog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← Back to Blog
      </Link>

      <header className="mt-8">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <time dateTime={post.date}>
            {new Date(post.date).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
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
        <h1 className="mt-3 text-4xl font-bold tracking-tight">{post.title}</h1>
      </header>

      <article className="mt-12 prose prose-neutral dark:prose-invert max-w-none">
        {lines.map((line, i) => {
          if (line.startsWith("## ")) return <h2 key={i} className="text-2xl font-semibold mt-10 mb-4">{line.slice(3)}</h2>;
          if (line.startsWith("# ")) return <h1 key={i} className="text-3xl font-bold mt-10 mb-4">{line.slice(2)}</h1>;
          if (line.startsWith("```")) return null;
          if (line.startsWith("| ")) return null;
          if (line.startsWith("- ")) return <li key={i} className="ml-6 list-disc text-muted-foreground">{line.slice(2)}</li>;
          if (line.trim() === "") return <div key={i} className="h-4" />;
          return <p key={i} className="text-base leading-7 text-muted-foreground">{line}</p>;
        })}
      </article>
    </div>
  );
}
