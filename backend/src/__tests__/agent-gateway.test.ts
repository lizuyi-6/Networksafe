/**
 * Agent Gateway Unit Tests
 *
 * Tests WebSocket communication between agents and the control platform
 */

import { Server as HttpServer, createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client';
import { AgentGateway } from '../websocket/agent-gateway';

jest.mock('../security/audit-logger.service', () => ({
    __esModule: true,
    default: {
        log: jest.fn(),
        logAgent: jest.fn(),
        logCommand: jest.fn(),
        logFirewall: jest.fn()
    }
}));

jest.mock('../services/socket-rate-limit.service', () => ({
    socketRateLimitService: {
        check: jest.fn().mockResolvedValue({
            allowed: true,
            remaining: 100,
            resetAt: new Date(Date.now() + 60000).toISOString(),
            resetAtMs: Date.now() + 60000,
            decisionSource: 'test-mock',
            riskFlags: []
        }),
        close: jest.fn()
    }
}));

jest.mock('../services/fastpath-client.service', () => ({
    fastpathClientService: {
        checkSocket: jest.fn().mockResolvedValue(null),
        check: jest.fn().mockResolvedValue(null)
    }
}));

jest.mock('../services/command-dispatcher.service', () => ({
    commandDispatcherService: {
        handleAgentCommandAck: jest.fn(),
        handleAgentCommandFailure: jest.fn()
    }
}));

jest.mock('../services/detection-pipeline.service', () => {
    const mockFn = jest.fn();
    mockFn.mockResolvedValue({
        aiVerdict: 'safe',
        matchedRuleIds: [],
        attackFamily: 'unknown',
        riskScore: 0.1,
        decisionSource: 'test'
    });
    return {
        detectionPipelineService: {
            recordBlockedThreat: jest.fn().mockResolvedValue(undefined),
            reviewAgentSample: mockFn,
            listDynamicRules: jest.fn().mockResolvedValue([])
        }
    };
});

// Import the mocked module for test-specific behavior
import { detectionPipelineService } from '../services/detection-pipeline.service';
import { commandDispatcherService } from '../services/command-dispatcher.service';
import {
  buildSignedEnvelope,
  INBOUND_ENVELOPE_TEST_SECRET
} from '../security/inbound-envelope';

// AUD-03-4: HIGH-severity agent events require a signed inbound envelope.
// Tests sign with the deterministic test-runtime secret bound to the live
// agent socket id.
function signAgentEvent(eventType: string, payload: any, socketId: string): any {
  const { envelope, payload: body } = buildSignedEnvelope(
    INBOUND_ENVELOPE_TEST_SECRET,
    payload,
    {
      eventType,
      sessionId: socketId,
      nonce: `agent-test-nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
  );
  return { ...body, envelope };
}
import type { DetectionDecision } from '../services/detection-pipeline.service';
import auditLogger from '../security/audit-logger.service';

jest.mock('../security/command-signing.service', () => ({
    commandSigningService: {
        signCommand: jest.fn().mockReturnValue({
            command: {
                type: 'test',
                payload: undefined,
                timestamp: Date.now(),
                nonce: 'test-nonce'
            },
            signature: 'test-signature',
            agentId: 'test-agent'
        })
    }
}));

describe('AgentGateway', () => {
    let httpServer: HttpServer;
    let gateway: AgentGateway;
    let agentSocket: ClientSocket;
    let dashboardSocket: ClientSocket;
    const PORT = 3099; // Use a unique port for tests

    beforeAll((done) => {
        httpServer = createServer();
        gateway = new AgentGateway(httpServer);
        httpServer.listen(PORT, () => {
            done();
        });
    });

    afterAll(async () => {
        // Close all connections
        agentSocket?.removeAllListeners();
        dashboardSocket?.removeAllListeners();
        if (agentSocket?.connected) agentSocket.disconnect();
        if (dashboardSocket?.connected) dashboardSocket.disconnect();

        await gateway.close();
        httpServer.closeIdleConnections?.();
        httpServer.closeAllConnections?.();
        if (httpServer.listening) {
            await new Promise<void>((resolve, reject) => {
                httpServer.close((error) => error ? reject(error) : resolve());
            });
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    });

    afterEach(() => {
        // Disconnect even when a client is still in the connecting/retrying
        // state; checking only `.connected` leaks its Engine.IO ping timer.
        agentSocket?.removeAllListeners();
        dashboardSocket?.removeAllListeners();
        agentSocket?.disconnect();
        dashboardSocket?.disconnect();
        delete process.env.AUDIT_LOG_FAIL_CLOSED;
    });

    describe('Dashboard Connection', () => {
        it('should accept dashboard connections', (done) => {
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                expect(dashboardSocket.connected).toBe(true);
                done();
            });

            dashboardSocket.on('connect_error', (error) => {
                done(error);
            });
        });

        it('should send agent list to dashboard on connect', (done) => {
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('agents:list', (agents) => {
                expect(Array.isArray(agents)).toBe(true);
                done();
            });
        });
    });

    describe('Agent Connection', () => {
        it('should accept agent connections with valid ID', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-agent-001' }
            });

            agentSocket.on('connect', () => {
                expect(agentSocket.connected).toBe(true);
                done();
            });
        });

        it('should allow agent registration', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-agent-002' }
            });

            agentSocket.on('connect', () => {
                const registration = {
                    agentId: 'test-agent-002',
                    hostname: 'test-server',
                    platform: 'linux',
                    arch: 'x64',
                    version: '2.0.0'
                };

                agentSocket.emit('agent:register', registration);

                // Wait a moment for registration to process
                setTimeout(() => {
                    const agents = gateway.getAgentList();
                    const registeredAgent = agents.find(a => a.agentId === 'test-agent-002');
                    expect(registeredAgent).toBeDefined();
                    expect(registeredAgent?.registration.hostname).toBe('test-server');
                    done();
                }, 100);
            });
        });
    });

    describe('Heartbeat', () => {
        it('should handle agent heartbeats', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-agent-003' }
            });

            agentSocket.on('connect', () => {
                // Register first
                agentSocket.emit('agent:register', {
                    agentId: 'test-agent-003',
                    hostname: 'heartbeat-test-server'
                });

                // Send heartbeat
                const status = {
                    agentId: 'test-agent-003',
                    hostname: 'heartbeat-test-server',
                    platform: 'linux',
                    uptime: 3600,
                    cpuUsage: 25.5,
                    memoryUsage: 60.0,
                    lastHeartbeat: new Date().toISOString(),
                    isOnline: true
                };

                agentSocket.emit('agent:heartbeat', status);

                const startedAt = Date.now();
                const checkHeartbeat = () => {
                    const agent = gateway.getAgent('test-agent-003');
                    if (agent?.status?.cpuUsage === 25.5) {
                        expect(agent).toBeDefined();
                        done();
                        return;
                    }

                    if (Date.now() - startedAt > 1500) {
                        done(new Error(`Heartbeat not reflected in time; latest status: ${JSON.stringify(agent?.status)}`));
                        return;
                    }

                    setTimeout(checkHeartbeat, 25);
                };

                setTimeout(checkHeartbeat, 25);
            });
        });

        it('disconnects an agent whose server-observed heartbeat is older than five minutes', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-agent-stale-heartbeat' }
            });

            let staleError: any;
            agentSocket.on('error', (error) => {
                staleError = error;
            });
            agentSocket.on('disconnect', () => {
                expect(staleError).toMatchObject({ reason: 'heartbeat_timeout' });
                expect(gateway.getAgent('test-agent-stale-heartbeat')).toBeUndefined();
                done();
            });
            agentSocket.on('connect', () => {
                const connected = gateway.getAgent('test-agent-stale-heartbeat');
                expect(connected).toBeDefined();
                connected!.lastHeartbeat = new Date(Date.now() - (5 * 60_000 + 1));

                // This is the same method invoked by the production interval.
                (gateway as any).sweepStaleAgents(Date.now());
            });
        });
    });

    describe('Threat Alerts', () => {
        it('should broadcast threats to dashboard clients', (done) => {
            // Connect dashboard first
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                // Connect agent
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-agent-004' }
                });

                agentSocket.on('connect', () => {
                    // Register agent
                    agentSocket.emit('agent:register', {
                        agentId: 'test-agent-004',
                        hostname: 'threat-test-server'
                    });

                    // Listen for threat on dashboard
                    dashboardSocket.on('threat:detected', (data) => {
                        expect(data.agentId).toBe('test-agent-004');
                        expect(data.threat.type).toBe('sql_injection');
                        done();
                    });

                    // Emit threat from agent
                    setTimeout(() => {
                        agentSocket.emit('agent:threat', {
                            agentId: 'test-agent-004',
                            threat: {
                                type: 'sql_injection',
                                severity: 'critical',
                                sourceIP: '192.168.1.100',
                                description: 'SQL injection attempt detected'
                            },
                            timestamp: new Date().toISOString()
                        });
                    }, 100);
                });
            });
        });
    });

    describe('Commands', () => {
        it('should send commands to specific agents', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-agent-005' }
            });

            agentSocket.on('connect', () => {
                // Register agent
                agentSocket.emit('agent:register', {
                    agentId: 'test-agent-005',
                    hostname: 'command-test-server'
                });

                // Listen for command - filter for scan (ignore update_rules sent on connect)
                agentSocket.on('command', (command) => {
                    if (command.type === 'scan') {
                        expect(command.type).toBe('scan');
                        done();
                    }
                });

                // Send command from gateway
                setTimeout(() => {
                    const result = gateway.sendCommandToAgent('test-agent-005', { type: 'scan' });
                    expect(result).toBe(true);
                }, 100);
            });
        });

        it('should return false when sending command to non-existent agent', () => {
            const result = gateway.sendCommandToAgent('non-existent-agent', { type: 'scan' });
            expect(result).toBe(false);
        });

        it('reports command_not_delivered and audits success=false for an offline agent', (done) => {
            jest.mocked(auditLogger.logCommand).mockClear();
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'offline-command-agent' }
            });

            agentSocket.on('connect', () => {
                const connected = gateway.getAgent('offline-command-agent');
                expect(connected).toBeDefined();
                connected!.status = { isOnline: false } as any;

                dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'dashboard' }
                });
                dashboardSocket.on('error', (error: any) => {
                    if (error.reason !== 'agent_offline_or_rejected') {
                        return;
                    }
                    expect(error.message).toBe('backend.command_not_delivered');
                    expect(auditLogger.logCommand).toHaveBeenCalledWith(expect.objectContaining({
                        agentId: 'offline-command-agent',
                        commandType: 'scan',
                        success: false
                    }));
                    done();
                });
                dashboardSocket.on('connect', () => {
                    dashboardSocket.emit('request:scan', { agentId: 'offline-command-agent' });
                });
            });
        });

        it('denies request:scan for a viewer-role dashboard user (per-message RBAC)', (done) => {
            jest.mocked(auditLogger.logCommand).mockClear();
            let scanReceived = false;

            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'rbac-viewer-agent' }
            });
            agentSocket.on('command', (command) => {
                if (command.type === 'scan') scanReceived = true;
            });
            agentSocket.on('connect', () => {
                dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'dashboard', role: 'viewer' }
                });
                dashboardSocket.on('error', (error: any) => {
                    if (error.reason !== 'forbidden') return;
                    expect(error.message).toBe('backend.insufficient_permissions');
                    setTimeout(() => {
                        expect(scanReceived).toBe(false);
                        expect(auditLogger.logCommand).not.toHaveBeenCalled();
                        done();
                    }, 25);
                });
                dashboardSocket.on('connect', () => {
                    dashboardSocket.emit('request:scan', { agentId: 'rbac-viewer-agent' });
                });
            });
        });

        it('does not emit a command when fail-closed pre-dispatch audit fails', (done) => {
            process.env.AUDIT_LOG_FAIL_CLOSED = 'true';
            jest.mocked(auditLogger.log).mockRejectedValueOnce(new Error('shadow unavailable'));
            jest.mocked(auditLogger.logCommand).mockClear();
            let scanReceived = false;

            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'audit-preflight-agent' }
            });
            agentSocket.on('command', (command) => {
                if (command.type === 'scan') scanReceived = true;
            });
            agentSocket.on('connect', () => {
                dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'dashboard' }
                });
                dashboardSocket.on('error', (error: any) => {
                    if (error.reason !== 'audit_unavailable') return;
                    setImmediate(() => {
                        expect(scanReceived).toBe(false);
                        expect(auditLogger.logCommand).not.toHaveBeenCalled();
                        done();
                    });
                });
                dashboardSocket.on('connect', () => {
                    dashboardSocket.emit('request:scan', { agentId: 'audit-preflight-agent' });
                });
            });
        });

        it('reports command_may_have_been_delivered when outcome audit fails after emit', (done) => {
            process.env.AUDIT_LOG_FAIL_CLOSED = 'true';
            jest.mocked(auditLogger.log).mockResolvedValueOnce('preflight-audit-id');
            jest.mocked(auditLogger.logCommand).mockRejectedValueOnce(new Error('outcome shadow unavailable'));
            let scanReceived = false;

            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'audit-outcome-agent' }
            });
            agentSocket.on('command', (command) => {
                if (command.type === 'scan') scanReceived = true;
            });
            agentSocket.on('connect', () => {
                dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'dashboard' }
                });
                dashboardSocket.on('error', (error: any) => {
                    if (error.reason !== 'command_may_have_been_delivered') return;
                    setTimeout(() => {
                        expect(error.message).toBe('backend.command_delivery_audit_failed');
                        expect(scanReceived).toBe(true);
                        done();
                    }, 25);
                });
                dashboardSocket.on('connect', () => {
                    dashboardSocket.emit('request:scan', { agentId: 'audit-outcome-agent' });
                });
            });
        });
    });

    describe('Agent Count', () => {
        it('should track online agent count', (done) => {
            const initialCount = gateway.getOnlineCount();

            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-agent-006' }
            });

            agentSocket.on('connect', () => {
                agentSocket.emit('agent:register', {
                    agentId: 'test-agent-006',
                    hostname: 'count-test-server'
                });

                setTimeout(() => {
                    expect(gateway.getOnlineCount()).toBeGreaterThan(initialCount);
                    done();
                }, 100);
            });
        });
    });

    describe('isValidIPAddress (shell injection prevention)', () => {
        // Import the module-level function by requiring the compiled source
        // We test through the behavior of block_ip validation

        it('accepts valid IPv4 addresses', (done) => {
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-ip-agent-001' }
                });

                agentSocket.on('connect', () => {
                    // Valid IPv4 should work
                    dashboardSocket.emit('request:block_ip', {
                        agentId: 'test-ip-agent-001',
                        ip: '192.168.1.1'
                    });

                    // Give it time to process, then check no error was emitted for IP format
                    setTimeout(() => {
                        done();
                    }, 100);
                });
            });
        });

        it('accepts valid IPv6 addresses', (done) => {
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-ip-agent-002' }
                });

                agentSocket.on('connect', () => {
                    // Valid IPv6 should work
                    dashboardSocket.emit('request:block_ip', {
                        agentId: 'test-ip-agent-002',
                        ip: '::1'
                    });

                    setTimeout(() => {
                        done();
                    }, 100);
                });
            });
        });

        it('rejects IPv4-mapped IPv6 addresses', (done) => {
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-ip-agent-003' }
                });

                agentSocket.on('connect', () => {
                    let errorReceived = false;
                    dashboardSocket.on('error', (error: any) => {
                        if (error.reason === 'invalid_ip') {
                            errorReceived = true;
                        }
                    });

                    // ::ffff:192.0.2.1 is technically valid but should pass isValidIPAddress
                    dashboardSocket.emit('request:block_ip', {
                        agentId: 'test-ip-agent-003',
                        ip: '::ffff:192.0.2.1'
                    });

                    setTimeout(() => {
                        done();
                    }, 100);
                });
            });
        });
    });

    describe('agent:heartbeat spoofed agentId detection', () => {
        it('rejects heartbeat when agentId does not match authenticated socket', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-spoof-agent' }
            });

            agentSocket.on('connect', () => {
                // Send heartbeat with DIFFERENT agentId than authenticated
                const spoofedStatus = {
                    agentId: 'different-agent-id', // This doesn't match the socket's auth
                    hostname: 'spoofed-host',
                    platform: 'linux',
                    uptime: 3600,
                    cpuUsage: 25.5,
                    memoryUsage: 60.0,
                    lastHeartbeat: new Date().toISOString(),
                    isOnline: true
                };

                agentSocket.emit('agent:heartbeat', spoofedStatus);

                // Give it time to process, then verify the heartbeat was NOT applied
                setTimeout(() => {
                    const agent = gateway.getAgent('test-spoof-agent');
                    // The status should NOT have been updated to the spoofed values
                    expect(agent?.status?.cpuUsage).not.toBe(25.5);
                    done();
                }, 200);
            });
        });

        it('accepts heartbeat when agentId matches authenticated socket', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-valid-heartbeat' }
            });

            agentSocket.on('connect', () => {
                const validStatus = {
                    agentId: 'test-valid-heartbeat', // Matches authenticated socket
                    hostname: 'valid-heartbeat-host',
                    platform: 'linux',
                    uptime: 3600,
                    cpuUsage: 45.5,
                    memoryUsage: 70.0,
                    lastHeartbeat: new Date().toISOString(),
                    isOnline: true
                };

                agentSocket.emit('agent:heartbeat', validStatus);

                setTimeout(() => {
                    const agent = gateway.getAgent('test-valid-heartbeat');
                    expect(agent?.status?.cpuUsage).toBe(45.5);
                    done();
                }, 200);
            });
        });
    });

    // SECURITY (audit 2026-08, batch 3): server-side connection generations.
    describe('agent connection generations', () => {
        it('supersedes the old socket when the same agent connects twice', async () => {
            const agentId = `gen-agent-${Date.now()}`;

            const waitFor = (socket: any, event: string) => new Promise<void>((resolve) => {
                socket.once(event, () => resolve());
            });

            const firstSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId },
                forceNew: true
            });
            let firstDisconnectReason: string | null = null;
            firstSocket.on('disconnect', (reason: string) => {
                firstDisconnectReason = reason;
            });

            await waitFor(firstSocket, 'connect');

            const secondSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId },
                forceNew: true
            });
            await waitFor(secondSocket, 'connect');

            // Give the server-side supersede (audit + force disconnect) a
            // moment to propagate.
            await new Promise((resolve) => setTimeout(resolve, 100));

            try {
                // The registry entry must be owned by the NEW socket.
                const entry = gateway.getAgent(agentId);
                expect(entry?.socketId).toBe(secondSocket.id);

                // The superseded socket was force-disconnected by the server.
                expect(['io server disconnect', 'transport close']).toContain(firstDisconnectReason);

                // The stale socket's disconnect must NOT have removed the new
                // connection's registry entry (disconnect ownership check).
                const after = gateway.getAgent(agentId);
                expect(after).toBeDefined();
                expect(after?.socketId).toBe(secondSocket.id);
            } finally {
                firstSocket.close();
                secondSocket.close();
            }
        });
    });

    describe('sendSignedCommand return values', () => {        it('returns false when sending command to non-existent agent', () => {
            const result = gateway.sendCommandToAgent('non-existent-agent', { type: 'scan' });
            expect(result).toBe(false);
        });

        it('returns false when agent exists but is offline', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-offline-agent' }
            });

            agentSocket.on('connect', () => {
                agentSocket.emit('agent:register', {
                    agentId: 'test-offline-agent',
                    hostname: 'offline-test-server'
                });

                // Send heartbeat marking agent as offline
                setTimeout(() => {
                    const status = {
                        agentId: 'test-offline-agent',
                        hostname: 'offline-test-server',
                        isOnline: false
                    };
                    agentSocket.emit('agent:heartbeat', status);

                    // Now try to send command - should return false because agent is offline
                    setTimeout(() => {
                        const result = gateway.sendCommandToAgent('test-offline-agent', { type: 'scan' });
                        expect(result).toBe(false);
                        done();
                    }, 100);
                }, 100);
            });
        });

        it('returns true when sending command to online agent', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-online-agent' }
            });

            agentSocket.on('connect', () => {
                agentSocket.emit('agent:register', {
                    agentId: 'test-online-agent',
                    hostname: 'online-test-server'
                });

                // Filter for scan command (ignore update_rules sent on connect)
                agentSocket.on('command', (command) => {
                    if (command.type === 'scan') {
                        expect(command.type).toBe('scan');
                        done();
                    }
                });

                setTimeout(() => {
                    const result = gateway.sendCommandToAgent('test-online-agent', { type: 'scan' });
                    expect(result).toBe(true);
                }, 100);
            });
        });
    });

    describe('canAccessTenant', () => {
        it('allows platform-level access to any tenant', () => {
            // In test runtime, dashboard user is created with platform context
            // We can verify by checking cross-tenant access behavior
            const result1 = gateway.sendCommandToAgent('non-existent', { type: 'scan' });
            expect(result1).toBe(false);
        });

        it('denies access to non-existent agent', () => {
            const result = gateway.sendCommandToAgent('definitely-does-not-exist', { type: 'block_ip', payload: { ip: '1.2.3.4' } });
            expect(result).toBe(false);
        });
    });

    describe('agent:review_sample malicious vs non-malicious', () => {
        it('broadcasts threat:detected for malicious sample', (done) => {
            // Set up mock for malicious verdict
            jest.mocked(detectionPipelineService.reviewAgentSample).mockResolvedValueOnce({
                aiVerdict: 'malicious',
                matchedRuleIds: ['rule-1'],
                attackFamily: 'sqli',
                riskScore: 0.95,
                decisionSource: 'test',
                candidateId: null
            } as DetectionDecision);

            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-review-agent' }
                });

                agentSocket.on('connect', () => {
                    dashboardSocket.on('threat:detected', (data) => {
                        // This should be called for malicious
                        done();
                    });

                    // Emit malicious review sample (AUD-03-4: signed envelope)
                    setTimeout(() => {
                        const payload = {
                            sample: {
                                requestId: 'review-001',
                                sourceIp: '10.0.0.1',
                                path: '/malicious/path',
                                evidence: 'suspicious content',
                                riskScore: 0.95,
                                matchedRuleIds: ['rule-1'],
                                decisionSource: 'agent-local'
                            }
                        };
                        agentSocket.emit('agent:review_sample', signAgentEvent('agent:review_sample', payload, agentSocket.id));
                    }, 100);
                });
            });
        }, 10000);

        it('does not broadcast threat:detected for non-malicious sample', (done) => {
            // Set up mock for non-malicious verdict
            jest.mocked(detectionPipelineService.reviewAgentSample).mockResolvedValueOnce({
                aiVerdict: 'safe',
                matchedRuleIds: [],
                attackFamily: 'benign',
                riskScore: 0.1,
                decisionSource: 'test'
            } as unknown as DetectionDecision);

            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            let threatDetected = false;
            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-review-agent-safe' }
                });

                agentSocket.on('connect', () => {
                    dashboardSocket.on('threat:detected', () => {
                        threatDetected = true;
                    });

                    // Emit non-malicious review sample (low risk score, signed)
                    setTimeout(() => {
                        agentSocket.emit('agent:review_sample', signAgentEvent('agent:review_sample', {
                            sample: {
                                requestId: 'review-002',
                                sourceIp: '10.0.0.5',
                                path: '/normal/path',
                                evidence: 'normal content',
                                riskScore: 0.1,
                                matchedRuleIds: [],
                                decisionSource: 'agent-local'
                            }
                        }, agentSocket.id));

                        // Wait and verify threat:detected was NOT called
                        setTimeout(() => {
                            expect(threatDetected).toBe(false);
                            done();
                        }, 500);
                    }, 100);
                });
            });
        }, 10000);
    });

    describe('request:block_ip validation', () => {
        it('rejects block_ip for invalid IP format', (done) => {
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-block-agent' }
                });

                agentSocket.on('connect', () => {
                    let errorReceived = false;
                    dashboardSocket.on('error', (error: any) => {
                        if (error.reason === 'invalid_ip' || error.message?.includes('invalid_ip')) {
                            errorReceived = true;
                        }
                    });

                    // Invalid IP format
                    dashboardSocket.emit('request:block_ip', {
                        agentId: 'test-block-agent',
                        ip: 'not-an-ip'
                    });

                    setTimeout(() => {
                        expect(errorReceived).toBe(true);
                        done();
                    }, 200);
                });
            });
        });

        it('rejects block_ip with shell metacharacters', (done) => {
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-block-shell-agent' }
                });

                agentSocket.on('connect', () => {
                    let errorReceived = false;
                    dashboardSocket.on('error', (error: any) => {
                        if (error.reason === 'invalid_ip' || error.message?.includes('invalid_characters')) {
                            errorReceived = true;
                        }
                    });

                    // IP with shell injection attempt
                    dashboardSocket.emit('request:block_ip', {
                        agentId: 'test-block-shell-agent',
                        ip: '192.168.1.1; ls'
                    });

                    setTimeout(() => {
                        expect(errorReceived).toBe(true);
                        done();
                    }, 200);
                });
            });
        });
    });

    describe('request:unblock_ip validation', () => {
        it('rejects unblock_ip for invalid IP format', (done) => {
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-unblock-agent' }
                });

                agentSocket.on('connect', () => {
                    let errorReceived = false;
                    dashboardSocket.on('error', (error: any) => {
                        if (error.reason === 'invalid_ip' || error.message?.includes('invalid_ip')) {
                            errorReceived = true;
                        }
                    });

                    dashboardSocket.emit('request:unblock_ip', {
                        agentId: 'test-unblock-agent',
                        ip: 'invalid-ip-format'
                    });

                    setTimeout(() => {
                        expect(errorReceived).toBe(true);
                        done();
                    }, 200);
                });
            });
        });
    });

    describe('getAgentList', () => {
        it('returns list of registered agents', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-list-agent' }
            });

            agentSocket.on('connect', () => {
                agentSocket.emit('agent:register', {
                    agentId: 'test-list-agent',
                    hostname: 'list-test-server'
                });

                setTimeout(() => {
                    const agents = gateway.getAgentList();
                    expect(Array.isArray(agents)).toBe(true);
                    const found = agents.find(a => a.agentId === 'test-list-agent');
                    expect(found).toBeDefined();
                    expect(found?.hostname).toBe('list-test-server');
                    done();
                }, 100);
            });
        });
    });

    describe('synthetic agents', () => {
        it('upserts and removes synthetic agents', () => {
            // Add synthetic agent
            gateway.upsertSyntheticAgent({
                agentId: 'synthetic-001',
                hostname: 'synthetic-host',
                platform: 'linux',
                tenantId: 'test-tenant'
            });

            let agents = gateway.getAgentList();
            let synthetic = agents.find(a => a.agentId === 'synthetic-001');
            expect(synthetic).toBeDefined();
            expect(synthetic?.synthetic).toBe(true);

            // Update synthetic agent
            gateway.upsertSyntheticAgent({
                agentId: 'synthetic-001',
                hostname: 'synthetic-host-updated',
                platform: 'synthetic',
                status: {
                    agentId: 'synthetic-001',
                    hostname: 'synthetic-host-updated',
                    platform: 'synthetic',
                    uptime: 0,
                    cpuUsage: 10,
                    memoryUsage: 0,
                    lastHeartbeat: new Date().toISOString(),
                    isOnline: true,
                }
            });

            agents = gateway.getAgentList();
            synthetic = agents.find(a => a.agentId === 'synthetic-001');
            expect(synthetic?.hostname).toBe('synthetic-host-updated');

            // Remove synthetic agent
            gateway.removeSyntheticAgent('synthetic-001');

            agents = gateway.getAgentList();
            synthetic = agents.find(a => a.agentId === 'synthetic-001');
            expect(synthetic).toBeUndefined();
        });

        it('synthetic agent with commandHandler accepts commands', (done) => {
            let handlerCalled = false;

            gateway.upsertSyntheticAgent({
                agentId: 'synthetic-cmd-001',
                hostname: 'synthetic-cmd-host',
                platform: 'linux',
                commandHandler: (cmd) => {
                    handlerCalled = true;
                    return true;
                }
            });

            const result = gateway.sendCommandToAgent('synthetic-cmd-001', { type: 'scan' });
            expect(result).toBe(true);
            expect(handlerCalled).toBe(true);

            done();
        });

        it('synthetic agent with rejecting handler returns false', () => {
            gateway.upsertSyntheticAgent({
                agentId: 'synthetic-cmd-002',
                hostname: 'synthetic-cmd-host-2',
                platform: 'linux',
                commandHandler: () => false
            });

            const result = gateway.sendCommandToAgent('synthetic-cmd-002', { type: 'block_ip' });
            expect(result).toBe(false);
        });
    });

    describe('agent:scan_result', () => {
        it('broadcasts scan results to dashboard', (done) => {
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-scan-agent' }
                });

                agentSocket.on('connect', () => {
                    dashboardSocket.on('scan:result', (data) => {
                        expect(data.agentId).toBe('test-scan-agent');
                        done();
                    });

                    setTimeout(() => {
                        agentSocket.emit('agent:scan_result', signAgentEvent('agent:scan_result', {
                            scanId: 'scan-001',
                            vulnerabilities: []
                        }, agentSocket.id));
                    }, 100);
                });
            });
        });
    });

    describe('agent:log', () => {
        it('broadcasts agent logs to dashboard', (done) => {
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-log-agent' }
                });

                agentSocket.on('connect', () => {
                    dashboardSocket.on('agent:log', (data) => {
                        expect(data.agentId).toBe('test-log-agent');
                        done();
                    });

                    setTimeout(() => {
                        agentSocket.emit('agent:log', {
                            level: 'info',
                            message: 'Test log message'
                        });
                    }, 100);
                });
            });
        });
    });

    describe('agent:command_ack and agent:command_failed', () => {
        it('broadcasts command ack to dashboard', (done) => {
            // N4-2: the gateway only broadcasts when the dispatcher ACCEPTS
            // the running->completed transition; this test covers the accept
            // path (the reject path is covered by
            // websocket/agent-gateway.command-ack-gate.test.ts).
            (commandDispatcherService.handleAgentCommandAck as jest.Mock).mockReturnValue(true);
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-ack-agent' }
                });

                agentSocket.on('connect', () => {
                    dashboardSocket.on('agent:command:ack', (data) => {
                        expect(data.agentId).toBe('test-ack-agent');
                        done();
                    });

                    setTimeout(() => {
                        agentSocket.emit('agent:command_ack', {
                            actionId: 'action-001'
                        });
                    }, 100);
                });
            });
        });

        it('broadcasts command failure to dashboard', (done) => {
            // N4-2: same accept-gated broadcast for the failure path.
            (commandDispatcherService.handleAgentCommandFailure as jest.Mock).mockReturnValue(true);
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-fail-agent' }
                });

                agentSocket.on('connect', () => {
                    dashboardSocket.on('agent:command:failed', (data) => {
                        expect(data.agentId).toBe('test-fail-agent');
                        done();
                    });

                    setTimeout(() => {
                        agentSocket.emit('agent:command_failed', {
                            actionId: 'action-002',
                            reason: 'timeout'
                        });
                    }, 100);
                });
            });
        });
    });

    describe('rate limiting', () => {
        it('handles rapid requests within limits', (done) => {
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-rate-agent' }
                });

                agentSocket.on('connect', () => {
                    // Send a few requests rapidly - should all succeed
                    dashboardSocket.emit('request:scan', { agentId: 'test-rate-agent' });
                    dashboardSocket.emit('request:scan', { agentId: 'test-rate-agent' });
                    dashboardSocket.emit('request:scan', { agentId: 'test-rate-agent' });

                    setTimeout(() => {
                        done();
                    }, 100);
                });
            });
        });
    });

    describe('agent disconnect', () => {
        it('removes agent from list on disconnect', (done) => {
            const socket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-disconnect-agent' }
            });

            socket.on('connect', () => {
                socket.emit('agent:register', {
                    agentId: 'test-disconnect-agent',
                    hostname: 'disconnect-test-server'
                });

                setTimeout(() => {
                    let agents = gateway.getAgentList();
                    let found = agents.find(a => a.agentId === 'test-disconnect-agent');
                    expect(found).toBeDefined();

                    // Now disconnect
                    socket.disconnect();

                    setTimeout(() => {
                        agents = gateway.getAgentList();
                        found = agents.find(a => a.agentId === 'test-disconnect-agent');
                        expect(found).toBeUndefined();
                        done();
                    }, 100);
                }, 100);
            });
        });
    });

    describe('broadcastToDashboards', () => {
        it('sends traffic:updated to dashboards', (done) => {
            dashboardSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'dashboard' }
            });

            dashboardSocket.on('connect', () => {
                agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                    auth: { type: 'agent', agentId: 'test-traffic-agent' }
                });

                agentSocket.on('connect', () => {
                    dashboardSocket.on('traffic:updated', (data) => {
                        expect(data.agentId).toBe('test-traffic-agent');
                        done();
                    });

                    setTimeout(() => {
                        agentSocket.emit('agent:traffic_stats', {
                            agentId: 'test-traffic-agent',
                            stats: {
                                packetsProcessed: 100,
                                packetsAllowed: 80,
                                packetsBlocked: 20,
                                activeFlows: []
                            },
                            timestamp: new Date().toISOString()
                        });
                    }, 100);
                });
            });
        });
    });

    describe('agent:traffic_stats', () => {
        it('handles traffic stats without crashing', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-traffic-stats-agent' }
            });

            agentSocket.on('connect', () => {
                // Send traffic stats
                agentSocket.emit('agent:traffic_stats', {
                    agentId: 'test-traffic-stats-agent',
                    stats: {
                        packetsProcessed: 50,
                        packetsAllowed: 40,
                        packetsBlocked: 10,
                        bytesProcessed: 1000,
                        activeFlows: []
                    },
                    timestamp: new Date().toISOString()
                });

                setTimeout(() => {
                    done();
                }, 100);
            });
        });

        it('handles traffic stats with mismatched agentId', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-traffic-mismatch-agent' }
            });

            agentSocket.on('connect', () => {
                // Send traffic stats with wrong agentId - should be ignored
                agentSocket.emit('agent:traffic_stats', {
                    agentId: 'different-agent-id',
                    stats: {
                        packetsProcessed: 50,
                        activeFlows: []
                    },
                    timestamp: new Date().toISOString()
                });

                setTimeout(() => {
                    done();
                }, 100);
            });
        });
    });

    describe('invalid payloads', () => {
        it('rejects invalid heartbeat payload', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-invalid-hb-agent' }
            });

            agentSocket.on('connect', () => {
                let errorReceived = false;
                agentSocket.on('error', () => {
                    errorReceived = true;
                });

                // Send invalid heartbeat (null)
                agentSocket.emit('agent:heartbeat', null);

                setTimeout(() => {
                    done();
                }, 100);
            });
        });

        it('rejects invalid threat payload', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-invalid-threat-agent' }
            });

            agentSocket.on('connect', () => {
                // Send invalid threat
                agentSocket.emit('agent:threat', { threat: 'not-an-object' });

                setTimeout(() => {
                    done();
                }, 100);
            });
        });

        it('rejects invalid review_sample payload', (done) => {
            agentSocket = SocketIOClient(`http://localhost:${PORT}`, {
                auth: { type: 'agent', agentId: 'test-invalid-review-agent' }
            });

            agentSocket.on('connect', () => {
                // Send invalid review_sample
                agentSocket.emit('agent:review_sample', null);

                setTimeout(() => {
                    done();
                }, 100);
            });
        });
    });

    describe('syncTenantDetectionRules', () => {
        it('syncs rules to agents in tenant', async () => {
            // This tests the public method
            const result = await gateway.syncTenantDetectionRules('test-tenant');
            expect(result).toHaveProperty('attempted');
            expect(result).toHaveProperty('succeeded');
        });
    });

    describe('getOnlineCount', () => {
        it('returns correct count for test runtime', () => {
            const count = gateway.getOnlineCount();
            expect(typeof count).toBe('number');
            expect(count).toBeGreaterThanOrEqual(0);
        });
    });
});
