const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
    console.log('Connected');
    const cmd = [
        'echo "=== CHECKING AI ENDPOINTS ROUTES JS ==="',
        'head -n 50 /opt/aetherguard/backend/dist/api/routes/ai-endpoints.routes.js',
        'echo "=== DONE ==="'
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
