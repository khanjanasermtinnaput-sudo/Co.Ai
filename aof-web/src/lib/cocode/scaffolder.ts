// ── AI Project Scaffolder (Phase 50) ─────────────────────────────────────────
// Generates complete project file structures from templates.
// Supports Next.js, React+Vite, Express, Fastify, and generic templates.

export type ScaffoldTemplate =
  | "nextjs-app" | "nextjs-pages" | "react-vite" | "static" | "express-api"
  | "fastify-api" | "t3-stack" | "monorepo" | "library";

export interface ScaffoldOptions {
  template: ScaffoldTemplate;
  projectName: string;
  typescript: boolean;
  includeTests: boolean;
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  extras: string[];
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

export interface TemplateDefinition {
  id: ScaffoldTemplate;
  label: string;
  description: string;
  defaultExtras: string[];
  availableExtras: string[];
}

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: "nextjs-app",
    label: "Next.js App Router",
    description: "Next.js 15 with App Router, TypeScript, and Tailwind CSS",
    defaultExtras: ["tailwind", "eslint"],
    availableExtras: ["tailwind", "eslint", "shadcn", "prisma", "supabase", "auth", "zustand"],
  },
  {
    id: "nextjs-pages",
    label: "Next.js Pages Router",
    description: "Next.js 15 with Pages Router and TypeScript",
    defaultExtras: ["eslint"],
    availableExtras: ["tailwind", "eslint", "prisma", "auth"],
  },
  {
    id: "react-vite",
    label: "React + Vite",
    description: "React 19 with Vite, TypeScript, and fast HMR",
    defaultExtras: ["tailwind"],
    availableExtras: ["tailwind", "eslint", "zustand", "react-query", "vitest"],
  },
  {
    id: "static",
    label: "Static HTML/CSS/JS",
    description: "Plain index.html + CSS + JS — no build step, previews instantly",
    defaultExtras: [],
    availableExtras: [],
  },
  {
    id: "express-api",
    label: "Express API",
    description: "Node.js Express REST API with TypeScript",
    defaultExtras: ["eslint"],
    availableExtras: ["eslint", "prisma", "jest", "cors", "auth"],
  },
  {
    id: "fastify-api",
    label: "Fastify API",
    description: "High-performance Fastify REST API with TypeScript",
    defaultExtras: ["eslint"],
    availableExtras: ["eslint", "prisma", "jest", "swagger"],
  },
  {
    id: "t3-stack",
    label: "T3 Stack",
    description: "Next.js + tRPC + Prisma + NextAuth + Tailwind",
    defaultExtras: ["tailwind", "prisma", "auth"],
    availableExtras: ["tailwind", "prisma", "auth", "zustand"],
  },
  {
    id: "monorepo",
    label: "Monorepo (Turborepo)",
    description: "Turborepo monorepo with shared packages and multiple apps",
    defaultExtras: ["tailwind", "eslint"],
    availableExtras: ["tailwind", "eslint", "prisma", "storybook"],
  },
  {
    id: "library",
    label: "TypeScript Library",
    description: "Publishable npm package with TypeScript, tests, and docs",
    defaultExtras: ["vitest"],
    availableExtras: ["vitest", "jest", "eslint", "storybook", "typedoc"],
  },
];

// ── File generators ───────────────────────────────────────────────────────────

