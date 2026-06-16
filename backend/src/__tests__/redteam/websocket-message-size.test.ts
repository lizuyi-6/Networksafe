/**
 * REDTEAM SECURITY TEST — WebSocket Message Size Limit (R4-w3 · V12.25)
 * =====================================================================
 *
 * Attack scenario:
 *   A malicious client connects to AgentGateway or DeviceGateway and sends
 *   a multi-megabyte JSON payload in a single socket.emit() call. Without
 *   a maxHttpBufferSize cap the Socket.IO server buffers the entire payload
 *   in memory before parsing, causing excessive memory consumption and CPU
 *   exhaustion during JSON parsing (DoS).
 *
 * Fix:
 *   AgentGateway: already set to 1 MB (maxHttpBufferSize: 1e6).
 *   DeviceGateway: added in V12.25 — now also set to 1 MB.
 *   Additionally a per-event payload-size check at the top of each socket.on()
 *   handler rejects payloads > 256 KB with an error frame.
 *
 * Red-team test:
 *   AgentGateway — send a 1 MB frame and assert it is rejected (connection
 *   dropped or error received).
 */

import { createServer, Server as HttpServer } from 'http';
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client';
import { AgentGateway } from '../../websocket/agent-gateway';

jest.mock('../../security/audit-logger.service', () => ({
    __esModule: true,
    default: {
        log: jest.fn().mockResolvedValue({}),
        logAgent: jest.fn().mockResolvedValue({}),
        logCommand: jest.fn().mockResolvedValue({}),
        logFirewall: jest.fn().mockResolvedValue({})
    }
}));

jest.mock('../../services/socket-rate-limit.service', () => ({
    __esModule: true,
    socketRateLimitService: {
        check: jest.fn().mockResolvedValue({
            allowed: true,
            remaining: 999,
            resetAt: new Date(Date.now() + 60_000).toISOString(),
            resetAtMs: Date.now() + 60_000,
            decisionSource: 'memory-fallback',
            riskFlags: []
        }),
        close: jest.fn()
    }
}));

jest.mock('../../services/command-dispatcher.service', () => ({
    commandDispatcherService: {
        handleAgentCommandAck: jest.fn(),
        handleAgentCommandFailure: jest.fn()
    }
}));

jest.mock('../../services/detection-pipeline.service', () => ({
    detectionPipelineService: {
        recordBlockedThreat: jest.fn().mockResolvedValue(undefined),
        reviewAgentSample: jest.fn().mockResolvedValue({ aiVerdict: 'safe', matchedRuleIds: [] }),
        listDynamicRules: jest.fn().mockResolvedValue([])
    }
}));

jest.mock('../../services/traffic-stats.service', () => ({
    getTrafficStats: jest.fn().mockReturnValue({
        packetsProcessed: 0, packetsAllowed: 0, packetsBlocked: 0,
        packetsInspected: 0, bytesProcessed: 0, activeFlows: []
    })
}));

jest.mock('../../services/agent-system.service', () => ({
    getAgentSystem: jest.fn().mockReturnValue(null)
}));

jest.mock('../../security/agent-auth.service', () => ({
    __esModule: true,
    default: {
        verifyAgent: jest.fn().mockResolvedValue({
            agentId: 'test-agent-id',
            hostname: 'test-host',
            platform: 'linux',
            tenantId: 'test-tenant',
            lastSeen: new Date()
        }),
        updateLastSeen: jest.fn().mockResolvedValue(undefined),
        getAgentSecretKey: jest.fn().mockReturnValue(null)
    }
}));

describe('AgentGateway maxHttpBufferSize enforcement', () => {
    let httpServer: HttpServer;
    let agentGateway: AgentGateway;
    let clientSocket: ClientSocket;
    const TEST_PORT = 19999 + Math.floor(Math.random() * 1000);

    beforeAll((done) => {
        httpServer = createServer();
        agentGateway = new AgentGateway(httpServer);
        httpServer.listen(TEST_PORT, done);
    });

    afterAll(async () => {
        clientSocket?.disconnect();
        agentGateway.close();
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    it('should reject a 1 MB payload on agent:register', (done) => {
        // A 1 MB string payload exceeds the 1 MB (1e6 byte) maxHttpBufferSize
        // and should cause Socket.IO to disconnect the client.
        const largePayload = { hostname: 'x'.repeat(1_000_000) };

        // Idempotent done: ensure the test only resolves once even if
        // multiple events (error, disconnect, timeout) fire.
        let doneCalled = false;
        const safeDone = (err?: any) => {
            if (doneCalled) return;
            doneCalled = true;
            done(err);
        };

        clientSocket = SocketIOClient(`http://localhost:${TEST_PORT}`, {
            auth: { type: 'agent', agentId: 'test-agent', apiKey: 'test-key' },
            transports: ['websocket'],
            reconnection: false
        } as any);

        clientSocket.on('connect', () => {
            // Send oversized payload
            clientSocket.emit('agent:register', largePayload);
        });

        clientSocket.on('error', (err: any) => {
            // An error event with "parser limit exceeded" or similar means
            // Socket.IO correctly rejected the oversized frame.
            try {
                expect(err?.message || String(err)).toMatch(/parser|limit|buffer|size/i);
                safeDone();
            } catch (assertionError) {
                safeDone(assertionError);
            }
        });

        clientSocket.on('disconnect', (reason: string) => {
            // Disconnect is also acceptable (server dropped the connection)
            if (reason === 'io server disconnect' || reason === 'transport close') {
                safeDone();
            }
        });

        // Timeout guard — if neither error nor disconnect fires the test hangs.
        // We unref() so it does not keep the process alive; if it fires,
        // safeDone prevents the unhandled-rejection crash.
        const timer = setTimeout(() => {
            safeDone(new Error('Timeout: no rejection received for 1 MB payload'));
        }, 5000);
        // Do not let the open handle keep Jest alive after done.
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    });
});
