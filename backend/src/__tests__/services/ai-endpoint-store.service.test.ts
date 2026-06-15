/**
 * Integration tests for ai-endpoint-store.service — the AI model endpoint CRUD
 * store used by L6 heterogeneous routing. Covers prepare idempotency, default
 * endpoint seeding, tenant isolation, enabled/purpose filtering, and CRUD.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { initDatabase, closeDatabase, getDatabase } from '../../config/database';
import { aiEndpointStoreService } from '../../services/ai-endpoint-store.service';

const testDataDir = path.join(os.tmpdir(), 'aetherguard-ai-endpoint-test-data');
const tenantA = 'tenant-a';
const tenantB = 'tenant-b';

describe('aiEndpointStoreService', () => {
  beforeAll(async () => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
    process.env.DATA_DIR = testDataDir;
    await initDatabase();
    aiEndpointStoreService.prepare();
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    getDatabase().exec('DELETE FROM ai_endpoints');
  });

  it('prepare() is idempotent', () => {
    expect(() => aiEndpointStoreService.prepare()).not.toThrow();
    expect(() => aiEndpointStoreService.prepare()).not.toThrow();
  });

  it('ensureDefaults seeds default endpoints for a tenant', async () => {
    await aiEndpointStoreService.ensureDefaults(tenantA, 'system');
    const endpoints = await aiEndpointStoreService.listEndpoints(tenantA);
    expect(endpoints.length).toBeGreaterThan(0);
    // Defaults are shared across tenants only by call; tenant B starts empty.
    expect(await aiEndpointStoreService.listEndpoints(tenantB)).toEqual([]);
  });

  it('createEndpoint persists a custom endpoint and getEndpoint reads it back', async () => {
    const created = await aiEndpointStoreService.createEndpoint(tenantA, 'admin-1', {
      name: 'My LLM',
      url: 'https://api.example.com/v1',
      modelName: 'gpt-test',
      apiKey: 'sk-secret',
      priority: 5,
      purpose: 'deep_analysis'
    });
    expect(created.id).toMatch(/^custom-/);
    expect(created.tenantId).toBe(tenantA);
    expect(created.createdBy).toBe('admin-1');

    const fetched = await aiEndpointStoreService.getEndpoint(tenantA, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe('My LLM');
    expect(fetched?.modelName).toBe('gpt-test');
    expect(fetched?.apiKey).toBe('sk-secret');
    expect(fetched?.enabled).toBe(true);
    expect(fetched?.priority).toBe(5);
  });

  it('listEndpoints is tenant-scoped', async () => {
    const a1 = await aiEndpointStoreService.createEndpoint(tenantA, 'x', { name: 'A1' });
    const b1 = await aiEndpointStoreService.createEndpoint(tenantB, 'x', { name: 'B1' });
    const inA = await aiEndpointStoreService.listEndpoints(tenantA);
    const inB = await aiEndpointStoreService.listEndpoints(tenantB);
    expect(inA.find((e) => e.id === a1.id)).toBeDefined();
    expect(inA.find((e) => e.id === b1.id)).toBeUndefined();
    expect(inB.find((e) => e.id === b1.id)).toBeDefined();
    expect(inB.find((e) => e.id === a1.id)).toBeUndefined();
  });

  it('listEnabledEndpoints filters by enabled + purpose and sorts by priority', async () => {
    await aiEndpointStoreService.createEndpoint(tenantA, 'x', { name: 'disabled', enabled: false, priority: 1, purpose: 'deep_analysis' });
    await aiEndpointStoreService.createEndpoint(tenantA, 'x', { name: 'triage-low', enabled: true, priority: 20, purpose: 'hot_path' });
    await aiEndpointStoreService.createEndpoint(tenantA, 'x', { name: 'triage-high', enabled: true, priority: 3, purpose: 'hot_path' });
    await aiEndpointStoreService.createEndpoint(tenantA, 'x', { name: 'deep', enabled: true, priority: 5, purpose: 'deep_analysis' });

    const hotPathOnly = await aiEndpointStoreService.listEnabledEndpoints(tenantA, 'hot_path');
    expect(hotPathOnly.map((e) => e.name)).toEqual(['triage-high', 'triage-low']); // sorted by priority asc
    expect(hotPathOnly.every((e) => e.purpose === 'hot_path')).toBe(true);

    const allEnabled = await aiEndpointStoreService.listEnabledEndpoints(tenantA);
    expect(allEnabled.find((e) => e.name === 'disabled')).toBeUndefined(); // excluded
    // allEnabled sorted by priority regardless of purpose
    const priorities = allEnabled.map((e) => e.priority);
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
  });

  it('deleteEndpoint removes the endpoint and returns true; second delete returns false', async () => {
    const created = await aiEndpointStoreService.createEndpoint(tenantA, 'x', { name: 'to-delete' });
    const first = await aiEndpointStoreService.deleteEndpoint(tenantA, created.id);
    expect(first).toBe(true);
    expect(await aiEndpointStoreService.getEndpoint(tenantA, created.id)).toBeNull();
    const second = await aiEndpointStoreService.deleteEndpoint(tenantA, created.id);
    expect(second).toBe(false);
  });

  it('getEndpoint returns null for a missing id', async () => {
    expect(await aiEndpointStoreService.getEndpoint(tenantA, 'nope')).toBeNull();
  });

  it('does not leak endpoints across tenants on get/delete', async () => {
    const created = await aiEndpointStoreService.createEndpoint(tenantA, 'x', { name: 'cross' });
    // tenant B cannot read or delete tenant A's endpoint
    expect(await aiEndpointStoreService.getEndpoint(tenantB, created.id)).toBeNull();
    expect(await aiEndpointStoreService.deleteEndpoint(tenantB, created.id)).toBe(false);
    // still present for tenant A
    expect(await aiEndpointStoreService.getEndpoint(tenantA, created.id)).not.toBeNull();
  });
});
