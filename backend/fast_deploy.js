const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
    console.log('Client :: ready');
    conn.sftp((err, sftp) => {
        if (err) throw err;
        const readStream = fs.createReadStream('../frontend/dist.zip');
        const writeStream = sftp.createWriteStream('/tmp/dist.zip');

        writeStream.on('close', () => {
            console.log('- file transferred');
            conn.exec('cd /var/www/aetherguard && rm -rf dist && cp /tmp/dist.zip . && unzip -o dist.zip && rm dist.zip', (err, stream) => {
                if (err) throw err;
                stream.on('close', (code, signal) => {
                    console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
                    conn.end();
                }).on('data', (data) => {
                    console.log('STDOUT: ' + data);
                }).stderr.on('data', (data) => {
                    console.log('STDERR: ' + data);
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
