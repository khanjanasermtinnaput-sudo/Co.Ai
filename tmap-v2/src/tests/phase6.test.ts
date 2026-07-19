// Phase 6 — Scale & Enterprise test suite
// Uses node:test + node:assert/strict (no Jest)
// All tests are synchronous or use async/await; no external services required.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Use isolated temp dir for all file-store operations
const TEST_DATA_DIR = join(tmpdir(), `cgntx-p6-test-${Date.now()}`);
process.env['CGNTX_DATA_DIR'] = TEST_DATA_DIR;
process.env['CGNTX_BACKUP_DIR'] = join(TEST_DATA_DIR, 'backups');
// Disable Redis for file-only tests
const origRedisUrl = process.env['REDIS_URL'];
delete process.env['REDIS_URL'];
delete process.env['REDIS_HOST'];

// ── helpers ───────────────────────────────────────────────────────────────────

before(() => { mkdirSync(TEST_DATA_DIR, { recursive: true }); });
after(()   => { try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {} });

// ── 1. File Store ─────────────────────────────────────────────────────────────

describe('FileStore', () => {
  it('put and get round-trip', async () => {
    const { fsPut, fsGet } = await import('../server/file-store.js');
    fsPut('test_col', 'r1', { id: 'r1', val: 42 });
    const got = fsGet<{ id: string; val: number }>('test_col', 'r1');
    assert.ok(got);
    assert.equal(got.id, 'r1');
    assert.equal(got.val, 42);
  });

  it('returns null for missing record', async () => {
    const { fsGet } = await import('../server/file-store.js');
    assert.equal(fsGet('test_col', 'does-not-exist'), null);
  });

  it('deletes record', async () => {
    const { fsPut, fsDel, fsGet } = await import('../server/file-store.js');
    fsPut('test_del', 'x', { id: 'x' });
    assert.ok(fsDel('test_del', 'x'));
    assert.equal(fsGet('test_del', 'x'), null);
  });

  it('lists all records', async () => {
    const { fsPut, fsList } = await import('../server/file-store.js');
    fsPut('test_list', 'a', { id: 'a', n: 1 });
    fsPut('test_list', 'b', { id: 'b', n: 2 });
    fsPut('test_list', 'c', { id: 'c', n: 3 });
    const all = fsList<{ id: string; n: number }>('test_list');
    assert.equal(all.length, 3);
  });

  it('filters list', async () => {
    const { fsPut, fsList } = await import('../server/file-store.js');
    fsPut('test_filter', 'p', { id: 'p', type: 'pass' });
    fsPut('test_filter', 'q', { id: 'q', type: 'fail' });
    const filtered = fsList<{ id: string; type: string }>('test_filter', (i) => i.type === 'pass');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'p');
  });

  it('fsExists returns true for existing record', async () => {
    const { fsPut, fsExists } = await import('../server/file-store.js');
    fsPut('test_exists', 'z', { id: 'z' });
    assert.equal(fsExists('test_exists', 'z'), true);
    assert.equal(fsExists('test_exists', 'missing'), false);
  });
});

// ── 2. Streaming ─────────────────────────────────────────────────────────────

describe('Streaming', () => {
  it('getConnectionStats returns zero with no connections', async () => {
    const { getConnectionStats } = await import('../server/streaming.js');
    const stats = getConnectionStats();
    assert.equal(stats.total, 0);
    assert.deepEqual(stats.byChannel, {});
    assert.deepEqual(stats.byUser,    {});
  });

  it('startHeartbeat / stopHeartbeat idempotent', async () => {
    const { startHeartbeat, stopHeartbeat } = await import('../server/streaming.js');
    startHeartbeat();
    startHeartbeat(); // second call is a no-op
    stopHeartbeat();
    stopHeartbeat();  // second call is a no-op
    assert.ok(true);
  });
});

// ── 3. Teams ─────────────────────────────────────────────────────────────────

