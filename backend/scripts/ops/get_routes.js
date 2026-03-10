const { Client } = require('ssh2');
const fs = require('fs');
const { resolveOpsFile } = require('./_paths');

const conn = new Client();
conn.on('ready', () => {
    console.log('Connected');
    const cmd = 'cat /opt/aetherguard/backend/dist/api/routes/ai-endpoints.routes.js';

    conn.exec(cmd, (err, stream) => {
        if (err) throw err;
        let output = '';
        stream.on('close', (code) => {
            const outputPath = resolveOpsFile('remote_routes.js');
            fs.writeFileSync(outputPath, output);
            console.log('Saved to ' + outputPath + ', exit: ' + code);
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
