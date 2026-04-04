const {Client} = require('ssh2');
const fs = require('fs');
const conn = new Client();
conn.on('ready', () => {
  conn.exec('pkill -f "node dist/index" 2>/dev/null; sleep 2; cd /opt/networksafe/backend && nohup node dist/index.js >/dev/null 2>&1 & sleep 5; curl -s http://localhost:8080/api/health | head -c 200', (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    let out = '';
    stream.on('data', d => out += d);
    stream.stderr.on('data', d => process.stderr.write(d));
    stream.on('close', () => {
      console.log(out.substring(0, 500));
      conn.end();
    });
  });
}).connect({
  host: '39.102.81.78',
  port: 22,
  username: 'root',
  privateKey: fs.readFileSync('C:/Users/Abraham/Downloads/xin.pem'),
  readyTimeout: 90000
});
