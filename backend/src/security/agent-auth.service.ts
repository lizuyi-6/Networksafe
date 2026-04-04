/**
 * Agent Authentication Service
 * SECURE FIX: Server-side agent registration and authentication
 * Prevents agent impersonation by maintaining a registry of authorized agents
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';
import redisService from './redis.service';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
// SECURITY FIX CVE-2026-013: Use environment variable for salt or generate random salt
const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT || '';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export function getEncryptionKey(): Buffer {
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  // SECURITY FIX: Require ENCRYPTION_SALT to be set - no fallback allowed
  if (!ENCRYPTION_SALT) {
    throw new Error('ENCRYPTION_SALT environment variable is required - no fallback allowed');
  }
  
  const key = crypto.scryptSync(ENCRYPTION_KEY, ENCRYPTION_SALT, KEY_LENGTH);
  return key;
}

export function encryptSecretKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decryptSecretKey(encryptedData: string): string {
  const key = getEncryptionKey();
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export interface AgentRegistration {
  agentId: string;
  hostname: string;
  apiKey: string;
  secretKey: string; // For HMAC signing
  fingerprint: string; // Machine fingerprint
  platform: string;
  status: 'pending' | 'approved' | 'revoked';
  createdAt: string;
  lastSeenAt?: string;
  tenantId?: string;
}

export interface AuthenticatedAgent {
  agentId: string;
  hostname: string;
  platform: string;
  tenantId?: string;
}

/**
 * Generate a secure random API key
 */
