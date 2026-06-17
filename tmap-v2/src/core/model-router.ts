// Model Router — dynamically selects the best role/model per task category.
// Priority: Quality Score → Task Fitness → Availability → Latency → Cost.

import type { Role, TaskCategory } from '../types.js';
import type { CredentialBag } from '../config.js';
import { listProviderCandidates } from '../dars/select.js';
import type { HealthStore } from '../dars/health.js';

export interface ModelRoutingDecision {
  role: Role;
  reason: string;
  qualityPriority: 'high' | 'balanced' | 'fast';
}

// Category → best role mapping (which agent type produces best results per task)
const CATEGORY_ROLE_MAP: Partial<Record<TaskCategory, Role[]>> = {
  coding: ['coder', 'planner'],
  ui_design: ['coder', 'planner'],
  ux_design: ['planner', 'reviewer'],
  product_design: ['planner', 'reviewer'],
  research: ['planner', 'reviewer'],
  writing: ['planner', 'reviewer'],
  mathematics: ['planner', 'reviewer'],
  science: ['planner', 'reviewer'],
  data_analysis: ['coder', 'planner'],
  education: ['planner', 'reviewer'],
  business: ['planner', 'reviewer'],
  translation: ['planner', 'coder'],
  image_generation: ['planner'],
  image_editing: ['planner'],
  video: ['planner'],
  audio: ['planner'],
  multi_step: ['planner', 'coder', 'reviewer'],
};

// Categories that benefit from higher quality (slower, more capable) models
const HIGH_QUALITY_CATEGORIES = new Set<TaskCategory>([
  'coding', 'mathematics', 'science', 'data_analysis', 'research', 'product_design',
]);

// Categories where speed matters more
const FAST_CATEGORIES = new Set<TaskCategory>([
  'translation', 'writing', 'education',
]);

export function routeToRole(
  categories: TaskCategory[],
  creds: CredentialBag,
  health: HealthStore,
): ModelRoutingDecision {
  const primary = categories[0];

  // Determine quality priority
  let qualityPriority: 'high' | 'balanced' | 'fast' = 'balanced';
  if (primary && HIGH_QUALITY_CATEGORIES.has(primary)) qualityPriority = 'high';
  if (primary && FAST_CATEGORIES.has(primary)) qualityPriority = 'fast';

  // Select preferred roles for this category
  const preferredRoles: Role[] = (primary && CATEGORY_ROLE_MAP[primary]) ?? ['planner'];

  // Pick the first role that has a healthy provider available
  for (const role of preferredRoles) {
    const candidates = listProviderCandidates(role, creds);
    const healthy = candidates.filter((c) => {
      const snap = health.snapshot();
      const pHealth = snap.find((h) => h.key === c.healthKey);
      return !pHealth || (pHealth.consecutiveFails ?? 0) < 3;
    });
    if (healthy.length > 0) {
      return {
        role,
        reason: `${primary ?? 'general'} task → ${role} role (${qualityPriority} quality)`,
        qualityPriority,
      };
    }
  }

  // Fallback: planner handles everything
  return {
    role: 'planner',
    reason: 'fallback to planner (no healthy preferred provider)',
    qualityPriority: 'balanced',
  };
}

export function selectTemperature(
  qualityPriority: 'high' | 'balanced' | 'fast',
  taskType: TaskCategory,
): number {
  if (taskType === 'mathematics' || taskType === 'coding') return 0.1;
  if (qualityPriority === 'high') return 0.2;
  if (qualityPriority === 'fast') return 0.5;
  return 0.35;
}
