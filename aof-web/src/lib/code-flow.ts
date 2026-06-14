// ── Aof Code staged flow ──────────────────────────────────────────────────────
// Aof Code behaves like a senior engineer: it never generates code on the first
// message. Every request walks Discover → Plan → Build → Debug. This module
// produces the offline content for the Discover questions, the Plan (architecture
// described, not coded) and the structured Debug answer.

import { uid } from "./utils";
import type { ClarifyQuestion, CodePlan, DebugAnswer } from "./types";

const isThai = (t: string) => /[฀-๿]/.test(t);

// ── Stage 1 · Discover ────────────────────────────────────────────────────────

/** Focused questions about the project — type, audience, core focus and stack. */
export function codeDiscoveryQuestions(prompt: string): ClarifyQuestion[] {
  const p = prompt.toLowerCase();

  // Lead the "what" options with the type the prompt hints at, if any.
  const typeOptions = [
    "Website",
    "Web app / SaaS",
    "Dashboard",
    "Online store",
    "Blog",
    "API / backend",
    "Mobile app",
    "Game",
  ];
  const hinted =
    /\bstore|shop|commerce|cart\b/.test(p)
      ? "Online store"
      : /\bdashboard|admin|analytics\b/.test(p)
        ? "Dashboard"
        : /\bblog\b/.test(p)
          ? "Blog"
          : /\bapi|backend|endpoint\b/.test(p)
            ? "API / backend"
            : /\bgame\b/.test(p)
              ? "Game"
              : /\bapp|saas|platform\b/.test(p)
                ? "Web app / SaaS"
                : null;
  const orderedTypes = hinted
    ? [hinted, ...typeOptions.filter((t) => t !== hinted)]
    : typeOptions;

  return [
    {
      id: uid("q"),
      question: "What are you building?",
      options: orderedTypes.slice(0, 6),
    },
    {
      id: uid("q"),
      question: "Who is it mainly for?",
      options: ["Just me", "A small team", "Customers / the public", "Enterprise / clients"],
    },
    {
      id: uid("q"),
      question: "What's the core focus?",
      options: [
        "Content & pages",
        "User accounts & auth",
        "Payments / billing",
        "Data & dashboards",
        "Realtime / collaboration",
      ],
    },
    {
      id: uid("q"),
      question: "Any tech preference?",
      options: ["Recommend for me", "React / Next.js", "Vue", "Plain HTML/CSS/JS", "Node API", "Python"],
    },
  ];
}

// ── Stage 2 · Plan ────────────────────────────────────────────────────────────

const STRUCTURE: Record<string, string[]> = {
  next: [
    "/app — routes, layouts & pages",
    "/components — reusable UI building blocks",
    "/lib — utilities, types & API clients",
    "/app/api — server routes & handlers",
    "/public — static assets",
    "/styles — design tokens & globals",
  ],
  vue: [
    "/src/pages — route views",
    "/src/components — reusable UI",
    "/src/composables — shared logic",
    "/src/lib — utilities & API clients",
    "/public — static assets",
  ],
  static: [
    "/index.html — entry page",
    "/css — stylesheets & design tokens",
    "/js — interactivity",
    "/assets — images, icons & fonts",
  ],
  node: [
    "/src/routes — HTTP endpoints",
    "/src/controllers — request handlers",
    "/src/models — data models",
    "/src/middleware — auth & validation",
    "/tests — unit & integration tests",
  ],
  python: [
    "/app — application package",
    "/app/api — route handlers",
    "/app/models — schemas & ORM models",
    "/app/services — domain logic",
    "/tests — unit tests",
    "requirements.txt — dependencies",
  ],
};

const FOCUS_FEATURES: Record<string, string[]> = {
  "Content & pages": ["Landing & content pages", "SEO-friendly metadata", "Contact / lead form"],
  "User accounts & auth": ["Sign up / sign in", "Protected routes & sessions", "Account settings"],
  "Payments / billing": ["Pricing & checkout", "Subscriptions & billing", "Payment webhooks"],
  "Data & dashboards": ["CRUD for core records", "Filterable dashboard with charts", "Export to CSV"],
  "Realtime / collaboration": ["Live updates & presence", "Shared editing", "In-app notifications"],
};