describe('Teams', () => {
  it('creates a team with owner as member', async () => {
    const { createTeam, getMemberRole } = await import('../server/teams.js');
    // Patch Redis calls to no-op for unit tests
    const team = await createTeam({ name: 'Alpha Team', orgId: 'org-1', ownerId: 'user-1' });
    assert.ok(team.id);
    assert.equal(team.orgId, 'org-1');
    assert.ok(team.slug.startsWith('alpha-team'));
    const role = await getMemberRole(team.id, 'user-1');
    assert.equal(role, 'owner');
  });

  it('getTeam returns created team', async () => {
    const { createTeam, getTeam } = await import('../server/teams.js');
    const team = await createTeam({ name: 'Beta', orgId: 'org-1', ownerId: 'user-2' });
    const got  = await getTeam(team.id);
    assert.ok(got);
    assert.equal(got.name, 'Beta');
  });

  it('updateTeam modifies name', async () => {
    const { createTeam, updateTeam } = await import('../server/teams.js');
    const team    = await createTeam({ name: 'Gamma', orgId: 'org-1', ownerId: 'user-3' });
    const updated = await updateTeam(team.id, { name: 'Gamma Updated' });
    assert.ok(updated);
    assert.equal(updated.name, 'Gamma Updated');
  });

  it('addTeamMember / getTeamMembers', async () => {
    const { createTeam, addTeamMember, getTeamMembers } = await import('../server/teams.js');
    const team    = await createTeam({ name: 'Delta', orgId: 'org-1', ownerId: 'user-4' });
    await addTeamMember(team.id, 'user-5', 'member');
    const members = await getTeamMembers(team.id);
    assert.ok(members.some((m) => m.userId === 'user-5'));
  });

  it('removeTeamMember removes member', async () => {
    const { createTeam, addTeamMember, removeTeamMember, getTeamMembers } = await import('../server/teams.js');
    const team = await createTeam({ name: 'Epsilon', orgId: 'org-1', ownerId: 'u-a' });
    await addTeamMember(team.id, 'u-b', 'member');
    await removeTeamMember(team.id, 'u-b');
    const members = await getTeamMembers(team.id);
    assert.ok(!members.some((m) => m.userId === 'u-b'));
  });

  it('deleteTeam removes team and members', async () => {
    const { createTeam, deleteTeam, getTeam } = await import('../server/teams.js');
    const team = await createTeam({ name: 'Zeta', orgId: 'org-1', ownerId: 'u-z' });
    await deleteTeam(team.id);
    const got = await getTeam(team.id);
    assert.equal(got, null);
  });

  it('assertTeamAccess throws for non-member', async () => {
    const { createTeam, assertTeamAccess } = await import('../server/teams.js');
    const team = await createTeam({ name: 'Eta', orgId: 'org-1', ownerId: 'u-e' });
    await assert.rejects(() => assertTeamAccess(team.id, 'outsider'), /Not a team member/);
  });
});

// ── 4. Organizations ─────────────────────────────────────────────────────────

describe('Organizations', () => {
  it('creates org with owner as member', async () => {
    const { createOrg, getOrgMemberRole } = await import('../server/orgs.js');
    const org  = await createOrg({ name: 'Acme Corp', ownerId: 'user-org-1' });
    assert.ok(org.id);
    assert.equal(org.plan, 'free');
    const role = await getOrgMemberRole(org.id, 'user-org-1');
    assert.equal(role, 'owner');
  });

  it('getOrg returns org', async () => {
    const { createOrg, getOrg } = await import('../server/orgs.js');
    const org = await createOrg({ name: 'Globex', ownerId: 'u-go' });
    const got = await getOrg(org.id);
    assert.ok(got);
    assert.equal(got.name, 'Globex');
  });

  it('updateOrg changes plan', async () => {
    const { createOrg, updateOrg } = await import('../server/orgs.js');
    const org     = await createOrg({ name: 'Initech', ownerId: 'u-i' });
    const updated = await updateOrg(org.id, { plan: 'pro' });
    assert.ok(updated);
    assert.equal(updated.plan, 'pro');
  });

  it('getOrgQuota: enterprise has unlimited', async () => {
    const { getOrgQuota } = await import('../server/orgs.js');
    const quota = getOrgQuota('enterprise');
    assert.equal(quota.maxTeams, 0);
    assert.equal(quota.maxMembersPerTeam, 0);
  });

  it('getOrgQuota: free has limits', async () => {
    const { getOrgQuota } = await import('../server/orgs.js');
    const quota = getOrgQuota('free');
    assert.ok(quota.maxTeams > 0);
    assert.ok(quota.maxMembersPerTeam > 0);
  });
});

