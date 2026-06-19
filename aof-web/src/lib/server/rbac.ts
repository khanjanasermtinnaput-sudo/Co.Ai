// RBAC — role-based access control backed by role_permissions table.
// Permissions follow <resource>:<action> format.
// Results are cached in Redis for 60 s to avoid per-request DB hits.

import { getAdminSupabase } from './supabase-admin';
import { cacheGet, cacheSet, cacheDel, cacheKey } from './redis';

function permCacheKey(userId: string): string {
  return cacheKey('rbac', userId);
}

export async function getUserPermissions(userId: string): Promise<string[]> {
  const cached = await cacheGet<string[]>(permCacheKey(userId));
  if (cached) return cached;

  const db = getAdminSupabase();
  const { data, error } = await db.rpc('get_user_permissions', { p_user_id: userId });
  if (error || !data) return [];

  const perms = data as string[];
  await cacheSet(permCacheKey(userId), perms, 60);
  return perms;
}

export async function hasPermission(userId: string, permission: string): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  return perms.includes(permission);
}

export async function hasAnyPermission(userId: string, ...permissions: string[]): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  return permissions.some((p) => perms.includes(p));
}

export async function hasAllPermissions(userId: string, ...permissions: string[]): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  return permissions.every((p) => perms.includes(p));
}

export function clearPermissionCache(userId: string): Promise<void> {
  return cacheDel(permCacheKey(userId));
}

export type Permission =
  | 'users:read'      | 'users:write'     | 'users:delete'
  | 'roles:read'      | 'roles:write'
  | 'keys:admin'
  | 'sessions:revoke' | 'sessions:read'
  | 'devices:admin'
  | 'mfa:bypass'
  | 'audit:read'
  | 'security:admin'
  | 'metrics:read'
  | 'flags:write'     | 'flags:read'
  | 'alerts:read'     | 'alerts:resolve';
