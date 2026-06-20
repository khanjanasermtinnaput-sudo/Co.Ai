// Team workspaces — CRUD, member management, role checks, and workspace isolation.
// Storage: file-store (CGNTX_DATA_DIR) with Redis cache.

import { randomUUID } from 'node:crypto';
import { fsPut, fsGet, fsDel, fsList } from './file-store.js';
import { cacheKey, cacheGet, cacheSet, cacheDel } from './redis.js';
import { logger } from './logger.js';
import type { Team, TeamMember, TeamRole } from '../types.js';

export type { Team, TeamMember, TeamRole };

const COL_TEAMS   = 'teams';
const COL_MEMBERS = 'team_members';
const TEAM_TTL    = 300;
const MEMBER_TTL  = 60;

// ── Cache helpers ─────────────────────────────────────────────────────────────

function teamCacheKey(id: string)        { return cacheKey('team', id); }
function membersCacheKey(teamId: string) { return cacheKey('team-members', teamId); }
function userTeamsCacheKey(uid: string)  { return cacheKey('user-teams', uid); }

async function invalidateTeam(teamId: string, ...ownerIds: string[]): Promise<void> {
  const keys = [teamCacheKey(teamId), membersCacheKey(teamId), ...ownerIds.map(userTeamsCacheKey)];
  await cacheDel(...keys);
}

// ── Team CRUD ─────────────────────────────────────────────────────────────────

export async function createTeam(opts: {
  name: string;
  orgId: string;
  ownerId: string;
  description?: string;
}): Promise<Team> {
  const now  = new Date().toISOString();
  const slug = `${opts.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString(36)}`;
  const team: Team = {
    id: randomUUID(), orgId: opts.orgId, name: opts.name, slug,
    description: opts.description, createdAt: now, updatedAt: now,
  };
  fsPut(COL_TEAMS, team.id, team);

  const member: TeamMember = { teamId: team.id, userId: opts.ownerId, role: 'owner', joinedAt: now };
  fsPut(COL_MEMBERS, `${team.id}:${opts.ownerId}`, member);

  await invalidateTeam(team.id, opts.ownerId);
  logger.info('team_created', { teamId: team.id, orgId: opts.orgId, ownerId: opts.ownerId });
  return team;
}

export async function getTeam(teamId: string): Promise<Team | null> {
  const key = teamCacheKey(teamId);
  const hit = await cacheGet<Team>(key);
  if (hit) return hit;
  const val = fsGet<Team>(COL_TEAMS, teamId);
  if (val) await cacheSet(key, val, TEAM_TTL);
  return val;
}

export async function updateTeam(
  teamId: string,
  patch: Partial<Pick<Team, 'name' | 'description'>>,
): Promise<Team | null> {
  const existing = fsGet<Team>(COL_TEAMS, teamId);
  if (!existing) return null;
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  fsPut(COL_TEAMS, teamId, updated);
  await cacheDel(teamCacheKey(teamId));
  return updated;
}

export async function deleteTeam(teamId: string): Promise<boolean> {
  const team = fsGet<Team>(COL_TEAMS, teamId);
  const ok   = fsDel(COL_TEAMS, teamId);
  // Remove all memberships
  const members = fsList<TeamMember>(COL_MEMBERS, (m) => m.teamId === teamId);
  for (const m of members) fsDel(COL_MEMBERS, `${teamId}:${m.userId}`);
  const ownerIds = members.map((m) => m.userId);
  await invalidateTeam(teamId, ...ownerIds);
  if (team) logger.info('team_deleted', { teamId, orgId: team.orgId });
  return ok;
}

export function listTeamsForOrg(orgId: string): Team[] {
  return fsList<Team>(COL_TEAMS, (t) => t.orgId === orgId);
}

// ── Member management ──────────────────────────────────────────────────────────

export async function addTeamMember(
  teamId: string, userId: string, role: TeamRole = 'member',
): Promise<TeamMember> {
  const member: TeamMember = { teamId, userId, role, joinedAt: new Date().toISOString() };
  fsPut(COL_MEMBERS, `${teamId}:${userId}`, member);
  await cacheDel(membersCacheKey(teamId), userTeamsCacheKey(userId));
  return member;
}

export async function removeTeamMember(teamId: string, userId: string): Promise<boolean> {
  const ok = fsDel(COL_MEMBERS, `${teamId}:${userId}`);
  await cacheDel(membersCacheKey(teamId), userTeamsCacheKey(userId));
  return ok;
}

export async function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  const key = membersCacheKey(teamId);
  const hit = await cacheGet<TeamMember[]>(key);
  if (hit) return hit;
  const val = fsList<TeamMember>(COL_MEMBERS, (m) => m.teamId === teamId);
  await cacheSet(key, val, MEMBER_TTL);
  return val;
}

export async function getUserTeams(userId: string): Promise<Team[]> {
  const key = userTeamsCacheKey(userId);
  const hit = await cacheGet<Team[]>(key);
  if (hit) return hit;
  const memberships = fsList<TeamMember>(COL_MEMBERS, (m) => m.userId === userId);
  const teams = memberships.map((m) => fsGet<Team>(COL_TEAMS, m.teamId)).filter((t): t is Team => t !== null);
  await cacheSet(key, teams, MEMBER_TTL);
  return teams;
}

export async function getMemberRole(teamId: string, userId: string): Promise<TeamRole | null> {
  const members = await getTeamMembers(teamId);
  return members.find((m) => m.userId === userId)?.role ?? null;
}

export async function assertTeamAccess(
  teamId: string, userId: string, minRole: TeamRole = 'member',
): Promise<TeamRole> {
  const role = await getMemberRole(teamId, userId);
  if (!role) throw Object.assign(new Error('Not a team member'), { statusCode: 403 });
  const order: TeamRole[] = ['viewer', 'member', 'admin', 'owner'];
  if (order.indexOf(role) < order.indexOf(minRole)) {
    throw Object.assign(new Error(`Requires ${minRole} role`), { statusCode: 403 });
  }
  return role;
}