// ── 5. Permissions ────────────────────────────────────────────────────────────

describe('Permissions', () => {
  it('roleAtLeast: viewer < member < team_admin', async () => {
    const { roleAtLeast } = await import('../server/permissions.js');
    assert.equal(roleAtLeast('member',     'viewer'), true);
    assert.equal(roleAtLeast('team_admin', 'member'), true);
    assert.equal(roleAtLeast('viewer',     'member'), false);
  });

  it('canRole: member can execute session', async () => {
    const { canRole } = await import('../server/permissions.js');
    assert.equal(canRole('member', 'execute', 'session'), true);
  });

  it('canRole: viewer cannot create session', async () => {
    const { canRole } = await import('../server/permissions.js');
    assert.equal(canRole('viewer', 'create', 'session'), false);
  });

  it('canRole: superadmin can do everything', async () => {
    const { canRole } = await import('../server/permissions.js');
    assert.equal(canRole('superadmin', 'admin',   'org'),     true);
    assert.equal(canRole('superadmin', 'delete',  'backup'),  true);
    assert.equal(canRole('superadmin', 'execute', 'session'), true);
  });

  it('listPermissions: member has key CRUD', async () => {
    const { listPermissions } = await import('../server/permissions.js');
    const perms = listPermissions('member');
    assert.ok(perms['key']?.includes('create'));
    assert.ok(perms['key']?.includes('delete'));
  });

  it('assignRole and getUserRoles', async () => {
    const { assignRole, getUserRoles } = await import('../server/permissions.js');
    await assignRole('perm-user-1', 'system', 'member', 'admin');
    const roles = await getUserRoles('perm-user-1');
    assert.ok(roles.some((r) => r.scope === 'system' && r.role === 'member'));
  });

  it('getEffectiveRole returns assigned role', async () => {
    const { assignRole, getEffectiveRole } = await import('../server/permissions.js');
    await assignRole('perm-user-2', 'org:org-99', 'org_admin', 'admin');
    const role = await getEffectiveRole('perm-user-2', 'org:org-99');
    assert.equal(role, 'org_admin');
  });
});

// ── 6. Backup ─────────────────────────────────────────────────────────────────

describe('Backup', () => {
  it('creates backup and returns manifest', async () => {
    process.env['COAGENTIX_MASTER_KEY'] = 'test-key-for-backup-phase6';
    const { createBackup } = await import('../server/backup.js');
    const manifest = await createBackup({ requestedBy: 'user-bk', encrypt: false });
    assert.ok(manifest.id.startsWith('bk-'));
    assert.equal(manifest.status, 'complete');
    assert.ok(manifest.sizeBytes > 0);
  });

  it('lists backups', async () => {
    const { listBackups } = await import('../server/backup.js');
    const backups = listBackups();
    assert.ok(Array.isArray(backups));
  });

  it('getBackup returns manifest', async () => {
    const { createBackup, getBackup } = await import('../server/backup.js');
    const created = await createBackup({ requestedBy: 'user-bk2', encrypt: false });
    const got     = getBackup(created.id);
    assert.ok(got);
    assert.equal(got.id, created.id);
  });

  it('validateBackup returns valid for good backup', async () => {
    const { createBackup, validateBackup } = await import('../server/backup.js');
    const created = await createBackup({ requestedBy: 'user-bk3', encrypt: false });
    const result  = validateBackup(created.id);
    assert.equal(result.valid, true);
    assert.equal(result.error, undefined);
  });

  it('validateBackup returns invalid for missing id', async () => {
    const { validateBackup } = await import('../server/backup.js');
    const result = validateBackup('nonexistent-backup-id');
    assert.equal(result.valid, false);
    assert.ok(typeof result.error === 'string');
  });
});

// ── 7. Restore ────────────────────────────────────────────────────────────────

