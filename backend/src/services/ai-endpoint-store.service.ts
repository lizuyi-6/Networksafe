import { randomUUID } from 'crypto';
import { encryptSecret, decryptSecret, isSealedSecret } from '../security/secret-encryption';
import { getDatabase } from '../config/database';
import { postgresShadowStoreService } from './postgres-shadow-store.service';

export type AIEndpointType = 'ollama' | 'openai' | 'custom';
export type AIEndpointPurpose = 'hot_path' | 'deep_analysis';

export interface AIEndpointRecord {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  modelName: string;
  apiKey: string;
  enabled: boolean;
  priority: number;
  timeout: number;
  type: AIEndpointType;
  purpose: AIEndpointPurpose;
  lastTest?: {
    success: boolean;
    latency: number;
    timestamp: string;
  };
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * AUD-07-5: api_key values are sealed (AES-256-GCM envelope) before they
 * touch the database. Sealing an already-sealed value is a no-op so update
 * paths that re-persist an existing key never double-encrypt.
 */
function sealApiKey(value: string): string {
  if (!value || isSealedSecret(value)) return value;
  return encryptSecret(value);
}

function openApiKey(value: string): string {
  if (!value) return '';
  const opened = decryptSecret(value);
  return opened ?? value; // legacy plaintext rows keep working until rotation
}

const DEFAULT_ENDPOINT: Omit<AIEndpointRecord, 'tenantId' | 'createdBy' | 'updatedBy' | 'createdAt' | 'updatedAt'> = {
  id: 'default-laptop',
  name: 'Local Laptop (Ollama)',
  url: 'http://127.0.0.1:11434',
  modelName: 'llama3',
  apiKey: '',
  enabled: true,
  priority: 100,
  timeout: 10000,
  type: 'ollama',
  purpose: 'deep_analysis'
};

function parseJson<T>(value: any, fallback: T): T {
  if (!value || typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeNumber(value: any, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(numeric), min), max);
}

function normalizeBoolean(value: any, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return fallback;
}

function normalizeString(value: any, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeType(value: any, fallback: AIEndpointType = 'custom'): AIEndpointType {
  return value === 'ollama' || value === 'openai' || value === 'custom' ? value : fallback;
}

function normalizePurpose(value: any, fallback: AIEndpointPurpose = 'deep_analysis'): AIEndpointPurpose {
  return value === 'hot_path' || value === 'deep_analysis' ? value : fallback;
}

function parseLastTest(value: any): AIEndpointRecord['lastTest'] {
  const parsed = parseJson<any>(value, null);
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  if (typeof parsed.success !== 'boolean' || typeof parsed.latency !== 'number' || typeof parsed.timestamp !== 'string') {
    return undefined;
  }
  return {
    success: parsed.success,
    latency: parsed.latency,
    timestamp: parsed.timestamp
  };
}

class AIEndpointStoreService {
  private schemaReady = false;

  prepare(): void {
    if (this.schemaReady) {
      return;
    }

    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_endpoints (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        model_name TEXT NOT NULL,
        api_key TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 10,
        timeout INTEGER NOT NULL DEFAULT 15000,
        type TEXT NOT NULL DEFAULT 'custom',
        purpose TEXT NOT NULL DEFAULT 'deep_analysis',
        last_test_json TEXT,
        created_by TEXT,
        updated_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_endpoints_tenant_priority ON ai_endpoints(tenant_id, priority ASC, updated_at DESC);
    `);

    try {
      db.exec(`ALTER TABLE ai_endpoints ADD COLUMN purpose TEXT NOT NULL DEFAULT 'deep_analysis'`);
    } catch (error: any) {
      if (!String(error?.message || '').includes('duplicate column name')) {
        throw error;
      }
    }

    this.schemaReady = true;
  }

  private assertPrepared(): void {
    if (this.schemaReady) {
      return;
    }

    if (process.env.NODE_ENV === 'test') {
      this.prepare();
      return;
    }

    throw new Error('AI endpoint schema not initialized. Call aiEndpointStoreService.prepare() during bootstrap.');
  }

  async ensureDefaults(tenantId: string, actorId = 'system'): Promise<void> {
    this.assertPrepared();
    const existing = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryOne<any>(`
          SELECT id
          FROM ai_endpoints
          WHERE tenant_id = $1 AND id = $2
          LIMIT 1
        `, [tenantId, DEFAULT_ENDPOINT.id])
      : getDatabase().prepare(`
          SELECT id
          FROM ai_endpoints
          WHERE tenant_id = ? AND id = ?
          LIMIT 1
        `).get(tenantId, DEFAULT_ENDPOINT.id) as any;

    if (existing?.id) {
      return;
    }

    const now = new Date().toISOString();
    const row = {
      id: DEFAULT_ENDPOINT.id,
      tenant_id: tenantId,
      name: DEFAULT_ENDPOINT.name,
      url: DEFAULT_ENDPOINT.url,
      model_name: DEFAULT_ENDPOINT.modelName,
      api_key: sealApiKey(DEFAULT_ENDPOINT.apiKey),
      enabled: 1,
      priority: DEFAULT_ENDPOINT.priority,
      timeout: DEFAULT_ENDPOINT.timeout,
      type: DEFAULT_ENDPOINT.type,
      purpose: DEFAULT_ENDPOINT.purpose,
      last_test_json: JSON.stringify({}),
      created_by: actorId,
      updated_by: actorId,
      created_at: now,
      updated_at: now
    };

    if (postgresShadowStoreService.canServeReads()) {
      await postgresShadowStoreService.execute(`
        INSERT INTO ai_endpoints (
          id, tenant_id, name, url, model_name, api_key, enabled, priority,
          timeout, type, purpose, last_test_json, created_by, updated_by, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (id)
        DO NOTHING
      `, [
        row.id,
        row.tenant_id,
        row.name,
        row.url,
        row.model_name,
        row.api_key,
        row.enabled,
        row.priority,
        row.timeout,
        row.type,
        row.purpose,
        row.last_test_json,
        row.created_by,
        row.updated_by,
        row.created_at,
        row.updated_at
      ]);
    }

    getDatabase().prepare(`
      INSERT OR IGNORE INTO ai_endpoints (
        id, tenant_id, name, url, model_name, api_key, enabled, priority,
        timeout, type, purpose, last_test_json, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.tenant_id,
      row.name,
      row.url,
      row.model_name,
      row.api_key,
      row.enabled,
      row.priority,
      row.timeout,
      row.type,
      row.purpose,
      row.last_test_json,
      row.created_by,
      row.updated_by,
      row.created_at,
      row.updated_at
    );

    if (!postgresShadowStoreService.canServeReads()) {
      void postgresShadowStoreService.upsert('ai_endpoints', row);
    }
  }

  async listEndpoints(tenantId: string): Promise<AIEndpointRecord[]> {
    await this.ensureDefaults(tenantId);
    const rows = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryAll<any>(`
          SELECT *
          FROM ai_endpoints
          WHERE tenant_id = $1
          ORDER BY priority ASC, updated_at DESC
        `, [tenantId])
      : getDatabase().prepare(`
          SELECT *
          FROM ai_endpoints
          WHERE tenant_id = ?
          ORDER BY priority ASC, updated_at DESC
        `).all(tenantId) as any[];

    return rows.map((row) => this.mapRow(row));
  }

  async getEndpoint(tenantId: string, id: string): Promise<AIEndpointRecord | null> {
    await this.ensureDefaults(tenantId);
    const row = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryOne<any>(`
          SELECT *
          FROM ai_endpoints
          WHERE tenant_id = $1 AND id = $2
          LIMIT 1
        `, [tenantId, id])
      : getDatabase().prepare(`
          SELECT *
          FROM ai_endpoints
          WHERE tenant_id = ? AND id = ?
          LIMIT 1
        `).get(tenantId, id) as any;

    return row ? this.mapRow(row) : null;
  }

  async createEndpoint(
    tenantId: string,
    actorId: string,
    payload: Partial<Pick<AIEndpointRecord, 'name' | 'url' | 'modelName' | 'apiKey' | 'enabled' | 'priority' | 'timeout' | 'type' | 'purpose'>>
  ): Promise<AIEndpointRecord> {
    await this.ensureDefaults(tenantId, actorId);
    const now = new Date().toISOString();
    const row = {
      id: `custom-${randomUUID()}`,
      tenant_id: tenantId,
      name: normalizeString(payload.name, 'Custom Endpoint'),
      url: normalizeString(payload.url, ''),
      model_name: normalizeString(payload.modelName, 'default'),
      api_key: sealApiKey(normalizeString(payload.apiKey, '')),
      enabled: normalizeBoolean(payload.enabled, true) ? 1 : 0,
      priority: normalizeNumber(payload.priority, 10, 1, 10000),
      timeout: normalizeNumber(payload.timeout, 15000, 1000, 120000),
      type: normalizeType(payload.type, 'custom'),
      purpose: normalizePurpose(payload.purpose, 'deep_analysis'),
      last_test_json: JSON.stringify({}),
      created_by: actorId,
      updated_by: actorId,
      created_at: now,
      updated_at: now
    };

    if (postgresShadowStoreService.canServeReads()) {
      await postgresShadowStoreService.execute(`
        INSERT INTO ai_endpoints (
          id, tenant_id, name, url, model_name, api_key, enabled, priority,
          timeout, type, purpose, last_test_json, created_by, updated_by, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      `, [
        row.id,
        row.tenant_id,
        row.name,
        row.url,
        row.model_name,
        row.api_key,
        row.enabled,
        row.priority,
        row.timeout,
        row.type,
        row.purpose,
        row.last_test_json,
        row.created_by,
        row.updated_by,
        row.created_at,
        row.updated_at
      ]);
    }

    getDatabase().prepare(`
      INSERT INTO ai_endpoints (
        id, tenant_id, name, url, model_name, api_key, enabled, priority,
        timeout, type, purpose, last_test_json, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.tenant_id,
      row.name,
      row.url,
      row.model_name,
      row.api_key,
      row.enabled,
      row.priority,
      row.timeout,
      row.type,
      row.purpose,
      row.last_test_json,
      row.created_by,
      row.updated_by,
      row.created_at,
      row.updated_at
    );

    if (!postgresShadowStoreService.canServeReads()) {
      void postgresShadowStoreService.upsert('ai_endpoints', row);
    }

    return this.mapRow(row);
  }

  async updateEndpoint(
    tenantId: string,
    id: string,
    actorId: string,
    patch: Partial<Pick<AIEndpointRecord, 'name' | 'url' | 'modelName' | 'apiKey' | 'enabled' | 'priority' | 'timeout' | 'type' | 'purpose' | 'lastTest'>>
  ): Promise<AIEndpointRecord | null> {
    const existing = await this.getEndpoint(tenantId, id);
    if (!existing) {
      return null;
    }

    const updated = {
      ...existing,
      name: patch.name !== undefined ? normalizeString(patch.name, existing.name) : existing.name,
      url: patch.url !== undefined ? normalizeString(patch.url, existing.url) : existing.url,
      modelName: patch.modelName !== undefined ? normalizeString(patch.modelName, existing.modelName) : existing.modelName,
      apiKey: patch.apiKey !== undefined && patch.apiKey !== '******' ? normalizeString(patch.apiKey, existing.apiKey) : existing.apiKey,
      enabled: patch.enabled !== undefined ? normalizeBoolean(patch.enabled, existing.enabled) : existing.enabled,
      priority: patch.priority !== undefined ? normalizeNumber(patch.priority, existing.priority, 1, 10000) : existing.priority,
      timeout: patch.timeout !== undefined ? normalizeNumber(patch.timeout, existing.timeout, 1000, 120000) : existing.timeout,
      type: patch.type !== undefined ? normalizeType(patch.type, existing.type) : existing.type,
      purpose: patch.purpose !== undefined ? normalizePurpose(patch.purpose, existing.purpose) : existing.purpose,
      lastTest: patch.lastTest !== undefined ? patch.lastTest : existing.lastTest,
      updatedBy: actorId,
      updatedAt: new Date().toISOString()
    };

    const row = {
      id: updated.id,
      tenant_id: updated.tenantId,
      name: updated.name,
      url: updated.url,
      model_name: updated.modelName,
      api_key: sealApiKey(updated.apiKey),
      enabled: updated.enabled ? 1 : 0,
      priority: updated.priority,
      timeout: updated.timeout,
      type: updated.type,
      purpose: updated.purpose,
      last_test_json: JSON.stringify(updated.lastTest || {}),
      created_by: updated.createdBy || actorId,
      updated_by: actorId,
      created_at: updated.createdAt,
      updated_at: updated.updatedAt
    };

    if (postgresShadowStoreService.canServeReads()) {
      await postgresShadowStoreService.execute(`
        UPDATE ai_endpoints
        SET
          name = $1,
          url = $2,
          model_name = $3,
          api_key = $4,
          enabled = $5,
          priority = $6,
          timeout = $7,
          type = $8,
          purpose = $9,
          last_test_json = $10,
          updated_by = $11,
          updated_at = $12
        WHERE tenant_id = $13 AND id = $14
      `, [
        row.name,
        row.url,
        row.model_name,
        row.api_key,
        row.enabled,
        row.priority,
        row.timeout,
        row.type,
        row.purpose,
        row.last_test_json,
        row.updated_by,
        row.updated_at,
        tenantId,
        id
      ]);
    }

    getDatabase().prepare(`
      UPDATE ai_endpoints
      SET
        name = ?,
        url = ?,
        model_name = ?,
        api_key = ?,
        enabled = ?,
        priority = ?,
        timeout = ?,
        type = ?,
        purpose = ?,
        last_test_json = ?,
        updated_by = ?,
        updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `).run(
      row.name,
      row.url,
      row.model_name,
      row.api_key,
      row.enabled,
      row.priority,
      row.timeout,
      row.type,
      row.purpose,
      row.last_test_json,
      row.updated_by,
      row.updated_at,
      tenantId,
      id
    );

    if (!postgresShadowStoreService.canServeReads()) {
      void postgresShadowStoreService.upsert('ai_endpoints', row);
    }

    return updated;
  }

  async deleteEndpoint(tenantId: string, id: string): Promise<boolean> {
    if (id === DEFAULT_ENDPOINT.id) {
      return false;
    }

    const existing = await this.getEndpoint(tenantId, id);
    if (!existing) {
      return false;
    }

    if (postgresShadowStoreService.canServeReads()) {
      await postgresShadowStoreService.execute(`
        DELETE FROM ai_endpoints
        WHERE tenant_id = $1 AND id = $2
      `, [tenantId, id]);
    }

    getDatabase().prepare(`
      DELETE FROM ai_endpoints
      WHERE tenant_id = ? AND id = ?
    `).run(tenantId, id);

    return true;
  }

  async listEnabledEndpoints(tenantId: string, purpose?: AIEndpointPurpose): Promise<AIEndpointRecord[]> {
    const endpoints = await this.listEndpoints(tenantId);
    return endpoints
      .filter((endpoint) => endpoint.enabled && (!purpose || endpoint.purpose === purpose))
      .sort((a, b) => a.priority - b.priority);
  }

  private mapRow(row: any): AIEndpointRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      url: row.url,
      modelName: row.model_name,
      apiKey: openApiKey(row.api_key || ''),
      enabled: Boolean(row.enabled),
      priority: Number(row.priority || 10),
      timeout: Number(row.timeout || 15000),
      type: normalizeType(row.type, 'custom'),
      purpose: normalizePurpose(row.purpose, 'deep_analysis'),
      lastTest: parseLastTest(row.last_test_json),
      createdBy: row.created_by || undefined,
      updatedBy: row.updated_by || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export const aiEndpointStoreService = new AIEndpointStoreService();
