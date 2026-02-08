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
}

export interface AuthenticatedAgent {
  agentId: string;
  hostname: string;
  platform: string;
}

/**
 * Generate a secure random API key
 */
function generateApiKey(): string {
  return `agent_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Generate a secret key for HMAC signing
 */
function generateSecretKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create machine fingerprint from provided info
 */
function createFingerprint(info: { hostname: string; platform: string; mac?: string }): string {
  const data = `${info.hostname}|${info.platform}|${info.mac || 'unknown'}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Agent Authentication Service
 */
export class AgentAuthService {
  private readonly CACHE_TTL = 3600; // 1 hour

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
    const registrationSuccess = db.transaction(() => {
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
      db.prepare(`
        INSERT INTO agent_registrations (
          agent_id, hostname, api_key_hash, secret_key, fingerprint,
          platform, status, created_at, tenant_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        registration.agentId,
        registration.hostname,
        hashApiKey(registration.apiKey),
        registration.secretKey,
        JSON.stringify(registration.fingerprint),
        registration.platform,
        registration.status,
        registration.createdAt,
        info.tenantId || null
      );

      return { registration, apiKey };
    })(true); // Execute transaction immediately with deferred=false

    // Check if transaction was successful
    if (!registrationSuccess || typeof registrationSuccess === 'symbol') {
      // If transaction failed (returned true but no data), try again once
      logger.warn('Agent registration transaction returned unexpected result, retrying...');
      throw new Error('Agent registration failed due to concurrent registration. Please try again.');
    }

    const { registration, apiKey } = registrationSuccess as { registration: AgentRegistration; apiKey: string };
      agentId,
      sanitizedHostname, // Use sanitized value
      this.hashApiKey(apiKey),
      secretKey,
      fingerprint,
      info.platform,
      'approved',
      registration.createdAt,
      info.tenantId || 'default'
    );

    logger.info(`Agent registered: ${agentId} (${sanitizedHostname})`);

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
      const result = db.prepare(`
        SELECT agent_id, hostname, platform, api_key_hash, status
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
        platform: result.platform
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

    return result?.secret_key || null;
  }

  /**
   * Revoke agent credentials
   */
  revokeAgent(agentId: string): boolean {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE agent_registrations
      SET status = 'revoked', updated_at = datetime('now')
      WHERE agent_id = ?
    `).run(agentId);

    // Clear cache
    redisService.del(`agent:auth:${agentId}`);

    logger.warn(`Agent revoked: ${agentId}`);
    return result.changes > 0;
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
      SELECT agent_id, hostname, platform, status, created_at, last_seen_at
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
