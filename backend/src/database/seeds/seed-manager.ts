/**
 * Seed Manager
 *
 * Manages database seeding with APP_MODE-based control.
 * Ensures seed operations are only allowed in demo mode.
 */

import { getDatabase, DatabaseManager } from '../../config/database';
import { isDemoMode } from '../../config/app-mode';
import { seedDatabase } from './demo_data';
import logger from '../../utils/logger';

/**
 * Seed options
 */
export interface SeedOptions {
  /**
   * Clear existing data before seeding
   */
  clearExisting?: boolean;

  /**
   * Enable verbose logging
   */
  verbose?: boolean;

  /**
   * Force seed even in production mode (DANGEROUS - use with caution)
   */
  force?: boolean;
}

/**
 * Seed status
 */
export interface SeedStatus {
  /**
   * Whether seeding is allowed
   */
  canSeed: boolean;

  /**
   * Current APP_MODE
   */
  appMode: 'production' | 'demo';

  /**
   * Whether auto-seed is enabled
   */
  autoSeedEnabled: boolean;

  /**
   * Last seed timestamp (if available)
   */
  lastSeedTimestamp?: string;

  /**
   * Seed version (if available)
   */
  seedVersion?: string;
}

/**
 * Seed Manager
 *
 * Provides controlled access to database seeding operations.
 * All operations check APP_MODE to prevent accidental data modification in production.
 */
export class SeedManager {
  /**
   * Check if seeding is allowed
   *
   * @returns true if seeding is allowed (demo mode or force flag)
   */
  public static canSeed(): boolean {
    return isDemoMode();
  }

  /**
   * Get current seed status
   *
   * @param db - Optional database instance
   * @returns Seed status information
   */
  public static status(db?: DatabaseManager): SeedStatus {
    const database = db || getDatabase();

    // Try to get seed version from system_config table
    let lastSeedTimestamp: string | undefined;
    let seedVersion: string | undefined;

    try {
      const stmt = database.prepare('SELECT * FROM system_config WHERE key IN (?, ?)');
      const results = stmt.all('seed_version', 'last_seed_timestamp');
      stmt.free();

      for (const row of results) {
        if (row.key === 'seed_version') {
          seedVersion = row.value;
        } else if (row.key === 'last_seed_timestamp') {
          lastSeedTimestamp = row.value;
        }
      }
    } catch (error) {
      // Table might not exist yet
      logger.debug('Could not read seed status from system_config');
    }

    return {
      canSeed: SeedManager.canSeed(),
      appMode: isDemoMode() ? 'demo' : 'production',
      autoSeedEnabled: process.env.DEMO_AUTO_SEED === 'true',
      lastSeedTimestamp,
      seedVersion
    };
  }

  /**
   * Execute database seeding
   *
   * @param options - Seed options
   * @throws Error if seeding is not allowed
   */
  public static async seed(options: SeedOptions = {}): Promise<void> {
    const { force = false } = options;

    // Check if seeding is allowed
    if (!SeedManager.canSeed() && !force) {
      throw new Error(
        'Seeding is not allowed in production mode. ' +
        'Set APP_MODE=demo or use force=true (DANGEROUS).'
      );
    }

    if (force && !isDemoMode()) {
      logger.warn('⚠️  FORCE SEEDING IN PRODUCTION MODE - This should only be used for initial setup!');
    }

    logger.info('Starting database seeding...');

    // Execute seed
    await seedDatabase(options);

    // Update seed version and timestamp
    try {
      const db = getDatabase();
      const timestamp = new Date().toISOString();
      const version = '1.0.0';

      // Ensure system_config table exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS system_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Update seed version
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)'
      );
      stmt.run('seed_version', version);
      stmt.run('last_seed_timestamp', timestamp);
      stmt.free();

      logger.info(`Seed completed. Version: ${version}, Timestamp: ${timestamp}`);
    } catch (error: any) {
      logger.error('Failed to update seed version', { error: error.message });
    }
  }

  /**
   * Clear seed data
   *
   * @param options - Clear options
   * @throws Error if clearing is not allowed
   */
  public static async clear(options: SeedOptions = {}): Promise<void> {
    const { force = false, verbose = true } = options;

    // Check if clearing is allowed
    if (!SeedManager.canSeed() && !force) {
      throw new Error(
        'Clearing seed data is not allowed in production mode. ' +
        'Set APP_MODE=demo or use force=true (DANGEROUS).'
      );
    }

    if (force && !isDemoMode()) {
      logger.warn('⚠️  FORCE CLEARING IN PRODUCTION MODE - This will delete all data!');
    }

    logger.info('Clearing seed data...');

    const db = getDatabase();

    // Clear all tables
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
      if (verbose) {
        logger.info(`Clearing table: ${table}`);
      }
      db.exec(`DELETE FROM ${table}`);
    }

    // Clear seed version
    try {
      db.exec('DELETE FROM system_config WHERE key IN (?, ?)', ['seed_version', 'last_seed_timestamp']);
    } catch (error) {
      // Ignore if table doesn't exist
    }

    logger.info('Seed data cleared successfully');
  }

  /**
   * Check if database has been seeded
   *
   * @param db - Optional database instance
   * @returns true if database has seed data
   */
  public static isSeeded(db?: DatabaseManager): boolean {
    const database = db || getDatabase();

    try {
      // Check if users table has data
      const stmt = database.prepare('SELECT COUNT(*) as count FROM users');
      const result = stmt.get() as { count: number };
      stmt.free();

      return result.count > 0;
    } catch (error) {
      return false;
    }
  }
}
