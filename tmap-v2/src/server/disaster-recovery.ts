// Disaster recovery — incident management, DR health aggregation, RTO/RPO
// tracking, and runbook execution. Incidents are persisted in file-store.

import { randomUUID } from 'node:crypto';
import { fsPut, fsGet, fsList } from './file-store.js';
import { logger } from './logger.js';
import { buildHealthReport } from './health.js';
import { listCircuits } from './failover.js';
import type { Incident, IncidentSeverity, IncidentStatus } from '../types.js';

export type { Incident, IncidentSeverity, IncidentStatus };

const COL_INCIDENTS = 'dr_incidents';

// ── Incident management ───────────────────────────────────────────────────────

export function createIncident(opts: {
  title:            string;
  severity:         IncidentSeverity;
  affectedServices: string[];
  openedBy:         string;
}): Incident {
  const incident: Incident = {
    id:               `inc-${Date.now()}-${randomUUID().slice(0, 8)}`,
    title:            opts.title,
    severity:         opts.severity,
    status:           'open',
    affectedServices: opts.affectedServices,
    openedAt:         new Date().toISOString(),
    notes:            [`Opened by ${opts.openedBy}`],
  };
  fsPut(COL_INCIDENTS, incident.id, incident);
  logger.warn('incident_created', { id: incident.id, severity: opts.severity, title: opts.title });
  return incident;
}

export function updateIncident(
  id: string,
  patch: { status?: IncidentStatus; note?: string },
): Incident | null {
  const existing = fsGet<Incident>(COL_INCIDENTS, id);
  if (!existing) return null;
  const updated: Incident = {
    ...existing,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.status === 'resolved' ? { resolvedAt: new Date().toISOString() } : {}),
    notes: patch.note ? [...existing.notes, `${new Date().toISOString()}: ${patch.note}`] : existing.notes,
  };
  fsPut(COL_INCIDENTS, id, updated);
  logger.info('incident_updated', { id, status: updated.status });
  return updated;
}

export function getIncident(id: string): Incident | null {
  return fsGet<Incident>(COL_INCIDENTS, id);
}

export function listIncidents(filter?: { status?: IncidentStatus; severity?: IncidentSeverity }): Incident[] {
  return fsList<Incident>(COL_INCIDENTS, (i) => {
    if (filter?.status   && i.status   !== filter.status)   return false;
    if (filter?.severity && i.severity !== filter.severity) return false;
    return true;
  }).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

// ── DR health report ──────────────────────────────────────────────────────────

export interface DRStatus {
  healthy:        boolean;
  openIncidents:  number;
  criticalCount:  number;
  services:       Record<string, 'healthy' | 'degraded' | 'down'>;
  circuits:       Array<{ name: string; state: string }>;
  rto:            string;
  rpo:            string;
  checkedAt:      string;
}

export async function getDRStatus(): Promise<DRStatus> {
  const [health, circuits] = await Promise.all([buildHealthReport(), Promise.resolve(listCircuits())]);
  const openIncidents = listIncidents({ status: 'open' });
  const criticalCount = openIncidents.filter((i) => i.severity === 'critical').length;

  const services: Record<string, 'healthy' | 'degraded' | 'down'> = {};
  for (const [svc, dep] of Object.entries(health.deps ?? {})) {
    const s = (dep as { status?: string }).status;
    services[svc] = s === 'ok' ? 'healthy' : s === 'degraded' ? 'degraded' : 'down';
  }

  const openCircuits = circuits.filter((c) => c.state !== 'closed').length;
  if (openCircuits > 0) services['circuits'] = openCircuits > 2 ? 'down' : 'degraded';

  const healthy = criticalCount === 0 && Object.values(services).every((s) => s !== 'down');

  return {
    healthy,
    openIncidents: openIncidents.length,
    criticalCount,
    services,
    circuits: circuits.map((c) => ({ name: c.name, state: c.state })),
    rto: process.env.DR_RTO ?? '15min',
    rpo: process.env.DR_RPO ?? '1h',
    checkedAt: new Date().toISOString(),
  };
}

// ── Runbook steps ──────────────────────────────────────────────────────────────

export interface RunbookStep {
  step:        number;
  title:       string;
  description: string;
  automated:   boolean;
  severity:    IncidentSeverity[];
}

export const DR_RUNBOOK: RunbookStep[] = [
  { step: 1,  title: 'Declare incident',           description: 'Create incident record with severity and affected services', automated: false, severity: ['low','medium','high','critical'] },
  { step: 2,  title: 'Page on-call',               description: 'Notify on-call engineer via PagerDuty/Slack', automated: false, severity: ['high','critical'] },
  { step: 3,  title: 'Assess health',              description: 'Run GET /v1/dr/status to check all service health', automated: true,  severity: ['low','medium','high','critical'] },
  { step: 4,  title: 'Check circuit breakers',     description: 'Review /v1/failover/circuits for open circuits', automated: true,  severity: ['medium','high','critical'] },
  { step: 5,  title: 'Failover Redis',             description: 'Point REDIS_URL to replica; restart workers', automated: false, severity: ['high','critical'] },
  { step: 6,  title: 'Failover database',          description: 'If Supabase unreachable, server auto-falls back to file-store', automated: true,  severity: ['high','critical'] },
  { step: 7,  title: 'Verify backup integrity',    description: 'Run GET /v1/backup and validate latest backup checksum', automated: true,  severity: ['critical'] },
  { step: 8,  title: 'Restore from backup',        description: 'POST /v1/restore with dry-run=true first, then actual restore', automated: false, severity: ['critical'] },
  { step: 9,  title: 'Smoke test',                 description: 'Run GET /v1/health and POST /v1/auth/login to verify recovery', automated: true,  severity: ['low','medium','high','critical'] },
  { step: 10, title: 'Update incident status',     description: 'PATCH /v1/dr/incidents/:id with status=mitigated or resolved', automated: false, severity: ['low','medium','high','critical'] },
  { step: 11, title: 'Post-incident review',       description: 'Document root cause and prevention steps within 24h', automated: false, severity: ['high','critical'] },
];

export function getRunbook(severity?: IncidentSeverity): RunbookStep[] {
  if (!severity) return DR_RUNBOOK;
  return DR_RUNBOOK.filter((s) => s.severity.includes(severity));
}
