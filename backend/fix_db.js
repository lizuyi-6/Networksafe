const crypto = require('crypto');
const { execSync } = require('child_process');

try {
    const apiKey = 'fe589f4f38dde88b31ad18c3ee0dc0513e51a6603a110a120fcb649a1ac11904';
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    console.log('Computed hash:', hash);

    const dbPath = '/opt/aetherguard/backend/data/newsecurity.db';
    const sqlCommand = `sqlite3 ${dbPath} "UPDATE agent_registrations SET api_key_hash='${hash}' WHERE agent_id='probe-agent-01';"`;

    console.log('Executing:', sqlCommand);
    execSync(sqlCommand);

    console.log('Successfully updated API key hash for probe-agent-01 in the database.');
} catch (error) {
    console.error('Error updating database:', error.message);
}