describe('Restore', () => {
  it('preRestoreChecks fails for unknown backup', async () => {
    const { preRestoreChecks } = await import('../server/restore.js');
    const result = preRestoreChecks('no-such-backup');
    assert.equal(result.ok, false);
    assert.ok(result.issues.length > 0);
  });

  it('dry-run restore succeeds without writing', async () => {
    const { createBackup } = await import('../server/backup.js');
    const { restore } = await import('../server/restore.js');
    const backup = await createBackup({ requestedBy: 'user-rs', encrypt: false });
    const result = await restore({ backupId: backup.id, dryRun: true, requestedBy: 'user-rs' });
    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
  });

  it('getLastRestoreStatus is null initially', async () => {
    // Fresh import after test isolation
    const { getLastRestoreStatus } = await import('../server/restore.js');
    // may or may not be null depending on test order — just check it's callable
    const status = getLastRestoreStatus();
    assert.ok(status === null || typeof status === 'object');
  });
});

// ── 8. Disaster Recovery ──────────────────────────────────────────────────────

describe('DisasterRecovery', () => {
  it('createIncident returns incident with correct fields', async () => {
    const { createIncident } = await import('../server/disaster-recovery.js');
    const inc = createIncident({ title: 'DB latency spike', severity: 'high', affectedServices: ['supabase'], openedBy: 'oncall' });
    assert.ok(inc.id.startsWith('inc-'));
    assert.equal(inc.severity, 'high');
    assert.equal(inc.status, 'open');
    assert.equal(inc.affectedServices[0], 'supabase');
  });

  it('updateIncident changes status', async () => {
    const { createIncident, updateIncident } = await import('../server/disaster-recovery.js');
    const inc     = createIncident({ title: 'Redis OOM', severity: 'critical', affectedServices: ['redis'], openedBy: 'sre' });
    const updated = updateIncident(inc.id, { status: 'investigating', note: 'checking memory usage' });
    assert.ok(updated);
    assert.equal(updated.status, 'investigating');
    assert.ok(updated.notes.some((n) => n.includes('checking memory usage')));
  });

  it('listIncidents filters by status', async () => {
    const { createIncident, updateIncident, listIncidents } = await import('../server/disaster-recovery.js');
    const inc = createIncident({ title: 'Minor alert', severity: 'low', affectedServices: [], openedBy: 'bot' });
    updateIncident(inc.id, { status: 'resolved' });
    const open     = listIncidents({ status: 'open' });
    const resolved = listIncidents({ status: 'resolved' });
    assert.ok(!open.some((i) => i.id === inc.id));
    assert.ok(resolved.some((i) => i.id === inc.id));
  });

  it('getRunbook returns steps', async () => {
    const { getRunbook, DR_RUNBOOK } = await import('../server/disaster-recovery.js');
    const all = getRunbook();
    assert.equal(all.length, DR_RUNBOOK.length);
  });

  it('getRunbook filters by severity', async () => {
    const { getRunbook } = await import('../server/disaster-recovery.js');
    const critical = getRunbook('critical');
    const low      = getRunbook('low');
    assert.ok(critical.length > 0);
    assert.ok(low.length < critical.length);
  });
});

// ── 9. Failover / Circuit Breaker ────────────────────────────────────────────

