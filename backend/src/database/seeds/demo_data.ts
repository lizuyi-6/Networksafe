/**
 * Database Seed Script
 * 
 * Creates demo data for development and testing
 */

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, getDatabase, closeDatabase } from '../../config/database';
import logger from '../../utils/logger';

interface SeedOptions {
    clearExisting?: boolean;
    verbose?: boolean;
}

/**
 * Seed the database with demo data
 */
export async function seedDatabase(options: SeedOptions = {}): Promise<void> {
    const { clearExisting = false, verbose = true } = options;

    try {
        await initDatabase();
        const db = getDatabase();

        if (verbose) logger.info('Starting database seeding...');

        // Clear existing data if requested
        if (clearExisting) {
            if (verbose) logger.info('Clearing existing data...');
            db.exec('DELETE FROM alerts');
            db.exec('DELETE FROM api_keys');
            db.exec('DELETE FROM scan_results');
            db.exec('DELETE FROM metrics');
            db.exec('DELETE FROM security_rules');
            db.exec('DELETE FROM sites');
            db.exec('DELETE FROM agents');
            db.exec('DELETE FROM devices');
            db.exec('DELETE FROM users');
        }

        // SECURITY FIX CVE-2026-037: Admin credentials must come from environment variables
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!adminEmail || !adminPassword) {
            throw new Error(
                'SECURITY ERROR: ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required. ' +
                'Cannot seed database with default credentials.'
            );
        }

        // Validate password strength
        if (adminPassword.length < 12) {
            throw new Error('SECURITY ERROR: ADMIN_PASSWORD must be at least 12 characters long.');
        }

        // Create admin user
        const adminId = uuidv4();
        const adminTenantId = uuidv4();
        const adminPasswordHash = await bcrypt.hash(adminPassword, 12);

        db.prepare(`
      INSERT OR IGNORE INTO users (id, email, username, password_hash, role, tenant_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(adminId, adminEmail, 'Administrator', adminPasswordHash, 'admin', adminTenantId, 'active');

        if (verbose) logger.info(`Created admin user: ${adminEmail}`);

        // SECURITY FIX CVE-2026-037: Demo user credentials from environment or skip
        const demoEmail = process.env.DEMO_EMAIL;
        const demoPassword = process.env.DEMO_PASSWORD;

        const tenantId = uuidv4();
        const tenantUserId = uuidv4();

        if (demoEmail && demoPassword) {
            const tenantPasswordHash = await bcrypt.hash(demoPassword, 12);

            db.prepare(`
      INSERT OR IGNORE INTO users (id, email, username, password_hash, role, tenant_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tenantUserId, demoEmail, 'Demo User', tenantPasswordHash, 'tenant', tenantId, 'active');

            if (verbose) logger.info(`Created demo user: ${demoEmail}`);
        } else {
            if (verbose) logger.info('Skipping demo user creation (DEMO_EMAIL/DEMO_PASSWORD not set)');
        }

        // Create demo sites
        const sites = [
            { domain: 'example.com', target: 'http://localhost:8080' },
            { domain: 'api.example.com', target: 'http://localhost:3000' },
            { domain: 'admin.example.com', target: 'http://localhost:4000' }
        ];

        for (const site of sites) {
            db.prepare(`
        INSERT OR IGNORE INTO sites (domain, target, sslEnabled, antiBotEnabled, rateLimitEnabled)
        VALUES (?, ?, 1, 1, 1)
      `).run(site.domain, site.target);
        }

        if (verbose) logger.info(`Created ${sites.length} demo sites`);

        // Create demo agents
        const agents = [
            { id: uuidv4(), hostname: 'web-server-01', platform: 'linux', arch: 'x64', version: '2.0.0', status: 'online' },
            { id: uuidv4(), hostname: 'api-server-01', platform: 'linux', arch: 'x64', version: '2.0.0', status: 'online' },
            { id: uuidv4(), hostname: 'db-server-01', platform: 'linux', arch: 'x64', version: '1.9.5', status: 'offline' }
        ];

        for (const agent of agents) {
            db.prepare(`
        INSERT OR IGNORE INTO agents (id, hostname, platform, arch, version, status, lastHeartbeat)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(agent.id, agent.hostname, agent.platform, agent.arch, agent.version, agent.status);
        }

        if (verbose) logger.info(`Created ${agents.length} demo agents`);

        // Create demo devices (ESP32)
        const devices = [
            { id: uuidv4(), mac: 'AA:BB:CC:DD:EE:01', firmware: '1.2.0', status: 'online' },
            { id: uuidv4(), mac: 'AA:BB:CC:DD:EE:02', firmware: '1.2.0', status: 'offline' }
        ];

        for (const device of devices) {
            db.prepare(`
        INSERT OR IGNORE INTO devices (id, device_type, mac_address, firmware_version, status, last_seen)
        VALUES (?, 'esp32', ?, ?, ?, datetime('now'))
      `).run(device.id, device.mac, device.firmware, device.status);
        }

        if (verbose) logger.info(`Created ${devices.length} demo devices`);

        // Create demo alerts
        const alerts = [
            { type: 'intrusion_attempt', severity: 'critical', source: 'web-server-01', message: 'SQL injection attempt detected from 192.168.1.100' },
            { type: 'brute_force', severity: 'warning', source: 'api-server-01', message: 'Multiple failed login attempts from 10.0.0.5' },
            { type: 'port_scan', severity: 'info', source: 'web-server-01', message: 'Port scan activity detected from 172.16.0.50' },
            { type: 'vulnerability', severity: 'critical', source: 'db-server-01', message: 'CVE-2024-1234 vulnerability detected in OpenSSL' }
        ];

        for (const alert of alerts) {
            db.prepare(`
        INSERT INTO alerts (type, severity, source, message)
        VALUES (?, ?, ?, ?)
      `).run(alert.type, alert.severity, alert.source, alert.message);
        }

        if (verbose) logger.info(`Created ${alerts.length} demo alerts`);

        // Create demo API key
        const apiKeyId = uuidv4();
        const apiKey = 'fluxguard_' + uuidv4().replace(/-/g, '');
        const apiKeyHash = await bcrypt.hash(apiKey, 10);

        db.prepare(`
      INSERT OR IGNORE INTO api_keys (id, name, key_hash, user_id, tenant_id, permissions)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(apiKeyId, 'Demo API Key', apiKeyHash, adminId, adminTenantId, '["read", "write"]');

        if (verbose) {
            logger.info('Created demo API key');
            logger.info(`API Key (save this): ${apiKey}`);
        }

        // Save changes
        db.save();

        if (verbose) {
            logger.info('Database seeding completed successfully!');
            logger.info('---');
            logger.info('SECURITY NOTE: Admin credentials were set from environment variables.');
            logger.info('Ensure ADMIN_EMAIL and ADMIN_PASSWORD are kept secure.');
        }

    } catch (error: any) {
        logger.error('Database seeding failed', { error: error.message });
        throw error;
    }
}

/**
 * Run seeder as standalone script
 */
async function main() {
    console.log('🌱 FluxGuard Database Seeder\n');

    const clearExisting = process.argv.includes('--clear');

    if (clearExisting) {
        console.log('⚠️  Warning: --clear flag detected, existing data will be removed!\n');
    }

    try {
        await seedDatabase({ clearExisting, verbose: true });
        console.log('\n✅ Seeding completed!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Seeding failed:', error);
        process.exit(1);
    } finally {
        closeDatabase();
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

export default seedDatabase;