function stackFor(prefRaw: string | undefined, type: string | undefined): { key: string; label: string } {
  const pref = prefRaw ?? "Recommend for me";
  if (/react|next/i.test(pref)) return { key: "next", label: "Next.js + React + Tailwind CSS" };
  if (/vue/i.test(pref)) return { key: "vue", label: "Vue 3 + Vite + Tailwind CSS" };
  if (/html/i.test(pref)) return { key: "static", label: "HTML + CSS + vanilla JavaScript" };
  if (/node/i.test(pref)) return { key: "node", label: "Node.js + Express + PostgreSQL" };
  if (/python/i.test(pref)) return { key: "python", label: "Python + FastAPI + PostgreSQL" };
  // "Recommend for me" → pick by project type.
  if (type === "API / backend") return { key: "node", label: "Node.js + Express + PostgreSQL" };
  if (type === "Online store") return { key: "next", label: "Next.js + Stripe + Tailwind CSS" };
  if (type === "Blog" || type === "Website")
    return { key: "static", label: "Next.js (static export) + Tailwind CSS" };
  return { key: "next", label: "Next.js + React + Tailwind CSS" };
}

/** Synthesize a described architecture from the prompt + Discover answers. */
export function buildCodePlan(prompt: string, answers: Record<string, string>): CodePlan {
  const vals = Object.values(answers);
  const type = vals.find((v) =>
    ["Website", "Web app / SaaS", "Dashboard", "Online store", "Blog", "API / backend", "Mobile app", "Game"].includes(v),
  );
  const audience = vals.find((v) =>
    ["Just me", "A small team", "Customers / the public", "Enterprise / clients"].includes(v),
  );
  const focus = vals.find((v) => v in FOCUS_FEATURES);
  const pref = vals.find((v) =>
    ["Recommend for me", "React / Next.js", "Vue", "Plain HTML/CSS/JS", "Node API", "Python"].includes(v),
  );

  const stack = stackFor(pref, type);
  const structure = STRUCTURE[stack.key] ?? STRUCTURE.next;

  const features = [
    ...(focus ? FOCUS_FEATURES[focus] : ["Core pages & flows"]),
    "Responsive, accessible UI",
  ];
  if (audience === "Enterprise / clients") features.push("Role-based access control");
  if (audience === "Customers / the public") features.push("Analytics & error tracking");

  const th = isThai(prompt);
  const summary = th
    ? `แผนสำหรับ: ${prompt.slice(0, 80)} — ${type ?? "เว็บแอป"} บน ${stack.label}`
    : `Plan for: ${prompt.slice(0, 80)} — a ${(type ?? "web app").toLowerCase()} on ${stack.label}.`;

  return { summary, structure, features, stack: stack.label };
}

// ── Stage 4 · Debug ───────────────────────────────────────────────────────────

