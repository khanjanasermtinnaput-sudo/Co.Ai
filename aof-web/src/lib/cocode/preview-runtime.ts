// ── Preview Runtime ──────────────────────────────────────────────────────────
// Turns the virtual file system into something an iframe can actually render.
//
// Three project shapes are supported:
//   "html"   — a real index.html exists → inline local <script src>/<link> and go.
//   "spa"    — React/Vite-style project (no index.html, has src/App.tsx etc.) →
//              transpile every source file with Babel Standalone in-browser,
//              resolve relative imports to Blob URLs, resolve bare imports
//              (react, react-dom, ...) via an <script type="importmap"> to esm.sh,
//              then boot it.
//   "nextjs" — needs a real Node server (next dev); an iframe can't run it, so
//              callers should show an honest notice instead of a blank screen.
//   "empty"  — nothing to render yet.

export interface PreviewFile {
  path: string;
  content: string;
}

export type PreviewKind = "html" | "spa" | "nextjs" | "empty";

export interface PreviewResult {
  kind: PreviewKind;
  html: string | null;
}

// ── Console relay injected into every preview variant ────────────────────────
// Forwards console.* and uncaught errors from the iframe to the parent via postMessage.
export const RELAY_SCRIPT = `<script>(function(){function s(l,a){try{parent.postMessage({src:"ccp",level:l,text:Array.from(a).map(function(x){try{return typeof x==="object"?JSON.stringify(x):String(x);}catch(e){return String(x);}}).join(" ")},"*");}catch(e){}}["log","info","warn","error"].forEach(function(m){var o=console[m];console[m]=function(){s(m,arguments);o&&o.apply(console,arguments);};});window.onerror=function(m,f,l){s("error",[m+(f?" ("+f+":"+l+")":"")]);};window.onunhandledrejection=function(e){s("error",["Unhandled: "+(e.reason?.message||e.reason)]);};})();<\/script>`;

export function injectRelay(html: string): string {
  if (html.includes("<head>")) return html.replace("<head>", `<head>${RELAY_SCRIPT}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}${RELAY_SCRIPT}`);
  return RELAY_SCRIPT + html;
}

