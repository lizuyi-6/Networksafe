const { Client } = require('ssh2');
const fs = require('fs');
const { resolveRelease } = require('./_paths');

const conn = new Client();
conn.on('ready', () => {
    console.log('Client :: ready');
    conn.sftp((err, sftp) => {
        if (err) throw err;

        const archivePath = resolveRelease('frontend-dist.tar.gz');
        const readStream = fs.createReadStream(archivePath);
        const writeStream = sftp.createWriteStream('/tmp/frontend-dist.tar.gz');

        writeStream.on('close', () => {
            console.log('- frontend dist transferred');
            const cmd = [
                'rm -rf /var/www/aetherguard/*',
                'mkdir -p /var/www/aetherguard',
                'rm -rf /tmp/aetherguard-frontend',
                'mkdir -p /tmp/aetherguard-frontend',
                'tar -xzf /tmp/frontend-dist.tar.gz -C /tmp/aetherguard-frontend',
                'cp -r /tmp/aetherguard-frontend/dist/* /var/www/aetherguard/',
                'rm -rf /tmp/aetherguard-frontend /tmp/frontend-dist.tar.gz',
                'chown -R nginx:nginx /var/www/aetherguard || true',
                'echo "=== DONE ==="'
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