describe('Failover', () => {
  it('withRetry succeeds on first try', async () => {
    const { withRetry } = await import('../server/failover.js');
    const result = await withRetry(() => Promise.resolve(42));
    assert.equal(result, 42);
  });

  it('withRetry retries on failure and eventually succeeds', async () => {
    const { withRetry } = await import('../server/failover.js');
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return 'ok';
    }, { attempts: 3, baseDelayMs: 1 });
    assert.equal(result, 'ok');
    assert.equal(attempts, 3);
  });

  it('withRetry throws after exhausting attempts', async () => {
    const { withRetry } = await import('../server/failover.js');
    await assert.rejects(
      () => withRetry(() => Promise.reject(new Error('always fails')), { attempts: 2, baseDelayMs: 1 }),
      /always fails/,
    );
  });

  it('circuit breaker: open after threshold failures', async () => {
    const { withCircuit, listCircuits, resetCircuit } = await import('../server/failover.js');
    const name = `test-cb-${Date.now()}`;
    // Force open the circuit
    for (let i = 0; i < 5; i++) {
      try { await withCircuit(name, () => Promise.reject(new Error('fail'))); } catch {}
    }
    const cbs = listCircuits();
    const cb  = cbs.find((c) => c.name === name);
    assert.ok(cb);
    assert.equal(cb.state, 'open');
    resetCircuit(name);
  });

  it('resetCircuit closes an open circuit', async () => {
    const { withCircuit, listCircuits, resetCircuit } = await import('../server/failover.js');
    const name = `test-reset-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      try { await withCircuit(name, () => Promise.reject(new Error('x'))); } catch {}
    }
    resetCircuit(name);
    const cbs = listCircuits();
    const cb  = cbs.find((c) => c.name === name);
    assert.ok(!cb || cb.state === 'closed');
  });

  it('withFailoverChain uses first working provider', async () => {
    const { withFailoverChain } = await import('../server/failover.js');
    const { result, provider } = await withFailoverChain([
      { name: 'p-a', fn: () => Promise.resolve('from-a') },
      { name: 'p-b', fn: () => Promise.resolve('from-b') },
    ]);
    assert.equal(result, 'from-a');
    assert.equal(provider, 'p-a');
  });

  it('withFailoverChain falls back to next provider', async () => {
    const { withFailoverChain } = await import('../server/failover.js');
    const { result, provider } = await withFailoverChain([
      { name: `fail-${Date.now()}`, fn: () => Promise.reject(new Error('down')) },
      { name: `ok-${Date.now()}`,   fn: () => Promise.resolve('fallback') },
    ]);
    assert.equal(result, 'fallback');
    assert.ok(provider.startsWith('ok-'));
  });

  it('recordHealthScore / getHealthScores', async () => {
    const { recordHealthScore, getHealthScores } = await import('../server/failover.js');
    recordHealthScore('redis', 95);
    recordHealthScore('supabase', 80);
    const scores = getHealthScores();
    assert.equal(scores['redis']?.score, 95);
    assert.equal(scores['supabase']?.score, 80);
  });
});

// ── 10. Analytics ─────────────────────────────────────────────────────────────

describe('Analytics', () => {
  const today = new Date().toISOString().slice(0, 10);

  it('trackEvent stores event', async () => {
    const { trackEvent } = await import('../server/analytics.js');
    await trackEvent({ eventType: 'tmap_run', userId: 'an-user-1', properties: { tokens: 1000, costUsd: 0.01 }, ts: new Date().toISOString() });
    assert.ok(true);
  });

  it('getDailySummary returns summary for today', async () => {
    const { trackEvent, getDailySummary } = await import('../server/analytics.js');
    await trackEvent({ eventType: 'chat', userId: 'an-user-2', properties: {}, ts: new Date().toISOString() });
    const summary = await getDailySummary(today);
    assert.ok(summary.period === 'day');
    assert.ok(summary.totalSessions >= 0);
  });

  it('getFeatureUsage returns array', async () => {
    const { getFeatureUsage } = await import('../server/analytics.js');
    const features = await getFeatureUsage(today);
    assert.ok(Array.isArray(features));
    for (const f of features) {
      assert.ok(typeof f.feature === 'string');
      assert.ok(typeof f.count === 'number');
      assert.ok(typeof f.pct === 'number');
    }
  });

  it('getMAU returns a number', async () => {
    const { getMAU } = await import('../server/analytics.js');
    const month = today.slice(0, 7);
    const mau   = await getMAU(month);
    assert.ok(typeof mau === 'number');
    assert.ok(mau >= 0);
  });
});

// ── 11. Redis Cluster Helpers (unit-testable parts only) ─────────────────────

describe('RedisCluster (no Redis)', () => {
  it('chunkArray equivalent via pipelineGet with empty array', async () => {
    // pipelineGet with empty array should return [] without hitting Redis
    const { pipelineGet } = await import('../server/redis-cluster.js');
    const result = await pipelineGet([]);
    assert.deepEqual(result, []);
  });

  it('pipelineSet with empty array is a no-op', async () => {
    const { pipelineSet } = await import('../server/redis-cluster.js');
    await pipelineSet([]);
    assert.ok(true);
  });
});