function packageJson(opts: ScaffoldOptions): ScaffoldFile {
  const { projectName, template, typescript, packageManager } = opts;
  const deps: Record<string, string> = {};
  const devDeps: Record<string, string> = {};
  const scripts: Record<string, string> = {};

  if (template.startsWith("nextjs")) {
    deps["next"] = "^15.0.0";
    deps["react"] = "^19.0.0";
    deps["react-dom"] = "^19.0.0";
    scripts["dev"] = "next dev --turbo";
    scripts["build"] = "next build";
    scripts["start"] = "next start";
    scripts["lint"] = "next lint";
  } else if (template === "react-vite") {
    deps["react"] = "^19.0.0";
    deps["react-dom"] = "^19.0.0";
    devDeps["vite"] = "^6.0.0";
    devDeps["@vitejs/plugin-react"] = "^4.0.0";
    scripts["dev"] = "vite";
    scripts["build"] = "vite build";
    scripts["preview"] = "vite preview";
  } else if (template === "express-api") {
    deps["express"] = "^4.21.0";
    deps["cors"] = "^2.8.5";
    deps["dotenv"] = "^16.0.0";
    devDeps["ts-node-dev"] = "^2.0.0";
    scripts["dev"] = "ts-node-dev src/index.ts";
    scripts["build"] = "tsc";
    scripts["start"] = "node dist/index.js";
  } else if (template === "fastify-api") {
    deps["fastify"] = "^5.0.0";
    deps["@fastify/cors"] = "^10.0.0";
    devDeps["ts-node-dev"] = "^2.0.0";
    scripts["dev"] = "ts-node-dev src/index.ts";
    scripts["build"] = "tsc";
    scripts["start"] = "node dist/index.js";
  } else if (template === "library") {
    scripts["build"] = "tsc";
    scripts["test"] = "vitest";
    scripts["prepublishOnly"] = "npm run build";
  } else if (template === "static") {
    scripts["dev"] = "npx serve .";
  }

  if (typescript) {
    devDeps["typescript"] = "^5.6.0";
    devDeps["@types/node"] = "^22.0.0";
    if (template.startsWith("nextjs")) {
      // bundled TS support
    } else if (template === "react-vite") {
      devDeps["@types/react"] = "^19.0.0";
      devDeps["@types/react-dom"] = "^19.0.0";
    }
  }

  if (opts.extras.includes("tailwind")) {
    devDeps["tailwindcss"] = "^4.0.0";
    devDeps["@tailwindcss/vite"] = "^4.0.0";
  }

  if (opts.extras.includes("prisma")) {
    deps["@prisma/client"] = "^6.0.0";
    devDeps["prisma"] = "^6.0.0";
    scripts["db:push"] = "prisma db push";
    scripts["db:generate"] = "prisma generate";
    scripts["db:studio"] = "prisma studio";
  }

  if (opts.extras.includes("vitest") || opts.includeTests) {
    devDeps["vitest"] = "^3.0.0";
    scripts["test"] = "vitest";
    scripts["test:coverage"] = "vitest --coverage";
  }

  const pm = packageManager;
  const installCmd = pm === "npm" ? "npm install" : pm === "pnpm" ? "pnpm install" : pm === "yarn" ? "yarn" : "bun install";

  return {
    path: "package.json",
    content: JSON.stringify({
      name: projectName,
      version: "0.1.0",
      private: true,
      scripts,
      dependencies: deps,
      devDependencies: devDeps,
    }, null, 2),
  };
}

function tsconfig(template: ScaffoldTemplate): ScaffoldFile {
  const nextjsConfig = {
    compilerOptions: {
      target: "ES2017",
      lib: ["dom", "dom.iterable", "esnext"],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: "esnext",
      moduleResolution: "bundler",
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: "preserve",
      incremental: true,
      plugins: [{ name: "next" }],
      paths: { "@/*": ["./src/*"] },
    },
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    exclude: ["node_modules"],
  };

  const nodeConfig = {
    compilerOptions: {
      target: "ES2022",
      module: "CommonJS",
      moduleResolution: "node",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: "./dist",
      rootDir: "./src",
      declaration: true,
    },
    include: ["src"],
    exclude: ["node_modules", "dist"],
  };

  const viteConfig = {
    compilerOptions: {
      target: "ES2020",
      useDefineForClassFields: true,
      lib: ["ES2020", "DOM", "DOM.Iterable"],
      module: "ESNext",
      skipLibCheck: true,
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      isolatedModules: true,
      moduleDetection: "force",
      noEmit: true,
      jsx: "react-jsx",
      strict: true,
    },
    include: ["src"],
  };

  const config = template.startsWith("nextjs") || template === "t3-stack" ? nextjsConfig
    : template === "react-vite" || template === "library" ? viteConfig
    : nodeConfig;

  return { path: "tsconfig.json", content: JSON.stringify(config, null, 2) };
}

function readmeFile(opts: ScaffoldOptions): ScaffoldFile {
  const tmpl = TEMPLATES.find((t) => t.id === opts.template);
  return {
    path: "README.md",
    content: `# ${opts.projectName}

${tmpl?.description ?? "A new project"}

## Getting Started

\`\`\`bash
${opts.packageManager} install
${opts.packageManager === "npm" ? "npm run dev" : `${opts.packageManager} dev`}
\`\`\`

## Stack

- Template: ${tmpl?.label ?? opts.template}
- Language: ${opts.typescript ? "TypeScript" : "JavaScript"}
- Package manager: ${opts.packageManager}
${opts.extras.length > 0 ? `- Extras: ${opts.extras.join(", ")}` : ""}
`,
  };
}

function gitignore(): ScaffoldFile {
  return {
    path: ".gitignore",
    content: [
      "node_modules/", ".env", ".env.local", ".env.*.local",
      ".next/", "dist/", "build/", "out/",
      "*.log", ".DS_Store", "coverage/", ".turbo/",
    ].join("\n"),
  };
}

function envExample(template: ScaffoldTemplate, extras: string[]): ScaffoldFile {
  const lines = ["# Environment Variables"];
  if (template.startsWith("nextjs") || template === "t3-stack") {
    lines.push("NEXT_PUBLIC_APP_URL=http://localhost:3000");
  }
  if (extras.includes("prisma")) {
    lines.push("DATABASE_URL=postgresql://user:password@localhost:5432/db");
  }
  if (extras.includes("auth")) {
    lines.push("NEXTAUTH_SECRET=your-secret-here");
    lines.push("NEXTAUTH_URL=http://localhost:3000");
  }
  if (extras.includes("supabase")) {
    lines.push("NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co");
    lines.push("NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key");
  }
  return { path: ".env.example", content: lines.join("\n") };
}

