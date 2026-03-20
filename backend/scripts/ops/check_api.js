const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
    console.log('Connected');
    const cmd = [
        'cat << "EOF" > /tmp/test_api.js',
        'const axios = require("axios");',
        'const jwt = require("jsonwebtoken");',
        'const token = jwt.sign({ plan: "starter", role: "admin", email: "test@test.com" }, "AetherGuard-secret-key-2026-production-secure!!", { expiresIn: "1h" });',
        'axios.get("http://localhost:3005/api/ai-endpoints/models", { headers: { Authorization: "Bearer " + token } }).then(res => { console.log(JSON.stringify(res.data, null, 2)) }).catch(e => console.log(e.message));',
        'EOF',
        'npm i -g axios jsonwebtoken >/dev/null 2>&1',
        'NODE_PATH=/usr/lib/node_modules node /tmp/test_api.js'
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
