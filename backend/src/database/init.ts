
import { initDatabase, getDatabase } from '../config/database';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import logger from '../utils/logger';
import { isDevLoginPresetEnabled } from '../config/runtime-capabilities';
import { PLATFORM_TENANT_ID } from '../core/tenant/tenant-context';

function generateApiKey(): string {
    return `agent_${crypto.randomBytes(24).toString('hex')}`;
}

function generateSecretKey(): string {
    return crypto.randomBytes(32).toString('hex');
}

type SeedUser = {
    email: string;
    username: string;
    password: string;
    role: 'admin' | 'tenant' | 'viewer';
    plan: 'starter' | 'pro' | 'ultra';
};

const DEV_LOGIN_PRESETS: SeedUser[] = [
    {
        email: 'dev-admin@aetherguard.local',
        username: 'Dev Admin',
        password: 'DevAdmin!2026',
        role: 'admin',
        plan: 'ultra'
    },
    {
        email: 'starter@aetherguard.local',
        username: 'Starter User',
        password: 'DevStarter!2026',
        role: 'tenant',
        plan: 'starter'
    },
    {
        email: 'pro@aetherguard.local',
        username: 'Pro User',
        password: 'DevPro!2026',
        role: 'tenant',
        plan: 'pro'
    },
    {
        email: 'ultra@aetherguard.local',
        username: 'Ultra User',
        password: 'DevUltra!2026',
        role: 'tenant',
        plan: 'ultra'
    }
];

async function ensureUser(db: any, user: SeedUser): Promise<void> {
    const existingUser = db.prepare('SELECT id, tenant_id FROM users WHERE email = ?').get(user.email) as { id?: string; tenant_id?: string } | undefined;
    const passwordHash = await bcrypt.hash(user.password, 12);

    if (existingUser?.id) {
        db.prepare(`
            UPDATE users
            SET username = ?, password_hash = ?, role = ?, plan = ?, status = 'active', updated_at = datetime('now')
            WHERE id = ?
        `).run(user.username, passwordHash, user.role, user.plan, existingUser.id);
        return;
    }

    db.prepare(`
        INSERT INTO users (id, email, username, password_hash, role, plan, tenant_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `).run(uuidv4(), user.email, user.username, passwordHash, user.role, user.plan, uuidv4());
}

async function bootstrapDatabase() {
    try {
        await initDatabase();
        const db = getDatabase();

        const adminEmail = process.env.ADMIN_EMAIL || 'admin@AetherGuard.com';
        
        // SECURITY FIX: Require ADMIN_PASSWORD to be set - no fallback allowed
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!adminPassword) {
            throw new Error('ADMIN_PASSWORD environment variable is required - cannot start with default weak password');
        }
        
        // Validate password strength
        if (adminPassword.length < 12) {
            throw new Error('ADMIN_PASSWORD must be at least 12 characters long');
        }

        // Check if admin exists
        const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);

        if (existingAdmin) {
            logger.info('Admin user already exists');
        } else {
            logger.info('Creating default admin user...');
            await ensureUser(db, {
                email: adminEmail,
                username: 'Admin',
                password: adminPassword,
                role: 'admin',
                plan: 'ultra'
            });
            logger.info(`Admin user created: ${adminEmail}`);
        }

        if (isDevLoginPresetEnabled()) {
            for (const preset of DEV_LOGIN_PRESETS) {
                await ensureUser(db, preset);
            }
            logger.info('Development login presets ensured');
        }

        // Create default probe agent registration
        const existingAgent = db.prepare('SELECT agent_id FROM agent_registrations WHERE agent_id = ?').get('probe-agent-01');
        
        if (!existingAgent) {
            logger.info('Creating default probe agent registration...');
            
            const apiKey = process.env.PROBE_AGENT_API_KEY || generateApiKey();
            const secretKey = generateSecretKey();
            const fingerprint = crypto.createHash('sha256').update('AetherGuard-probe|linux|base').digest('hex');
            
            // Hash the API key for secure storage
            const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
            
            const columns = db.prepare(`PRAGMA table_info(agent_registrations)`).all() as Array<{ name: string }>;
            const hasTenantId = columns.some((column) => column.name === 'tenant_id');

            if (hasTenantId) {
                db.prepare(`
                    INSERT INTO agent_registrations (
                        agent_id, hostname, api_key_hash, secret_key, fingerprint, 
                        platform, status, created_at, tenant_id
                    ) VALUES (?, ?, ?, ?, ?, ?, 'approved', datetime('now'), ?)
                `).run('probe-agent-01', 'AetherGuard-probe', apiKeyHash, secretKey, fingerprint, 'linux', PLATFORM_TENANT_ID);
            } else {
                db.prepare(`
                    INSERT INTO agent_registrations (
                        agent_id, hostname, api_key_hash, secret_key, fingerprint, 
                        platform, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'approved', datetime('now'))
                `).run('probe-agent-01', 'AetherGuard-probe', apiKeyHash, secretKey, fingerprint, 'linux');
            }
            
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