export function inlineSources(html: string, files: Map<string, string>): string {
  let result = html;
  result = result.replace(/<script\s+src=["']([^"']+)["'][^>]*><\/script>/gi, (whole, src: string) => {
    if (/^https?:/.test(src)) return whole;
    const content = files.get(src) ?? files.get(src.replace(/^\.\//, ""));
    return content ? `<script>${content}<\/script>` : whole;
  });
  result = result.replace(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>/gi, (whole, href: string) => {
    if (/^https?:/.test(href)) return whole;
    const content = files.get(href) ?? files.get(href.replace(/^\.\//, ""));
    return content ? `<style>${content}</style>` : whole;
  });
  return result;
}

// ── Entry detection ───────────────────────────────────────────────────────────

function findHtmlEntry(files: PreviewFile[]): PreviewFile | null {
  return (
    files.find((f) => f.path === "index.html") ??
    files.find((f) => f.path === "public/index.html") ??
    files.find((f) => f.path.endsWith("/index.html")) ??
    files.find((f) => f.path.endsWith(".html")) ??
    null
  );
}

export function isNextProject(files: PreviewFile[]): boolean {
  return (
    files.some((f) => /^next\.config\.(js|mjs|ts)$/.test(f.path)) ||
    files.some((f) => f.path.startsWith("src/app/") || f.path.startsWith("app/") || f.path.startsWith("pages/") || f.path.startsWith("src/pages/"))
  );
}

const SELF_MOUNT_CANDIDATES = [
  "src/main.tsx", "src/main.jsx", "src/main.ts", "src/main.js",
  "src/index.tsx", "src/index.jsx", "src/index.ts", "src/index.js",
];
const SELF_MOUNT_RE = /createRoot|ReactDOM\.render|hydrateRoot/;

function findSelfMountingEntry(files: PreviewFile[]): PreviewFile | null {
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const candidate of SELF_MOUNT_CANDIDATES) {
    const f = byPath.get(candidate);
    if (f && SELF_MOUNT_RE.test(f.content)) return f;
  }
  return null;
}

const APP_CANDIDATES = ["src/App.tsx", "src/App.jsx", "src/app.tsx", "src/app.jsx", "App.tsx", "App.jsx"];

function findAppComponent(files: PreviewFile[]): PreviewFile | null {
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const candidate of APP_CANDIDATES) {
    const f = byPath.get(candidate);
    if (f) return f;
  }
  return files.find((f) => /\.(tsx|jsx)$/.test(f.path) && !f.path.includes("node_modules")) ?? null;
}

// ── Public entry point ────────────────────────────────────────────────────────

// A Vite-style index.html doesn't embed JS — it points at a module entry via
// <script type="module" src="/src/main.tsx">. That entry needs the Babel/importmap
// SPA pipeline, not literal inlining (a raw .tsx file dropped into a <script> tag
// is not valid JS the browser can run).
function findModuleScriptEntry(html: string, files: PreviewFile[]): string | null {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const re = /<script[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].replace(/^\.?\//, "");
    if (/\.(tsx|jsx|ts)$/.test(raw) && byPath.has(raw)) return raw;
  }
  return null;
}

export function buildPreview(files: PreviewFile[]): PreviewResult {
  if (!files.length) return { kind: "empty", html: null };

  const htmlEntry = findHtmlEntry(files);
  if (htmlEntry) {
    const moduleEntry = findModuleScriptEntry(htmlEntry.content, files);
    if (moduleEntry) {
      return { kind: "spa", html: buildSpaHtml(files, moduleEntry, null) };
    }
    const fileMap = new Map(files.map((f) => [f.path, f.content]));
    return { kind: "html", html: injectRelay(inlineSources(htmlEntry.content, fileMap)) };
  }

  if (isNextProject(files)) {
    return { kind: "nextjs", html: null };
  }

  const selfMount = findSelfMountingEntry(files);
  if (selfMount) {
    return { kind: "spa", html: buildSpaHtml(files, selfMount.path, null) };
  }

  const app = findAppComponent(files);
  if (!app) return { kind: "empty", html: null };
  return { kind: "spa", html: buildSpaHtml(files, null, app.path) };
}

// ── SPA runtime (in-browser Babel transpile + esm.sh importmap) ─────────────

const BARE_MODULE_CDN: Record<string, string> = {
  react: "https://esm.sh/react@18.3.1",
  "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
  "react/jsx-dev-runtime": "https://esm.sh/react@18.3.1/jsx-dev-runtime",
  "react-dom": "https://esm.sh/react-dom@18.3.1",
  "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
};

// Never emit a literal "</script>" inside content embedded in an inline <script> block.
function scriptSafe(json: string): string {
  return json.replace(/<\/script/gi, "<\\/script");
}

function buildSpaHtml(files: PreviewFile[], entryPath: string | null, mountAppPath: string | null): string {
  const sourceFiles = files.filter((f) => /\.(tsx|jsx|ts|js)$/.test(f.path) && !f.path.includes("node_modules"));
  const cssFiles = files.filter((f) => f.path.endsWith(".css"));

  const sources: Record<string, string> = {};
  for (const f of sourceFiles) sources[f.path] = f.content;

  let bootEntry = entryPath;
  if (!bootEntry && mountAppPath) {
    const spec = "./" + mountAppPath.replace(/\.(tsx|jsx|ts|js)$/, "");
    bootEntry = "__cocode_entry__.jsx";
    sources[bootEntry] = [
      "import React from \"react\";",
      "import { createRoot } from \"react-dom/client\";",
      "import App from \"" + spec + "\";",
      "const el = document.getElementById(\"root\");",
      "const root = createRoot(el);",
      "root.render(React.createElement(App));",
    ].join("\n");
  }
  if (!bootEntry) bootEntry = Object.keys(sources)[0];

  const styles = cssFiles.map((f) => `<style>${f.content}</style>`).join("\n");
  const importMap = scriptSafe(JSON.stringify({ imports: BARE_MODULE_CDN }, null, 2));
  const sourcesJson = scriptSafe(JSON.stringify(sources));
  const entryJson = scriptSafe(JSON.stringify(bootEntry));

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${RELAY_SCRIPT}
<script type="importmap">${importMap}</script>
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js"><\/script>
${styles}
<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;}</style>
</head>
<body>
<div id="root"></div>
<script type="module">
${LOADER_TEMPLATE.replace("__SOURCES__", sourcesJson).replace("__ENTRY__", entryJson)}
<\/script>
</body>
</html>`;
}

// Runs inside the iframe. No template-literal interpolation of its own — the two
// placeholders below are string-replaced with JSON before injection, so nothing
// here needs to survive being embedded inside another template literal.
const LOADER_TEMPLATE = `
const SOURCES = __SOURCES__;
const ENTRY = __ENTRY__;
const cache = new Map();

function resolveRelative(fromPath, spec) {
  const fromDir = fromPath.split("/").slice(0, -1);
  const stack = fromDir.slice();
  for (const part of spec.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const base = stack.join("/");
  const candidates = [
    base, base + ".tsx", base + ".ts", base + ".jsx", base + ".js",
    base + "/index.tsx", base + "/index.ts", base + "/index.jsx", base + "/index.js",
  ];
  for (const c of candidates) if (Object.prototype.hasOwnProperty.call(SOURCES, c)) return c;
  return null;
}

function extractImportSpecs(code) {
  // Covers: import(...), bare "import \"spec\";" side-effect imports, and any
  // "from \"spec\"" (static import/re-export, named/default/namespace).
  const re = /import\\s*\\(\\s*["']([^"']+)["']\\s*\\)|import\\s+["']([^"']+)["']|from\\s+["']([^"']+)["']/g;
  const specs = [];
  let m;
  while ((m = re.exec(code))) {
    const spec = m[1] || m[2] || m[3];
    if (spec) specs.push(spec);
  }
  return Array.from(new Set(specs));
}

// A no-op ES module — used in place of CSS/asset imports, which are already
// inlined globally as <style> tags and aren't valid JS module specifiers.
const EMPTY_MODULE_URL = "data:text/javascript,export default {}";

async function loadModule(path) {
  if (cache.has(path)) return cache.get(path);
  const promise = (async () => {
    const src = SOURCES[path];
    if (src === undefined) throw new Error("Module not found in project: " + path);
    const isTs = /\\.tsx?$/.test(path);
    const presets = [["react", { runtime: "automatic" }]];
    if (isTs) presets.push("typescript");
    const { code } = Babel.transform(src, { presets, filename: path, sourceType: "module" });
    let out = code;
    for (const spec of extractImportSpecs(code)) {
      const url = /\\.(css|scss|sass|less)$/i.test(spec)
        ? EMPTY_MODULE_URL
        : (spec.startsWith(".") || spec.startsWith("/"))
        ? await (async () => {
            const resolved = resolveRelative(path, spec);
            return resolved ? loadModule(resolved) : null;
          })()
        : null;
      if (url) {
        out = out.split('"' + spec + '"').join('"' + url + '"');
        out = out.split("'" + spec + "'").join("'" + url + "'");
      }
    }
    const blob = new Blob([out], { type: "text/javascript" });
    return URL.createObjectURL(blob);
  })();
  cache.set(path, promise);
  return promise;
}

(async () => {
  try {
    if (typeof Babel === "undefined") {
      throw new Error(
        "Preview engine failed to load: Babel Standalone (unpkg.com) was blocked or unreachable. " +
        "Check your network connection and the page Content-Security-Policy (script-src must allow https://unpkg.com and https://esm.sh)."
      );
    }
    const url = await loadModule(ENTRY);
    await import(url);
  } catch (e) {
    const root = document.getElementById("root");
    if (root) {
      root.innerHTML = "<pre style=\\"color:#f87171;padding:16px;white-space:pre-wrap;font:12px/1.5 monospace\\"></pre>";
      root.firstChild.textContent = String((e && e.stack) || e);
    }
    console.error(e);
  }
})();
`;
