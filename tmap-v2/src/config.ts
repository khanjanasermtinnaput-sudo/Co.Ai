import 'dotenv/config';
import type { Role, ResolvedProvider, Mode } from './types.js';

interface ProviderDef {
  name: string;
  envKey: string;          // env var holding the direct API key
  legacyEnvKey?: string;   // older env var name, checked if envKey is unset
  baseURL: string;         // OpenAI-compatible base URL
  defaultModel: string;
  modelEnv: string;        // env var to override model name
  openrouterModel: string; // model id when routed through OpenRouter
}

// Provider catalogue. All use the OpenAI-compatible /chat/completions shape,
// so one client speaks to every vendor (see TDD §3.3 — Role decoupled from Model).
export const PROVIDERS: Record<string, ProviderDef> = {
  gemini: {
    name: 'Gemini',
    envKey: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    modelEnv: 'GEMINI_MODEL',
    openrouterModel: 'google/gemini-2.5-flash',
  },
  deepseek: {
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    modelEnv: 'DEEPSEEK_MODEL',
    openrouterModel: 'deepseek/deepseek-chat',
  },
  qwen: {
    name: 'Qwen',
    // QWEN_API_KEY matches the aof-web key name; DASHSCOPE_API_KEY is kept as a
    // fallback for existing deployments that set it directly (see legacyEnvKey).
    envKey: 'QWEN_API_KEY',
    legacyEnvKey: 'DASHSCOPE_API_KEY',
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    modelEnv: 'QWEN_MODEL',
    openrouterModel: 'qwen/qwen-2.5-coder-32b-instruct',
  },
  llama: {
    name: 'Llama',
    // LLAMA_API_KEY matches the aof-web key name; GROQ_API_KEY is kept as a
    // fallback since Llama here is served through Groq's API (see legacyEnvKey).
    envKey: 'LLAMA_API_KEY',
    legacyEnvKey: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    modelEnv: 'LLAMA_MODEL',
    openrouterModel: 'meta-llama/llama-3.3-70b-instruct',
  },
};

// Default role -> provider mapping (overridable; this is config, not hardcode).
export const ROLE_PROVIDER: Record<Role, string> = {
  planner: 'gemini',
  coder: 'deepseek',
  reviewer: 'qwen',
  validator: 'llama',
};

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

function directKey(def: ProviderDef): string | undefined {
  const v = process.env[def.envKey];
  if (v && v.trim()) return v.trim();
  if (def.legacyEnvKey) {
    const legacy = process.env[def.legacyEnvKey];
    if (legacy && legacy.trim()) return legacy.trim();
  }
  return undefined;
}

function openrouterKey(): string | undefined {
  const v = process.env.OPENROUTER_API_KEY;
  return v && v.trim() ? v.trim() : undefined;
}

/** Resolve which provider/model/key a given role should use right now. */
export function resolveRole(role: Role): ResolvedProvider {
  const def = PROVIDERS[ROLE_PROVIDER[role]];

  // 1) Direct provider key wins.
  const key = directKey(def);
  if (key) {
    return {
      role, providerName: def.name, baseURL: def.baseURL, apiKey: key,
      model: process.env[def.modelEnv]?.trim() || def.defaultModel,
      mode: 'direct',
    };
  }

  // 2) OpenRouter single key covers every role.
  const or = openrouterKey();
  if (or) {
    return {
      role, providerName: `${def.name} (via OpenRouter)`, baseURL: OPENROUTER_BASE,
      apiKey: or, model: def.openrouterModel, mode: 'openrouter',
    };
  }

  // 3) Fallback: reuse any other provider that *does* have a direct key,
  //    so a single key (e.g. only GROQ) still runs the whole pipeline.
  for (const otherKey of Object.keys(PROVIDERS)) {
    const od = PROVIDERS[otherKey];
    const k = directKey(od);
    if (k) {
      return {
        role, providerName: `${def.name} -> ${od.name} (fallback)`, baseURL: od.baseURL,
        apiKey: k, model: process.env[od.modelEnv]?.trim() || od.defaultModel,
        mode: 'fallback',
      };
    }
  }

  // 4) No keys at all -> mock mode (offline demo, like the original prototype).
  return {
    role, providerName: `${def.name} (mock)`, baseURL: '', apiKey: '',
    model: 'mock', mode: 'mock',
  };
}

export function resolveAll(): Record<Role, ResolvedProvider> {
  return {
    planner: resolveRole('planner'),
    coder: resolveRole('coder'),
    reviewer: resolveRole('reviewer'),
    validator: resolveRole('validator'),
  };
}

export function currentMode(): Mode {
  const m = (process.env.COAGENTIX_MODE ?? process.env.AOF_MODE ?? 'normal').toLowerCase();
  return (['lite', 'normal', 'pro'].includes(m) ? m : 'normal') as Mode;
}

export function anyKeyConfigured(): boolean {
  if (openrouterKey()) return true;
  return Object.values(PROVIDERS).some((d) => directKey(d));
}

// ── Credential injection (used by the server: keys come from a user's account,
//    not from process.env) ─────────────────────────────────────────────────────
export interface CredentialBag {
  openrouter?: string;
  gemini?: string;
  deepseek?: string;
  qwen?: string;
  llama?: string;
  models?: Partial<Record<string, string>>; // providerKey -> model override
}

