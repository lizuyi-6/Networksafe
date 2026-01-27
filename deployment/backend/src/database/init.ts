
import { initDatabase, getDatabase } from '../config/database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';

async function seedDatabase() {
    try {
        await initDatabase();
        const db = getDatabase();

        const adminEmail = process.env.ADMIN_EMAIL || 'admin@fluxguard.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

        // Check if admin exists
        const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);

        if (existingAdmin) {
            logger.info('Admin user already exists');
            return;
        }

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

    } catch (error) {
        logger.error('Failed to seed database', { error });
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    seedDatabase().then(() => {
        logger.info('Seeding complete');
        process.exit(0);
    });
}

export { seedDatabase };
