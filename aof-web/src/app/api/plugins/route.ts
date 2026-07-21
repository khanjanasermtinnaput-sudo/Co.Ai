/**
 * GET  /api/plugins   — list available plugins
 * POST /api/plugins   — register or activate a plugin
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLUGIN_CATEGORIES = [
  "ai-model", "code-generator", "linter", "security", "deployment",
  "database", "testing", "documentation", "analytics",
] as const;

const PluginSchema = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(PLUGIN_CATEGORIES),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  entrypoint: z.string().url(),
  sandboxed: z.boolean().default(true),
  permissions: z.array(z.enum(["read-files", "write-files", "network", "exec"])).optional().default([]),
});

// Built-in plugin registry (in production this would be from DB)
const BUILTIN_PLUGINS = [
  { id: "openrouter",         name: "OpenRouter",         category: "ai-model",       version: "1.0.0", sandboxed: true,  active: true  },
  { id: "google-gemini",      name: "Google Gemini",      category: "ai-model",       version: "1.0.0", sandboxed: true,  active: true  },
  { id: "eslint",             name: "ESLint",             category: "linter",         version: "8.0.0", sandboxed: true,  active: true  },
  { id: "vercel",             name: "Vercel Deploy",      category: "deployment",     version: "1.0.0", sandboxed: true,  active: true  },
  { id: "supabase",           name: "Supabase",           category: "database",       version: "2.0.0", sandboxed: true,  active: true  },
  { id: "owasp-scanner",     name: "OWASP Scanner",      category: "security",       version: "1.0.0", sandboxed: true,  active: false },
];

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");

  const plugins = category
    ? BUILTIN_PLUGINS.filter((p) => p.category === category)
    : BUILTIN_PLUGINS;

  return NextResponse.json({
    plugins,
    total: plugins.length,
    categories: PLUGIN_CATEGORIES,
    sandboxPolicy: "All plugins run in isolated sandboxes. Unrestricted execution is never allowed.",
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PluginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid plugin specification", issues: parsed.error.issues }, { status: 400 });
  }

  const { permissions } = parsed.data;

  // Reject dangerous permission combinations
  if (permissions.includes("exec") && permissions.includes("network")) {
    return NextResponse.json({
      error: "Plugin rejected: exec + network permissions together are not allowed for security reasons",
    }, { status: 403 });
  }

  return NextResponse.json({
    status: "registered",
    plugin: {
      ...parsed.data,
      sandboxed: true, // always enforced
      id: `plugin-${Date.now()}`,
      registeredBy: user.id,
      registeredAt: new Date().toISOString(),
    },
    message: "Plugin registered in sandbox mode. Unrestricted execution is never permitted.",
  }, { status: 201 });
}
