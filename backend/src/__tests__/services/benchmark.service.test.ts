/**
 * Integration tests for benchmark.service — DB-backed query/mapping contract.
 *
 * runScenario() drives heavy external dependencies (fastpath, axios, rate
 * limiters, child processes), so it is out of scope here. Instead we verify the
 * persistence contract that matters for the dashboard/history view: prepare()
 * is idempotent, listHistory/getRun read from benchmark_runs, mapRow coerces
 * numeric/JSON columns correctly, and missing rows return null/[].
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { initDatabase, closeDatabase, getDatabase } from '../../config/database';
import { platformConfigService } from '../../services/platform-config.service';
import { benchmarkService } from '../../services/benchmark.service';

const testDataDir = path.join(os.tmpdir(), 'aetherguard-benchmark-test-data');
const tenantId = 'tenant-bench';

function insertRun(overrides: Partial<Record<string, unknown>> = {}) {
  const db = getDatabase();
  const id = String(overrides.id || `run-${Math.random().toString(36).slice(2, 8)}`);
  db.prepare(`
    INSERT INTO benchmark_runs (
      id, tenant_id, scenario, qps, p95_latency_ms, agent_cpu_pct,
      agent_memory_mb, local_ai_latency_ms, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(overrides.tenant_id || tenantId),
    String(overrides.scenario || 'full-suite'),
    overrides.qps ?? null,
    overrides.p95_latency_ms ?? null,
    overrides.agent_cpu_pct ?? null,
    overrides.agent_memory_mb ?? null,
    overrides.local_ai_latency_ms ?? null,
    overrides.metadata_json ?? JSON.stringify({ profile: 'dev-smoke', note: 'x' }),
    overrides.created_at ?? new Date().toISOString()
  );
  return id;
}

describe('benchmarkService persistence', () => {
  beforeAll(async () => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
    process.env.DATA_DIR = testDataDir;
    await initDatabase();
    platformConfigService.prepare(); // creates benchmark_runs table
    benchmarkService.prepare();
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    getDatabase().exec('DELETE FROM benchmark_runs');
  });

  it('prepare() is idempotent (calling twice does not throw)', () => {
    expect(() => benchmarkService.prepare()).not.toThrow();
    expect(() => benchmarkService.prepare()).not.toThrow();
  });

  it('listHistory returns [] when there are no runs', async () => {
    const rows = await benchmarkService.listHistory(tenantId);
    expect(rows).toEqual([]);
  });

  it('listHistory returns runs newest-first and respects tenant scoping', async () => {
    insertRun({ id: 'r1', created_at: '2026-01-01T00:00:00Z' });
    insertRun({ id: 'r2', created_at: '2026-02-01T00:00:00Z' });
    insertRun({ id: 'r3', tenant_id: 'other-tenant', created_at: '2026-03-01T00:00:00Z' });

    const rows = await benchmarkService.listHistory(tenantId);
    expect(rows.map((r) => r.id)).toEqual(['r2', 'r1']); // DESC, other-tenant excluded
  });

  it('listHistory honors the limit', async () => {
    for (let i = 0; i < 5; i++) insertRun({ id: `lim-${i}` });
    const rows = await benchmarkService.listHistory(tenantId, 2);
    expect(rows).toHaveLength(2);
  });

  it('getRun returns null for a missing id', async () => {
    expect(await benchmarkService.getRun(tenantId, 'does-not-exist')).toBeNull();
  });

  it('mapRow coerces numeric columns and parses the report JSON', async () => {
    insertRun({
      id: 'coerce-1',
      qps: 1329.79,
      p95_latency_ms: 21,
      agent_cpu_pct: 6.22,
      agent_memory_mb: 99.64,
      local_ai_latency_ms: null,
      metadata_json: JSON.stringify({ profile: 'prod-stress', extra: true })
    });
    const run = await benchmarkService.getRun(tenantId, 'coerce-1');
    expect(run).not.toBeNull();
    expect(run?.qps).toBeCloseTo(1329.79, 2);
    expect(run?.p95LatencyMs).toBe(21);
    expect(run?.agentCpuPct).toBeCloseTo(6.22, 2);
    expect(run?.agentMemoryMb).toBeCloseTo(99.64, 2);
    expect(run?.localAiLatencyMs).toBeNull();
    expect(run?.report).toMatchObject({ profile: 'prod-stress', extra: true });
    expect(run?.scenario).toBe('full-suite');
  });

  it('mapRow keeps null numerics as null (no NaN coercion)', async () => {
    insertRun({ id: 'nulls-1', qps: null, p95_latency_ms: null });
    const run = await benchmarkService.getRun(tenantId, 'nulls-1');
    expect(run?.qps).toBeNull();
    expect(run?.p95LatencyMs).toBeNull();
  });

  it('mapRow survives malformed report JSON (returns {} fallback)', async () => {
    insertRun({ id: 'badjson-1', metadata_json: 'not-json{' });
    const run = await benchmarkService.getRun(tenantId, 'badjson-1');
    expect(run?.report).toEqual({});
  });
});
