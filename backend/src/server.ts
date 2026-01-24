import app from './app';
import logger from './utils/logger';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 3005;

// 尝试加载 HTTPS 证书
const certPath = path.resolve(__dirname, '../../certs/localhost.crt');
const keyPath = path.resolve(__dirname, '../../certs/localhost.key');

let server: http.Server | https.Server;

if (false && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    // HTTPS 模式
    const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
    };
    server = https.createServer(httpsOptions, app);
    server.listen(Number(PORT), '0.0.0.0', () => {
        logger.info(`🔒 HTTPS Server running on https://localhost:${PORT}`);
    });
} else {
    // HTTP 模式 (回退)
    server = http.createServer(app);
    server.listen(Number(PORT), '0.0.0.0', () => {
        logger.info(`⚠️ HTTP Server running on http://localhost:${PORT} (No SSL certs found)`);
    });
}

export default server;
