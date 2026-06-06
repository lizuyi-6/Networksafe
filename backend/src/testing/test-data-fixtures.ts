/**
 * Test Data Fixtures
 *
 * Provides standardized test data generation for testing.
 * All test data is generated with sensible defaults and can be customized.
 */

import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';

/**
 * User data interface
 */
export interface TestUserData {
  id?: string;
  email?: string;
  username?: string;
  password?: string;
  password_hash?: string;
  role?: 'admin' | 'tenant' | 'viewer';
  plan?: 'starter' | 'pro' | 'ultra';
  tenant_id?: string;
  status?: 'active' | 'suspended' | 'pending';
}

/**
 * Agent data interface
 */
export interface TestAgentData {
  id?: string;
  hostname?: string;
  platform?: string;
  arch?: string;
  version?: string;
  status?: 'online' | 'offline';
  lastHeartbeat?: string;
}

/**
 * Alert data interface
 */
export interface TestAlertData {
  id?: number;
  type?: string;
  severity?: 'info' | 'warning' | 'critical';
  source?: string;
  message?: string;
  details?: string;
  acknowledged?: boolean;
}

/**
 * Site data interface
 */
export interface TestSiteData {
  id?: number;
  domain?: string;
  target?: string;
  sslEnabled?: boolean;
  antiBotEnabled?: boolean;
  rateLimitEnabled?: boolean;
  rateLimitRequests?: number;
  concurrencyEnabled?: boolean;
  concurrencyMax?: number;
  tenant_id?: string;
}

/**
 * Device data interface
 */
export interface TestDeviceData {
  id?: string;
  device_type?: string;
  mac_address?: string;
  firmware_version?: string;
  status?: 'online' | 'offline';
  config?: string;
}

/**
 * Seed options interface
 */
export interface SeedOptions {
  users?: number;
  agents?: number;
  alerts?: number;
  sites?: number;
  devices?: number;
  tenantId?: string;
}

/**
 * TestDataFixtures
 *
 * Generates standardized test data for testing.
 */
export class TestDataFixtures {
  /**
   * Create a test user
   *
   * @param overrides - Custom user data
   * @returns User data object
   */
  public static createTestUser(overrides: TestUserData = {}): TestUserData & { password_hash: string } {
    const userId = overrides.id || uuidv4();
    const email = overrides.email || `test-${userId.substring(0, 8)}@example.com`;
    const password = overrides.password || 'TestPassword123!';

    return {
      id: userId,
      email,
      username: overrides.username || `testuser-${userId.substring(0, 8)}`,
      password,
      password_hash: overrides.password_hash || bcrypt.hashSync(password, 10),
      role: overrides.role || 'viewer',
      plan: overrides.plan || 'starter',
      tenant_id: overrides.tenant_id || undefined,
      status: overrides.status || 'active',
      ...overrides
    };
  }

  /**
   * Create a test agent
   *
   * @param overrides - Custom agent data
   * @returns Agent data object
   */
  public static createTestAgent(overrides: TestAgentData = {}): TestAgentData {
    const agentId = overrides.id || uuidv4();

    return {
      id: agentId,
      hostname: overrides.hostname || `test-agent-${agentId.substring(0, 8)}`,
      platform: overrides.platform || 'linux',
      arch: overrides.arch || 'x64',
      version: overrides.version || '1.0.0',
      status: overrides.status || 'offline',
      lastHeartbeat: overrides.lastHeartbeat || new Date().toISOString(),
      ...overrides
    };
  }

  /**
   * Create a test alert
   *
   * @param overrides - Custom alert data
   * @returns Alert data object
   */
  public static createTestAlert(overrides: TestAlertData = {}): TestAlertData {
    return {
      type: overrides.type || 'security',
      severity: overrides.severity || 'info',
      source: overrides.source || '192.168.1.100',
      message: overrides.message || 'Test alert message',
      details: overrides.details || JSON.stringify({ test: true }),
      acknowledged: overrides.acknowledged || false,
      ...overrides
    };
  }

  /**
   * Create a test site
   *
   * @param overrides - Custom site data
   * @returns Site data object
   */
  public static createTestSite(overrides: TestSiteData = {}): TestSiteData {
    const domain = overrides.domain || `test-${Date.now()}.example.com`;

    return {
      domain,
      target: overrides.target || `https://${domain}`,
      sslEnabled: overrides.sslEnabled !== undefined ? overrides.sslEnabled : true,
      antiBotEnabled: overrides.antiBotEnabled !== undefined ? overrides.antiBotEnabled : true,
      rateLimitEnabled: overrides.rateLimitEnabled !== undefined ? overrides.rateLimitEnabled : true,
      rateLimitRequests: overrides.rateLimitRequests || 60,
      concurrencyEnabled: overrides.concurrencyEnabled !== undefined ? overrides.concurrencyEnabled : true,
      concurrencyMax: overrides.concurrencyMax || 5,
      tenant_id: overrides.tenant_id || undefined,
      ...overrides
    };
  }

