const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
    console.log('Client :: ready');
    conn.sftp((err, sftp) => {
        if (err) throw err;

        const readStream = fs.createReadStream('./frontend_dist.zip');
        const writeStream = sftp.createWriteStream('/tmp/frontend_dist.zip');

        writeStream.on('close', () => {
            console.log('- frontend dist transferred');
            const cmd = [
                'rm -rf /opt/aetherguard/frontend/dist',
                'mkdir -p /opt/aetherguard/frontend/dist',
                'cp /tmp/frontend_dist.zip /opt/aetherguard/frontend/',
                'cd /opt/aetherguard/frontend/',
                'unzip -o frontend_dist.zip -d dist/',
                'rm frontend_dist.zip',
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
