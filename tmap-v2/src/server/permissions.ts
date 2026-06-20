// Advanced permissions — RBAC with role hierarchy, resource-level ACLs,
// and permission matrix enforcement. Integrates with teams and orgs.

import { fsPut, fsGet, fsList, fsDel } from './file-store.js';
import { cacheKey, cacheGet, cacheSet, cacheDel } from './redis.js';
import type { PermissionRole, ResourceType, PermissionAction } from '../types.js';

export type { PermissionRole, ResourceType, PermissionAction };

const COL_ROLE_ASSIGNMENTS = 'role_assignments';
const PERM_TTL = 120;

// ── Role hierarchy (higher index = more powerful) ─────────────────────────────

const ROLE_ORDER: PermissionRole[] = ['viewer', 'member', 'team_admin', 'org_admin', 'superadmin'];

export function roleIndex(role: PermissionRole): number {
  return ROLE_ORDER.indexOf(role);
}

export function roleAtLeast(actual: PermissionRole, required: PermissionRole): boolean {
  return roleIndex(actual) >= roleIndex(required);
}

// ── Permission matrix ─────────────────────────────────────────────────────────

type PermMatrix = Record<PermissionRole, Partial<Record<ResourceType, PermissionAction[]>>>;

const PERMISSION_MATRIX: PermMatrix = {
  viewer: {
    session:   ['read'],
    analytics: ['read'],
    team:      ['read'],
    org:       ['read'],
  },
  member: {
    session:   ['create', 'read', 'execute'],
    key:       ['create', 'read', 'update', 'delete'],
    usage:     ['read'],
    team:      ['read'],
    org:       ['read'],
  },
  team_admin: {
    session:   ['create', 'read', 'update', 'delete', 'execute'],
    key:       ['create', 'read', 'update', 'delete'],
    usage:     ['read'],
    analytics: ['read'],
    team:      ['create', 'read', 'update'],
    org:       ['read'],
    backup:    ['read'],
  },
  org_admin: {
    session:   ['create', 'read', 'update', 'delete', 'execute'],
    key:       ['create', 'read', 'update', 'delete'],
    usage:     ['read', 'update'],
    analytics: ['read', 'create'],
    team:      ['create', 'read', 'update', 'delete', 'admin'],
    org:       ['read', 'update', 'admin'],
    backup:    ['create', 'read'],
  },
  superadmin: {
    session:   ['create', 'read', 'update', 'delete', 'execute', 'admin'],
    key:       ['create', 'read', 'update', 'delete', 'admin'],
    usage:     ['create', 'read', 'update', 'delete', 'admin'],
    analytics: ['create', 'read', 'update', 'delete', 'admin'],
    team:      ['create', 'read', 'update', 'delete', 'execute', 'admin'],
    org:       ['create', 'read', 'update', 'delete', 'execute', 'admin'],
    backup:    ['create', 'read', 'update', 'delete', 'execute', 'admin'],
  },
};

// ── Role assignment storage ────────────────────────────────────────────────────

export interface RoleAssignment {
  userId:    string;
  scope:     string;  // 'system' | 'org:<orgId>' | 'team:<teamId>'
  role:      PermissionRole;
  grantedAt: string;
  grantedBy: string;
}

function assignKey(userId: string, scope: string) { return `${userId}:${scope}`; }
function userRoleCacheKey(userId: string)          { return cacheKey('user-roles', userId); }

export async function assignRole(
  userId: string,
  scope: string,
  role: PermissionRole,
  grantedBy: string,
): Promise<RoleAssignment> {
  const assignment: RoleAssignment = {
    userId, scope, role, grantedAt: new Date().toISOString(), grantedBy,
  };
  fsPut(COL_ROLE_ASSIGNMENTS, assignKey(userId, scope), assignment);
  await cacheDel(userRoleCacheKey(userId));
  return assignment;
}

export async function revokeRole(userId: string, scope: string): Promise<boolean> {
  const ok = fsDel(COL_ROLE_ASSIGNMENTS, assignKey(userId, scope));
  await cacheDel(userRoleCacheKey(userId));
  return ok;
}

export async function getUserRoles(userId: string): Promise<RoleAssignment[]> {
  const key = userRoleCacheKey(userId);
  const hit = await cacheGet<RoleAssignment[]>(key);
  if (hit) return hit;
  const val = fsList<RoleAssignment>(COL_ROLE_ASSIGNMENTS, (a) => a.userId === userId);
  await cacheSet(key, val, PERM_TTL);
  return val;
}

export async function getEffectiveRole(
  userId: string,
  scope: string,
): Promise<PermissionRole | null> {
  const assignments = await getUserRoles(userId);
  // Exact scope match takes precedence, then system-level
  const exact  = assignments.find((a) => a.scope === scope);
  if (exact) return exact.role;
  const system = assignments.find((a) => a.scope === 'system');
  return system?.role ?? null;
}

// ── Permission check ──────────────────────────────────────────────────────────

export async function can(
  userId: string,
  action: PermissionAction,
  resource: ResourceType,
  scope = 'system',
): Promise<boolean> {
  const role = await getEffectiveRole(userId, scope);
  if (!role) return false;
  return canRole(role, action, resource);
}

export function canRole(
  role: PermissionRole,
  action: PermissionAction,
  resource: ResourceType,
): boolean {
  // Inherit permissions from lower roles
  const idx = roleIndex(role);
  for (let i = idx; i >= 0; i--) {
    const r = ROLE_ORDER[i];
    const allowed = PERMISSION_MATRIX[r]?.[resource];
    if (allowed?.includes(action)) return true;
  }
  return false;
}

export async function assertCan(
  userId: string,
  action: PermissionAction,
  resource: ResourceType,
  scope = 'system',
): Promise<void> {
  const ok = await can(userId, action, resource, scope);
  if (!ok) throw Object.assign(new Error(`Permission denied: ${action} on ${resource}`), { statusCode: 403 });
}

// ── Convenience: list what a role can do ─────────────────────────────────────

export function listPermissions(role: PermissionRole): Record<ResourceType, PermissionAction[]> {
  const result: Partial<Record<ResourceType, PermissionAction[]>> = {};
  const idx = roleIndex(role);
  for (let i = 0; i <= idx; i++) {
    const r   = ROLE_ORDER[i];
    const mat = PERMISSION_MATRIX[r];
    for (const [res, actions] of Object.entries(mat ?? {})) {
      const rType = res as ResourceType;
      result[rType] = [...new Set([...(result[rType] ?? []), ...(actions ?? [])])];
    }
  }
  return result as Record<ResourceType, PermissionAction[]>;
}