/** Turn a pasted error into a structured issue · cause · solution · fix. */
export function composeDebug(error: string): DebugAnswer {
  const e = error.toLowerCase();
  const firstLine = error.trim().split("\n")[0].slice(0, 140);
  const th = isThai(error);

  if (/cannot read propert|undefined is not|null is not|of undefined|of null/.test(e)) {
    return th
      ? {
          issue: `กำลังเข้าถึงพรอเพอร์ตีของค่าที่เป็น undefined/null: “${firstLine}”`,
          cause: "ตัวแปร/ผลลัพธ์ยังไม่ถูกกำหนดค่า (เช่น data ยังโหลดไม่เสร็จ หรือ key ไม่มีอยู่จริง) ก่อนถูกอ่าน",
          solution: "ตรวจให้แน่ใจว่าค่ามีอยู่ก่อนใช้งาน ด้วย optional chaining (?.) หรือค่าเริ่มต้น และเช็คสถานะ loading ก่อน render",
          fix: "const name = user?.profile?.name ?? \"Guest\";\nif (!data) return <Spinner />;",
        }
      : {
          issue: `Reading a property of an undefined/null value: “${firstLine}”`,
          cause: "A value is used before it exists — e.g. data hasn't loaded yet, or a key isn't present on the object.",
          solution: "Guard the access with optional chaining (?.) and a fallback, and handle the loading state before you render.",
          fix: "const name = user?.profile?.name ?? \"Guest\";\nif (!data) return <Spinner />;",
        };
  }

  if (/cannot find module|module not found|cannot resolve/.test(e)) {
    return th
      ? {
          issue: `หาโมดูลไม่เจอ: “${firstLine}”`,
          cause: "แพ็กเกจยังไม่ได้ติดตั้ง หรือ path การ import ผิด (ตัวพิมพ์เล็ก/ใหญ่ หรือ relative path)",
          solution: "ติดตั้งดีเพนเดนซีให้ครบ แล้วตรวจ path ของ import ให้ตรงกับไฟล์จริง",
          fix: "npm install <package>\n# แล้วเช็ค: import { x } from \"@/lib/x\"  // ตรงกับไฟล์จริงไหม",
        }
      : {
          issue: `A module can't be found: “${firstLine}”`,
          cause: "The package isn't installed, or the import path is wrong (case mismatch or a bad relative path).",
          solution: "Install the dependency, then verify the import path matches the real file location.",
          fix: "npm install <package>\n// then check: import { x } from \"@/lib/x\"  // matches the file?",
        };
  }

  if (/syntaxerror|unexpected token|unexpected end/.test(e)) {
    return th
      ? {
          issue: `ไวยากรณ์ผิด: “${firstLine}”`,
          cause: "มักเกิดจากวงเล็บ/ปีกกาไม่ครบ ลืมจุลภาค หรือ JSX ที่ไม่ได้ปิดแท็ก",
          solution: "ดูบรรทัดที่ระบุในข้อความ error แล้วไล่ตรวจวงเล็บที่จับคู่กัน และเครื่องหมายปิดให้ครบ",
        }
      : {
          issue: `A syntax error: “${firstLine}”`,
          cause: "Usually an unbalanced bracket/brace, a missing comma, or an unclosed JSX tag.",
          solution: "Jump to the line in the error, then check matching brackets and closing tags around it.",
        };
  }

  if (/econnrefused|network|fetch failed|timeout|enotfound/.test(e)) {
    return th
      ? {
          issue: `เชื่อมต่อปลายทางไม่สำเร็จ: “${firstLine}”`,
          cause: "เซิร์ฟเวอร์/บริการยังไม่รัน, URL ผิด, หรือ env var (เช่น คีย์/host) ยังไม่ได้ตั้งค่า",
          solution: "ยืนยันว่า service กำลังรันและ URL ถูก แล้วตรวจ environment variables ให้ครบก่อนเรียก",
        }
      : {
          issue: `A request couldn't reach its target: “${firstLine}”`,
          cause: "The server/service isn't running, the URL is wrong, or an env var (key/host) is unset.",
          solution: "Confirm the service is up and the URL is right, then check the required environment variables are set.",
        };
  }

  return th
    ? {
        issue: `มาดูข้อผิดพลาดนี้กัน: “${firstLine}”`,
        cause: "เพื่อชี้สาเหตุที่แท้จริง ผมขอดู error เต็ม ๆ (พร้อม stack trace) และโค้ดส่วนที่เกี่ยวข้อง",
        solution: "วาง error ฉบับเต็มและโค้ดรอบ ๆ บรรทัดที่พังมา เดี๋ยวผมไล่ที่มา อธิบายสาเหตุ แล้วส่งโค้ดที่แก้แล้วให้",
      }
    : {
        issue: `Let's look at this error: “${firstLine}”`,
        cause: "To pin the real cause I need the full error (with stack trace) and the code around the failing line.",
        solution: "Paste the complete error plus the surrounding code, and I'll trace it, explain the cause, and hand back the fixed code.",
      };
}