export function generateApiKey(): string {
  return `agent_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Generate a secret key for HMAC signing
 */
export function generateSecretKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create machine fingerprint from provided info
 */
export function createFingerprint(info: { hostname: string; platform: string; mac?: string }): string {
  const data = `${info.hostname}|${info.platform}|${info.mac || 'unknown'}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Agent Authentication Service
 */
export class AgentAuthService {
  private readonly CACHE_TTL = 3600; // 1 hour
  private agentRegistrationColumns: Set<string> | null = null;

  private getAgentRegistrationColumns(): Set<string> {
    if (this.agentRegistrationColumns) return this.agentRegistrationColumns;
    const db = getDatabase();
    const rows = db.prepare(`PRAGMA table_info(agent_registrations)`).all() as any[];
    this.agentRegistrationColumns = new Set(rows.map((r) => String(r.name)));
    return this.agentRegistrationColumns;
  }

  /**
   * Register a new agent (admin operation)
   * Server generates unique agentId and credentials
   * SECURITY FIX CVE-2026-100: Validate hostname, prevent race condition
   */
  registerAgent(info: {
    hostname: string;
    platform: string;
    mac?: string;
    tenantId?: string;
  }): AgentRegistration {
    // SECURITY FIX CVE-2026-100: Validate and sanitize hostname
    const sanitizedHostname = this.sanitizeHostname(info.hostname);

    if (!sanitizedHostname) {
      throw new Error('Invalid hostname: must be 1-253 alphanumeric characters, dots, or hyphens');
    }

    const db = getDatabase();

    // SECURITY FIX CVE-2026-101: Use transaction to prevent race condition
    // This prevents duplicate hostname registrations under high concurrency
    const registrationSuccess = db.transaction<{ registration: AgentRegistration; apiKey: string } | null>(() => {
      // Check for existing hostname (within transaction)
      const existing = db.prepare(`
        SELECT agent_id FROM agent_registrations WHERE hostname = ?
      `).get(sanitizedHostname);

      if (existing) {
        // Throw error to rollback transaction
        throw new Error(`Hostname '${sanitizedHostname}' is already registered`);
      }

      // Generate unique agent ID (server-controlled)
      const agentId = `agent-${uuidv4()}`;

      // Generate credentials
      const apiKey = generateApiKey();
      const secretKey = generateSecretKey();

      // Create fingerprint
      const fingerprint = createFingerprint({
        hostname: sanitizedHostname,
        platform: info.platform,
        mac: info.mac
      });

      const registration: AgentRegistration = {
        agentId,
        hostname: sanitizedHostname,
        apiKey,
        secretKey,
        fingerprint,
        platform: info.platform,
        status: 'approved', // Auto-approve for registered agents
        createdAt: new Date().toISOString()
      };

      // SECURITY FIX CVE-2026-100: Parameterized query - hostname already sanitized
      const cols = this.getAgentRegistrationColumns();
      const encryptedSecretKey = encryptSecretKey(registration.secretKey);
      if (cols.has('tenant_id')) {
        db.prepare(`
          INSERT INTO agent_registrations (
            agent_id, hostname, api_key_hash, secret_key, fingerprint,
            platform, status, created_at, tenant_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          registration.agentId,
          registration.hostname,
          this.hashApiKey(registration.apiKey),
          encryptedSecretKey,
          JSON.stringify(registration.fingerprint),
          registration.platform,
          registration.status,
          registration.createdAt,
          info.tenantId || null
        );
      } else {
        db.prepare(`
          INSERT INTO agent_registrations (
            agent_id, hostname, api_key_hash, secret_key, fingerprint,
            platform, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          registration.agentId,
          registration.hostname,
          this.hashApiKey(registration.apiKey),
          encryptedSecretKey,
          JSON.stringify(registration.fingerprint),
          registration.platform,
          registration.status,
          registration.createdAt
        );
      }

      return { registration, apiKey };
    });

    // Check if transaction was successful
    if (!registrationSuccess || typeof registrationSuccess === 'symbol') {
      // If transaction failed (returned true but no data), try again once
      logger.warn('Agent registration transaction returned unexpected result, retrying...');
      throw new Error('Agent registration failed due to concurrent registration. Please try again.');
    }

    const { registration, apiKey } = registrationSuccess as { registration: AgentRegistration; apiKey: string };

    logger.info(`Agent registered: ${registration.agentId} (${sanitizedHostname})`);

    return registration;
  }

  /**
   * SECURITY FIX CVE-2026-100: Sanitize hostname to prevent SQL injection
   */
  private sanitizeHostname(hostname: string): string | null {
    if (typeof hostname !== 'string') {
      return null;
    }

    // Remove any characters that aren't alphanumeric, hyphen, or dot
    const sanitized = hostname.replace(/[^a-zA-Z0-9.-]/g, '');

    // Validate length
    if (sanitized.length < 1 || sanitized.length > 253) {
      return null;
    }

    // Prevent path traversal
    if (sanitized.includes('..') || sanitized.startsWith('/') || sanitized.startsWith('.')) {
      return null;
    }

    return sanitized;
  }

  /**
   * Verify agent credentials on connection
   */
  async verifyAgent(agentId: string, apiKey: string): Promise<AuthenticatedAgent | null> {
    try {
      // Check cache first
      const cacheKey = `agent:auth:${agentId}`;
      const cached = await redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Check database
      const db = getDatabase();
      const cols = this.getAgentRegistrationColumns();
      const tenantSelect = cols.has('tenant_id') ? ', tenant_id' : '';
      const result = db.prepare(`
        SELECT agent_id, hostname, platform, api_key_hash, status${tenantSelect}
        FROM agent_registrations
        WHERE agent_id = ? AND status = 'approved'
      `).get(agentId) as any;

      if (!result) {
        logger.warn(`Agent not found or not approved: ${agentId}`);
        return null;
      }

      // Verify API key
      if (!this.verifyApiKeyHash(apiKey, result.api_key_hash)) {
        logger.warn(`Invalid API key for agent: ${agentId}`);
        return null;
      }

      const agent: AuthenticatedAgent = {
        agentId: result.agent_id,
        hostname: result.hostname,
        platform: result.platform,
        tenantId: result.tenant_id || undefined
      };

      // Cache successful authentication
      await redisService.set(cacheKey, JSON.stringify(agent), this.CACHE_TTL);

      return agent;
    } catch (error: any) {
      logger.error('Agent verification error', { error, agentId });
      return null;
    }
  }

  /**
   * Get agent's secret key for command signing
   */
  getAgentSecretKey(agentId: string): string | null {
    const db = getDatabase();
    const result = db.prepare(`
      SELECT secret_key FROM agent_registrations
      WHERE agent_id = ? AND status = 'approved'
    `).get(agentId) as any;

    if (!result?.secret_key) {
      return null;
    }

    try {
      return decryptSecretKey(result.secret_key);
    } catch (error) {
      logger.error('Failed to decrypt secret key', { error, agentId });
      return null;
    }
  }

  /**
   * Revoke agent credentials
   */
  revokeAgent(agentId: string): boolean {
    const db = getDatabase();
    db.prepare(`
      UPDATE agent_registrations
      SET status = 'revoked'
      WHERE agent_id = ?
    `).run(agentId);

    // Clear cache
    redisService.del(`agent:auth:${agentId}`);

    logger.warn(`Agent revoked: ${agentId}`);
    return true;
  }

  /**
   * Update last seen timestamp
   */
  async updateLastSeen(agentId: string): Promise<void> {
    const db = getDatabase();
    db.prepare(`
      UPDATE agent_registrations
      SET last_seen_at = datetime('now')
      WHERE agent_id = ?
    `).run(agentId);
  }

  /**
   * List all registered agents
   */
  listAgents(): AgentRegistration[] {
    const db = getDatabase();
    const results = db.prepare(`
      SELECT agent_id, hostname, platform, status, created_at, last_seen_at, tenant_id
      FROM agent_registrations
      ORDER BY created_at DESC
    `).all() as any[];

    return results.map(r => ({
      agentId: r.agent_id,
      hostname: r.hostname,
      platform: r.platform,
      status: r.status,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      tenantId: r.tenant_id || undefined,
      apiKey: '', // Never return API keys
      secretKey: '',
      fingerprint: ''
    }));
  }

  /**
   * Hash API key for storage
   */
  private hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Verify API key against hash
   */
  private verifyApiKeyHash(apiKey: string, hash: string): boolean {
    const computed = this.hashApiKey(apiKey);
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(hash, 'hex')
    );
  }
}

export default new AgentAuthService();