function mainEntryFile(opts: ScaffoldOptions): ScaffoldFile {
  const { template, projectName, typescript: ts } = opts;
  const ext = ts ? "ts" : "js";

  if (template === "nextjs-app") {
    return {
      path: "src/app/page.tsx",
      content: `export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-4xl font-bold">${projectName}</h1>
    </main>
  );
}
`,
    };
  }

  if (template === "t3-stack") {
    return {
      path: "src/app/layout.tsx",
      content: `import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "${projectName}",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    };
  }

  if (template === "react-vite") {
    return {
      path: `src/App.${ts ? "tsx" : "jsx"}`,
      content: `export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <h1 className="text-4xl font-bold">${projectName}</h1>
    </div>
  );
}
`,
    };
  }

  if (template === "static") {
    return {
      path: "index.html",
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${projectName}</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <h1>${projectName}</h1>
  <script src="script.js"></script>
</body>
</html>
`,
    };
  }

  if (template === "express-api" || template === "fastify-api") {
    const isExpress = template === "express-api";
    return {
      path: `src/index.${ext}`,
      content: isExpress ? `import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "${projectName}" });
});

app.listen(PORT, () => {
  console.log(\`${projectName} running on port \${PORT}\`);
});
` : `import Fastify from "fastify";
import cors from "@fastify/cors";

const fastify = Fastify({ logger: true });
const PORT = Number(process.env.PORT ?? 3000);

await fastify.register(cors, { origin: true });

fastify.get("/health", async () => ({ status: "ok", service: "${projectName}" }));

fastify.listen({ port: PORT, host: "0.0.0.0" });
`,
    };
  }

  if (template === "library") {
    return {
      path: `src/index.${ext}`,
      content: `export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
`,
    };
  }

  return { path: `src/index.${ext}`, content: `// ${projectName} entry point\n` };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function generateScaffold(opts: ScaffoldOptions): ScaffoldFile[] {
  const files: ScaffoldFile[] = [
    packageJson(opts),
    ...(opts.template === "static" ? [] : [tsconfig(opts.template)]),
    readmeFile(opts),
    gitignore(),
    envExample(opts.template, opts.extras),
    mainEntryFile(opts),
  ];

  if (opts.template === "react-vite") {
    const ext = opts.typescript ? "tsx" : "jsx";
    files.push({
      path: "index.html",
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${opts.projectName}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.${ext}"></script>
</body>
</html>
`,
    });
    files.push({
      path: `src/main.${ext}`,
      content: `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")${opts.typescript ? "!" : ""}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
    });
    files.push({ path: "src/index.css", content: `:root {\n  color-scheme: light dark;\n}\n` });
  }

  if (opts.template === "static") {
    files.push({
      path: "style.css",
      content: `:root { color-scheme: light dark; }\nbody { font-family: system-ui, sans-serif; margin: 2rem; }\n`,
    });
    files.push({
      path: "script.js",
      content: `console.log("${opts.projectName} loaded");\n`,
    });
  }

  if (opts.template === "nextjs-app") {
    files.push({
      path: "src/app/layout.tsx",
      content: `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "${opts.projectName}" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    });
    files.push({ path: "src/app/globals.css", content: `@import "tailwindcss";\n` });
    files.push({ path: "next.config.ts", content: `import type { NextConfig } from "next";\n\nconst config: NextConfig = {};\n\nexport default config;\n` });
  }

  if (opts.extras.includes("prisma")) {
    files.push({
      path: "prisma/schema.prisma",
      content: `generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n`,
    });
  }

  if (opts.includeTests && opts.template !== "static") {
    files.push({
      path: `src/__tests__/index.test.${opts.typescript ? "ts" : "js"}`,
      content: `import { describe, it, expect } from "vitest";\n\ndescribe("${opts.projectName}", () => {\n  it("should work", () => {\n    expect(true).toBe(true);\n  });\n});\n`,
    });
    files.push({
      path: "vitest.config.ts",
      content: `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({\n  test: {\n    environment: "node",\n    coverage: { reporter: ["text", "json", "html"] },\n  },\n});\n`,
    });
  }

  return files;
}

export function buildAIScaffoldPrompt(opts: ScaffoldOptions, description: string): string {
  const tmpl = TEMPLATES.find((t) => t.id === opts.template);
  return `You are an expert developer. Generate additional source files for a ${tmpl?.label ?? opts.template} project named "${opts.projectName}".

Project description: ${description}
Extras: ${opts.extras.join(", ") || "none"}

For each file, output:
\`\`\`path/to/file.ext
file content here
\`\`\`

Generate only the most important files that would be useful for this project. Focus on the core functionality described. No explanations outside of code blocks.`;
}
