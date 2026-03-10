const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
    console.log('Connected');
    const cmd = [
        'cat /etc/nginx/sites-available/default | grep -A 5 "location /api"',
        'cat /etc/nginx/nginx.conf | grep -A 5 "location /api"',
        'cat /etc/nginx/conf.d/*.conf | grep -A 5 "location /api"',
        'netstat -tulnp | grep node'
    ].join(' ; ');

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
