const { Client } = require('ssh2');
const fs = require('fs');
const { resolveOpsFile } = require('./_paths');

const conn = new Client();
conn.on('ready', () => {
    console.log('Connected');
    const cmd = [
        'cd /opt/aetherguard/backend',
        'echo "=== File check ==="',
        'ls -la dist/index.js dist/utils/model-access.js dist/api/routes/ai-endpoints.routes.js 2>&1',
        'echo "=== Kill old PM2 ==="',
        'pm2 delete all 2>&1 || true',
        'echo "=== Start fresh ==="',
        'cd /opt/aetherguard/backend && NODE_ENV=development DISABLE_REDIS=true PORT=3005 pm2 start dist/index.js --name fluxguard-backend 2>&1',
        'sleep 3',
        'echo "=== PM2 status ==="',
        'pm2 list 2>&1',
        'echo "=== Curl test ==="',
        'curl -s -w "\\nHTTP_CODE:%{http_code}" http://localhost:3005/api/ai-endpoints/models 2>&1 || echo "CURL_FAILED"'
    ].join(' && ');

    conn.exec(cmd, (err, stream) => {
        if (err) throw err;
        let output = '';
        stream.on('close', (code) => {
            fs.writeFileSync(resolveOpsFile('restart_result.log'), output);
            console.log(output);
            console.log('Exit: ' + code);
            conn.end();
        }).on('data', (data) => {
            output += data.toString();
        }).stderr.on('data', (data) => {
            output += data.toString();
        });
    });
}).connect({
    host: '39.102.81.78',
    port: 22,
    username: 'root',
    privateKey: fs.readFileSync('C:/Users/Abraham/Downloads/li.pem')
});
