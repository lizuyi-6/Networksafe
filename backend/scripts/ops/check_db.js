const { execSync } = require('child_process');

try {
    const dbPath = '/opt/aetherguard/backend/data/newsecurity.db';
    const sqlCommand = `sqlite3 ${dbPath} "SELECT agent_id, status, api_key_hash FROM agent_registrations WHERE agent_id='probe-agent-01';"`;

    console.log('Executing:', sqlCommand);
    const output = execSync(sqlCommand).toString();
    console.log('--- RECORD ---');
    console.log(output);
    console.log('--------------');
} catch (error) {
    console.error('Error querying database:', error.message);
}