function bagKey(providerKey: string, creds: CredentialBag): string | undefined {
  const v = (creds as Record<string, unknown>)[providerKey];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function resolveRoleWith(role: Role, creds: CredentialBag): ResolvedProvider {
  const providerKey = ROLE_PROVIDER[role];
  const def = PROVIDERS[providerKey];
  const model = creds.models?.[providerKey] || def.defaultModel;

  const direct = bagKey(providerKey, creds);
  if (direct) {
    return { role, providerName: def.name, baseURL: def.baseURL, apiKey: direct, model, mode: 'direct' };
  }
  if (creds.openrouter?.trim()) {
    return {
      role, providerName: `${def.name} (via OpenRouter)`, baseURL: OPENROUTER_BASE,
      apiKey: creds.openrouter.trim(), model: def.openrouterModel, mode: 'openrouter',
    };
  }
  for (const otherKey of Object.keys(PROVIDERS)) {
    const k = bagKey(otherKey, creds);
    if (k) {
      const od = PROVIDERS[otherKey];
      return {
        role, providerName: `${def.name} -> ${od.name} (fallback)`, baseURL: od.baseURL,
        apiKey: k, model: creds.models?.[otherKey] || od.defaultModel, mode: 'fallback',
      };
    }
  }
  return { role, providerName: `${def.name} (mock)`, baseURL: '', apiKey: '', model: 'mock', mode: 'mock' };
}

export function resolveAllWith(creds: CredentialBag): Record<Role, ResolvedProvider> {
  return {
    planner: resolveRoleWith('planner', creds),
    coder: resolveRoleWith('coder', creds),
    reviewer: resolveRoleWith('reviewer', creds),
    validator: resolveRoleWith('validator', creds),
  };
}

export function bagHasAnyKey(creds: CredentialBag): boolean {
  return Boolean(creds.openrouter || creds.gemini || creds.deepseek || creds.qwen || creds.llama);
}

// ── Vision provider resolution (image OCR + analysis) ─────────────────────────
// Only some vendors are multimodal. DeepSeek and Llama (Groq) are text-only, so
// the image-reading step must pick a vision-capable model regardless of the
// normal role→provider map. Preference: Gemini (cheap, strong vision) → OpenRouter
// (Gemini route) → Qwen-VL. Model names are overridable via env.
const VISION_MODELS: Partial<Record<string, string>> = {
  gemini: process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-2.5-flash',
  qwen: process.env.QWEN_VISION_MODEL?.trim() || 'qwen-vl-plus',
};
const VISION_OPENROUTER_MODEL =
  process.env.VISION_OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash';

/** Resolve a vision-capable provider from a user's credentials, or mock if none. */
export function resolveVisionProviderWith(creds: CredentialBag): ResolvedProvider {
  const role: Role = 'planner'; // role is just a label here

  // 1) Direct keys for a multimodal vendor, in preference order.
  for (const pk of ['gemini', 'qwen'] as const) {
    const key = bagKey(pk, creds);
    if (key) {
      const def = PROVIDERS[pk];
      return {
        role, providerName: `${def.name} (vision)`, baseURL: def.baseURL, apiKey: key,
        model: creds.models?.[pk] || VISION_MODELS[pk] || def.defaultModel, mode: 'direct',
      };
    }
  }

  // 2) OpenRouter covers vision via a Gemini route.
  if (creds.openrouter?.trim()) {
    return {
      role, providerName: 'Gemini vision (via OpenRouter)', baseURL: OPENROUTER_BASE,
      apiKey: creds.openrouter.trim(), model: VISION_OPENROUTER_MODEL, mode: 'openrouter',
    };
  }

  // 3) No vision-capable key → mock (offline demo).
  return { role, providerName: 'vision (mock)', baseURL: '', apiKey: '', model: 'mock', mode: 'mock' };
}

/** Resolve a vision provider from process.env (CLI / non-server path). */
export function resolveVisionProvider(): ResolvedProvider {
  return resolveVisionProviderWith(bagFromEnv());
}

/** All vision-capable providers a user's credentials can reach, in preference
 *  order — lets the pipeline fail over (Gemini → Qwen-VL → OpenRouter). */
export function listVisionProvidersWith(creds: CredentialBag): ResolvedProvider[] {
  const role: Role = 'planner';
  const out: ResolvedProvider[] = [];
  for (const pk of ['gemini', 'qwen'] as const) {
    const key = bagKey(pk, creds);
    if (key) {
      const def = PROVIDERS[pk];
      out.push({
        role, providerName: `${def.name} (vision)`, baseURL: def.baseURL, apiKey: key,
        model: creds.models?.[pk] || VISION_MODELS[pk] || def.defaultModel, mode: 'direct',
      });
    }
  }
  if (creds.openrouter?.trim()) {
    out.push({
      role, providerName: 'Gemini vision (via OpenRouter)', baseURL: OPENROUTER_BASE,
      apiKey: creds.openrouter.trim(), model: VISION_OPENROUTER_MODEL, mode: 'openrouter',
    });
  }
  return out;
}

/** Build a CredentialBag from process.env so the CLI/env path also runs through DARS. */
export function bagFromEnv(): CredentialBag {
  const bag: CredentialBag = {};
  const or = process.env.OPENROUTER_API_KEY;
  if (or?.trim()) bag.openrouter = or.trim();
  for (const [pk, def] of Object.entries(PROVIDERS)) {
    const v = directKey(def);
    if (v) (bag as Record<string, unknown>)[pk] = v;
    const m = process.env[def.modelEnv];
    if (m?.trim()) { (bag.models ??= {})[pk] = m.trim(); }
  }
  return bag;
}
