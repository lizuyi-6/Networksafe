const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const { resolveRelease } = require('./_paths');

const conn = new Client();
conn.on('ready', () => {
    console.log('Client :: ready');
    conn.sftp((err, sftp) => {
        if (err) throw err;

        const readStream = fs.createReadStream(resolveRelease('backend_dist.zip'));
        const writeStream = sftp.createWriteStream('/tmp/backend_dist.zip');

        writeStream.on('close', () => {
            console.log('- backend dist transferred');

            const scriptContent = fs.readFileSync(path.join(__dirname, 'extract_and_fix.py'), 'utf8');
            const scriptStream = sftp.createWriteStream('/tmp/extract_and_fix.py');
            scriptStream.on('close', () => {
                console.log('- extract script transferred');

                const cmd = [
                    'mkdir -p /opt/aetherguard/backend',
                    'cd /opt/aetherguard/backend',
                    'rm -rf dist',
                    'mkdir -p dist',
                    'cp /tmp/backend_dist.zip .',
                    'cp /tmp/extract_and_fix.py .',
                    'cd dist && python3 ../extract_and_fix.py',
                    'rm /tmp/backend_dist.zip /tmp/extract_and_fix.py',
                    'echo "=== RESTART DOCKER ==="',
                    'cd /root/Networksafe && docker compose restart backend',
                    'sleep 5',
                    'echo "=== CURL CHECK ==="',
                    'curl -s -w "\\nHTTP_CODE:%{http_code}" http://localhost:3005/api/health 2>&1 || echo "CURL_FAILED"'
                ].join(' && ');

                conn.exec(cmd, (err, stream) => {
                    if (err) throw err;
                    stream.on('close', (code, signal) => {
                        console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
                        conn.end();
                    }).on('data', (data) => {
                        console.log(data.toString());
                    }).stderr.on('data', (data) => {
                        console.log('STDERR: ' + data.toString());
                    });
                });
            });
            scriptStream.end(scriptContent);
        });

        readStream.pipe(writeStream);
    });
}).connect({
    host: '39.102.81.78',
    port: 22,
    username: 'root',
    privateKey: fs.readFileSync('C:/Users/Abraham/Downloads/xin.pem')
});