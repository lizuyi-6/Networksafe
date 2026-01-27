/**
 * Agent Gateway Unit Tests
 * 
 * Tests WebSocket communication between agents and the control platform
 */

import { Server as HttpServer, createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client';
import { AgentGateway } from '../websocket/agent-gateway';

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

    afterAll((done) => {
        // Close all connections
        if (agentSocket?.connected) agentSocket.disconnect();
        if (dashboardSocket?.connected) dashboardSocket.disconnect();

        gateway.close();
        httpServer.close(() => {
            done();
        });
    });

    afterEach(() => {
        // Disconnect sockets after each test
        if (agentSocket?.connected) agentSocket.disconnect();
        if (dashboardSocket?.connected) dashboardSocket.disconnect();
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

                setTimeout(() => {
                    const agent = gateway.getAgent('test-agent-003');
                    expect(agent).toBeDefined();
                    expect(agent?.status?.cpuUsage).toBe(25.5);
                    done();
                }, 100);
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

                // Listen for command
                agentSocket.on('command', (command) => {
                    expect(command.type).toBe('scan');
                    done();
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
});