  /**
   * Create a test device
   *
   * @param overrides - Custom device data
   * @returns Device data object
   */
  public static createTestDevice(overrides: TestDeviceData = {}): TestDeviceData {
    const deviceId = overrides.id || uuidv4();

    return {
      id: deviceId,
      device_type: overrides.device_type || 'esp32',
      mac_address: overrides.mac_address || `AA:BB:CC:DD:EE:${Math.floor(Math.random() * 99).toString().padStart(2, '0')}`,
      firmware_version: overrides.firmware_version || '1.0.0',
      status: overrides.status || 'offline',
      config: overrides.config || JSON.stringify({ mode: 'test' }),
      ...overrides
    };
  }

  /**
   * Seed test data into database
   *
   * @param db - Database instance
   * @param options - Seed options
   * @returns Object with created data
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static seedTestData(db: any, options: SeedOptions = {}): {
    users: TestUserData[];
    agents: TestAgentData[];
    alerts: TestAlertData[];
    sites: TestSiteData[];
    devices: TestDeviceData[];
  } {
    const users: TestUserData[] = [];
    const agents: TestAgentData[] = [];
    const alerts: TestAlertData[] = [];
    const sites: TestSiteData[] = [];
    const devices: TestDeviceData[] = [];

    // Seed users
    const userCount = options.users || 0;
    for (let i = 0; i < userCount; i++) {
      const user = TestDataFixtures.createTestUser({
        tenant_id: options.tenantId,
        role: i === 0 ? 'admin' : i === 1 ? 'tenant' : 'viewer'
      });
      users.push(user);

      db.run(
        `INSERT INTO users (id, email, username, password_hash, role, plan, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          user.email,
          user.username,
          user.password_hash,
          user.role,
          user.plan,
          user.tenant_id,
          user.status
        ]
      );
    }

    // Seed agents
    const agentCount = options.agents || 0;
    for (let i = 0; i < agentCount; i++) {
      const agent = TestDataFixtures.createTestAgent({
        status: i < agentCount / 2 ? 'online' : 'offline'
      });
      agents.push(agent);

      db.run(
        `INSERT INTO agents (id, hostname, platform, arch, version, status, lastHeartbeat)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          agent.id,
          agent.hostname,
          agent.platform,
          agent.arch,
          agent.version,
          agent.status,
          agent.lastHeartbeat
        ]
      );
    }

    // Seed alerts
    const alertCount = options.alerts || 0;
    for (let i = 0; i < alertCount; i++) {
      const alert = TestDataFixtures.createTestAlert({
        severity: i % 3 === 0 ? 'critical' : i % 3 === 1 ? 'warning' : 'info'
      });
      alerts.push(alert);

      db.run(
        `INSERT INTO alerts (type, severity, source, message, details, acknowledged)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          alert.type,
          alert.severity,
          alert.source,
          alert.message,
          alert.details,
          alert.acknowledged ? 1 : 0
        ]
      );
    }

    // Seed sites
    const siteCount = options.sites || 0;
    for (let i = 0; i < siteCount; i++) {
      const site = TestDataFixtures.createTestSite({
        tenant_id: options.tenantId
      });
      sites.push(site);

      db.run(
        `INSERT INTO sites (domain, target, sslEnabled, antiBotEnabled, rateLimitEnabled, rateLimitRequests, concurrencyEnabled, concurrencyMax, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          site.domain,
          site.target,
          site.sslEnabled ? 1 : 0,
          site.antiBotEnabled ? 1 : 0,
          site.rateLimitEnabled ? 1 : 0,
          site.rateLimitRequests,
          site.concurrencyEnabled ? 1 : 0,
          site.concurrencyMax,
          site.tenant_id
        ]
      );
    }

    // Seed devices
    const deviceCount = options.devices || 0;
    for (let i = 0; i < deviceCount; i++) {
      const device = TestDataFixtures.createTestDevice({
        status: i < deviceCount / 2 ? 'online' : 'offline'
      });
      devices.push(device);

      db.run(
        `INSERT INTO devices (id, device_type, mac_address, firmware_version, status, config)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          device.id,
          device.device_type,
          device.mac_address,
          device.firmware_version,
          device.status,
          device.config
        ]
      );
    }

    return { users, agents, alerts, sites, devices };
  }

  /**
   * Clear all data from database tables
   *
   * @param db - Database instance
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static clearAllData(db: any): void {
    const tables = [
      'alerts',
      'metrics',
      'scan_results',
      'security_rules',
      'api_keys',
      'devices',
      'agents',
      'agent_registrations',
      'sites',
      'users',
      'backups'
    ];

    for (const table of tables) {
      db.run(`DELETE FROM ${table}`);
    }
  }
}
