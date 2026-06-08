import 'dotenv/config';
import type { Role, ResolvedProvider, Mode } from './types.js';

interface ProviderDef {
  name: string;
  envKey: string;          // env var holding the direct API key
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
    defaultModel: 'gemini-2.0-flash',
    modelEnv: 'GEMINI_MODEL',
    openrouterModel: 'google/gemini-2.0-flash-001',
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
    envKey: 'DASHSCOPE_API_KEY',
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    modelEnv: 'QWEN_MODEL',
    openrouterModel: 'qwen/qwen-2.5-coder-32b-instruct',
  },
  llama: {
    name: 'Llama',
    envKey: 'GROQ_API_KEY',
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
  return v && v.trim() ? v.trim() : undefined;
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
  const m = (process.env.AOF_MODE || 'normal').toLowerCase();
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
