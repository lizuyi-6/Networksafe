const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
    console.log('Connected');
    const cmd = [
        'cat << "EOF" > /tmp/test_models.js',
        'const { PLATFORM_MODELS, getModelsForTier } = require("/opt/aetherguard/backend/dist/utils/model-access.js");',
        'console.log("STARTER MODELS:");',
        'console.log(getModelsForTier("starter").map(m => m.id));',
        'console.log("PRO MODELS:");',
        'console.log(getModelsForTier("pro").map(m => m.id));',
        'EOF',
        'node /tmp/test_models.js',
        'echo "== CHECKING PORT 3005 =="',
        'curl -s http://localhost:3005/api/ai-endpoints/models | grep -o "qwen3.5-plus" | wc -l',
        'pm2 restart all'
    ].join('\n');

    conn.exec(cmd, (err, stream) => {
        if (err) throw err;
        let output = '';
        stream.on('close', (code) => {
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
