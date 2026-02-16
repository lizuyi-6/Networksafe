
import { initDatabase, getDatabase } from '../config/database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import logger from '../utils/logger';

function generateApiKey(): string {
    return `agent_${crypto.randomBytes(24).toString('hex')}`;
}

function generateSecretKey(): string {
    return crypto.randomBytes(32).toString('hex');
}

async function bootstrapDatabase() {
    try {
        await initDatabase();
        const db = getDatabase();

        const adminEmail = process.env.ADMIN_EMAIL || 'admin@fluxguard.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

        // Check if admin exists
        const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);

        if (existingAdmin) {
            logger.info('Admin user already exists');
        } else {
            logger.info('Creating default admin user...');

            const saltRounds = 12;
            const passwordHash = await bcrypt.hash(adminPassword, saltRounds);
            const userId = uuidv4();
            const tenantId = uuidv4();

            db.prepare(`
                INSERT INTO users (id, email, username, password_hash, role, tenant_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            `).run(userId, adminEmail, 'Admin', passwordHash, 'admin', tenantId);

            logger.info(`Admin user created: ${adminEmail}`);
        }

        // Create default probe agent registration
        const existingAgent = db.prepare('SELECT agent_id FROM agent_registrations WHERE agent_id = ?').get('probe-agent-01');
        
        if (!existingAgent) {
            logger.info('Creating default probe agent registration...');
            
            const apiKey = process.env.PROBE_AGENT_API_KEY || generateApiKey();
            const secretKey = generateSecretKey();
            const fingerprint = crypto.createHash('sha256').update('fluxguard-probe|linux|base').digest('hex');
            
            // Hash the API key for secure storage
            const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
            
            db.prepare(`
                INSERT INTO agent_registrations (
                    agent_id, hostname, api_key_hash, secret_key, fingerprint, 
                    platform, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'approved', datetime('now'))
            `).run('probe-agent-01', 'fluxguard-probe', apiKeyHash, secretKey, fingerprint, 'linux');
            
            logger.info('Default probe agent registered with API key');
        }

    } catch (error) {
        logger.error('Failed to seed database', { error });
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    bootstrapDatabase().then(() => {
        logger.info('Seeding complete');
        process.exit(0);
    });
}

export { bootstrapDatabase };
export const seedDatabase = bootstrapDatabase;
