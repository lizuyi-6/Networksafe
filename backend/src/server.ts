import app, { initializeAgentSystem } from './app';
import logger from './utils/logger';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { AgentGateway } from './websocket/agent-gateway';
import { setAgentGateway } from './api/routes/ai-system.routes';

const PORT = process.env.PORT || 3005;

async function startServer() {
    try {
        await initializeAgentSystem();
        logger.info('Multi-Agent Decision System initialized');
    } catch (error: any) {
        logger.warn('Failed to initialize Multi-Agent System', { error: error.message });
    }

    const certPath = path.resolve(__dirname, '../../certs/localhost.crt');
    const keyPath = path.resolve(__dirname, '../../certs/localhost.key');
    const enableLocalHttps = process.env.ENABLE_LOCAL_HTTPS === 'true';

    let server: http.Server | https.Server;

    if (enableLocalHttps && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        const httpsOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
        };
        server = https.createServer(httpsOptions, app);
    } else {
        server = http.createServer(app);
    }

    const agentGateway = new AgentGateway(server);
    setAgentGateway(agentGateway);
    logger.info('WebSocket Agent Gateway initialized');

    server.listen(Number(PORT), '0.0.0.0', () => {
        const protocol = server instanceof https.Server ? 'HTTPS' : 'HTTP';
        logger.info(`${protocol === 'HTTPS' ? '🔒' : '⚠️'} ${protocol} Server running on http://localhost:${PORT}`);
        logger.info(`WebSocket available at ws://localhost:${PORT}/socket.io/`);
    });
}

startServer();
