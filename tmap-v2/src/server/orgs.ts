// Organization management — CRUD, plan management, multi-team oversight,
// org-level quotas, and admin user management.

import { randomUUID } from 'node:crypto';
import { fsPut, fsGet, fsDel, fsList } from './file-store.js';
import { cacheKey, cacheGet, cacheSet, cacheDel } from './redis.js';
import { logger } from './logger.js';
import type { Organization, OrgPlan } from '../types.js';

export type { Organization, OrgPlan };

const COL_ORGS     = 'orgs';
const COL_ORG_MBRS = 'org_members';
const ORG_TTL      = 300;

export interface OrgMember {
  orgId:    string;
  userId:   string;
  role:     'owner' | 'admin' | 'member';
  joinedAt: string;
}

export interface OrgQuota {
  maxTeams:          number;
  maxMembersPerTeam: number;
  maxMonthlyTokens:  number;
  maxMonthlyCostUsd: number;
}

const PLAN_QUOTAS: Record<OrgPlan, OrgQuota> = {
  free:       { maxTeams: 1,  maxMembersPerTeam: 3,   maxMonthlyTokens: 1_000_000,   maxMonthlyCostUsd: 10   },
  pro:        { maxTeams: 10, maxMembersPerTeam: 25,  maxMonthlyTokens: 10_000_000,  maxMonthlyCostUsd: 100  },
  enterprise: { maxTeams: 0,  maxMembersPerTeam: 0,   maxMonthlyTokens: 0,           maxMonthlyCostUsd: 0    }, // 0 = unlimited
};

// ── Cache helpers ─────────────────────────────────────────────────────────────

function orgKey(id: string)           { return cacheKey('org', id); }
function orgMembersKey(orgId: string) { return cacheKey('org-members', orgId); }
function userOrgsKey(uid: string)     { return cacheKey('user-orgs', uid); }

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createOrg(opts: {
  name: string;
  ownerId: string;
  plan?: OrgPlan;
}): Promise<Organization> {
  const now  = new Date().toISOString();
  const slug = `${opts.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString(36)}`;
  const org: Organization = {
    id: randomUUID(), name: opts.name, slug, plan: opts.plan ?? 'free',
    ownerId: opts.ownerId, ssoEnabled: false, createdAt: now, updatedAt: now,
  };
  fsPut(COL_ORGS, org.id, org);

  const member: OrgMember = { orgId: org.id, userId: opts.ownerId, role: 'owner', joinedAt: now };
  fsPut(COL_ORG_MBRS, `${org.id}:${opts.ownerId}`, member);

  await cacheDel(userOrgsKey(opts.ownerId));
  logger.info('org_created', { orgId: org.id, plan: org.plan, ownerId: opts.ownerId });
  return org;
}

export async function getOrg(orgId: string): Promise<Organization | null> {
  const key = orgKey(orgId);
  const hit = await cacheGet<Organization>(key);
  if (hit) return hit;
  const val = fsGet<Organization>(COL_ORGS, orgId);
  if (val) await cacheSet(key, val, ORG_TTL);
  return val;
}

export async function updateOrg(
  orgId: string,
  patch: Partial<Pick<Organization, 'name' | 'plan' | 'ssoEnabled'>>,
): Promise<Organization | null> {
  const existing = fsGet<Organization>(COL_ORGS, orgId);
  if (!existing) return null;
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  fsPut(COL_ORGS, orgId, updated);
  await cacheDel(orgKey(orgId));
  logger.info('org_updated', { orgId, patch: Object.keys(patch) });
  return updated;
}

export async function deleteOrg(orgId: string): Promise<boolean> {
  const ok = fsDel(COL_ORGS, orgId);
  const members = fsList<OrgMember>(COL_ORG_MBRS, (m) => m.orgId === orgId);
  for (const m of members) fsDel(COL_ORG_MBRS, `${orgId}:${m.userId}`);
  await cacheDel(orgKey(orgId), orgMembersKey(orgId), ...members.map((m) => userOrgsKey(m.userId)));
  return ok;
}

// ── Member management ──────────────────────────────────────────────────────────

export async function addOrgMember(
  orgId: string, userId: string, role: OrgMember['role'] = 'member',
): Promise<OrgMember> {
  const member: OrgMember = { orgId, userId, role, joinedAt: new Date().toISOString() };
  fsPut(COL_ORG_MBRS, `${orgId}:${userId}`, member);
  await cacheDel(orgMembersKey(orgId), userOrgsKey(userId));
  return member;
}

export async function removeOrgMember(orgId: string, userId: string): Promise<boolean> {
  const ok = fsDel(COL_ORG_MBRS, `${orgId}:${userId}`);
  await cacheDel(orgMembersKey(orgId), userOrgsKey(userId));
  return ok;
}

export async function getOrgMembers(orgId: string): Promise<OrgMember[]> {
  const key = orgMembersKey(orgId);
  const hit = await cacheGet<OrgMember[]>(key);
  if (hit) return hit;
  const val = fsList<OrgMember>(COL_ORG_MBRS, (m) => m.orgId === orgId);
  await cacheSet(key, val, 60);
  return val;
}

export async function getUserOrgs(userId: string): Promise<Organization[]> {
  const key = userOrgsKey(userId);
  const hit = await cacheGet<Organization[]>(key);
  if (hit) return hit;
  const memberships = fsList<OrgMember>(COL_ORG_MBRS, (m) => m.userId === userId);
  const orgs = memberships.map((m) => fsGet<Organization>(COL_ORGS, m.orgId)).filter((o): o is Organization => o !== null);
  await cacheSet(key, orgs, 120);
  return orgs;
}

export async function getOrgMemberRole(orgId: string, userId: string): Promise<OrgMember['role'] | null> {
  const members = await getOrgMembers(orgId);
  return members.find((m) => m.userId === userId)?.role ?? null;
}

// ── Quota helpers ──────────────────────────────────────────────────────────────

export function getOrgQuota(plan: OrgPlan): OrgQuota {
  return PLAN_QUOTAS[plan];
}

export async function checkOrgTeamLimit(orgId: string, currentTeamCount: number): Promise<boolean> {
  const org = await getOrg(orgId);
  if (!org) return false;
  const quota = PLAN_QUOTAS[org.plan];
  return quota.maxTeams === 0 || currentTeamCount < quota.maxTeams;
}
