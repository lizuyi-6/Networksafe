const { Client } = require('ssh2');
const fs = require('fs');
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
            const cmd = [
                'cd /opt/aetherguard/backend',
                'rm -rf dist',
                'mkdir -p dist',
                'cp /tmp/backend_dist.zip .',
                'unzip -o backend_dist.zip -d dist/',
                'rm backend_dist.zip',
                'echo "=== FILES CHECK ==="',
                'ls dist/utils/model-access.js 2>&1',
                'ls dist/api/routes/ai-endpoints.routes.js 2>&1',
                'echo "=== RESTART PM2 ==="',
                'pm2 restart all 2>&1',
                'sleep 3',
                'echo "=== CURL CHECK ==="',
                'curl -s -w "\\nHTTP_CODE:%{http_code}" http://localhost:3005/api/ai-endpoints/models 2>&1 || echo "CURL_FAILED"'
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

        readStream.pipe(writeStream);
    });
}).connect({
    host: '39.102.81.78',
    port: 22,
    username: 'root',
    privateKey: fs.readFileSync('C:/Users/Abraham/Downloads/li.pem')
});
