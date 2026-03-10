const fs = require('fs');
const crypto = require('crypto');
const { resolveBackendPath } = require('./_paths');

// The DB uses sql.js directly
const initSqlJs = require('sql.js');

async function resetAndRegisterAgent() {
    const dbPath = resolveBackendPath('data', 'newsecurity.db');

    if (!fs.existsSync(dbPath)) {
        console.error('Database file not found at:', dbPath);
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // 1. Delete old agent registration if exists
    db.run("DELETE FROM agent_registrations WHERE agent_id = 'probe-agent-01'");

    // 2. Generate new keys
    const newApiKey = 'agent_' + crypto.randomBytes(24).toString('hex');
    const secretKey = crypto.randomBytes(32).toString('hex');
    const fingerprint = crypto.createHash('sha256').update('fluxguard-probe|linux|base').digest('hex');

    // Generate hashed key for DB
    const apiKeyHash = crypto.createHash('sha256').update(newApiKey).digest('hex');

    // Insert the new agent credential
    db.run(`
    INSERT INTO agent_registrations (
      agent_id, hostname, api_key_hash, secret_key, fingerprint, 
      platform, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'approved', datetime('now'))
  `, [
        'probe-agent-01',
        'fluxguard-probe',
        apiKeyHash,
        secretKey,
        fingerprint,
        'linux'
    ]);

    // 3. Save the DB back to disk
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    console.log('--- AGENT CREDENTIALS ---');
    console.log('AGENT_ID=probe-agent-01');
    console.log('API_KEY=' + newApiKey);
    console.log('SECRET_KEY=' + secretKey);
    console.log('-------------------------');
}

resetAndRegisterAgent().catch(err => {
    console.error(err);
    process.exit(1);
});
