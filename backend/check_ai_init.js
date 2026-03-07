const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
    console.log('Connected');
    const cmd = [
        'echo "=== PM2 LOGS (last 60 lines) ==="',
        'pm2 logs --lines 60 --nostream 2>&1',
        'echo "=== CHECK model-router.js for PLATFORM_API ==="',
        'grep -n "PLATFORM_API\\|apiKey\\|qwen3-max\\|DashScope\\|cloud model" /opt/aetherguard/backend/dist/ai-agents/models/model-router.js | head -20',
        'echo "=== DONE ==="'
    ].join('\n');

    conn.exec(cmd, (err, stream) => {
        if (err) throw err;
        let output = '';
        stream.on('close', (code) => {
            fs.writeFileSync('remote_pm2_logs.txt', output);
            console.log('Logs saved to remote_pm2_logs.txt');
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
