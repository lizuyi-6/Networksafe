/**
 * FluxGuard E2E Demo Script
 * 
 * 模拟真实的生产环境场景
 */

import { io, Socket } from 'socket.io-client';

const SERVER_URL = 'http://localhost:8080';
const AGENT_ID = `agent-demo-${Date.now().toString(36)}`;

const mockThreats = [
    { type: 'sql_injection', severity: 'critical', sourceIP: '192.168.1.100', description: 'SQL注入攻击' },
    { type: 'xss_attack', severity: 'high', sourceIP: '10.0.0.55', description: 'XSS跨站脚本攻击' },
    { type: 'brute_force', severity: 'high', sourceIP: '203.0.113.50', description: 'SSH暴力破解' },
    { type: 'port_scan', severity: 'medium', sourceIP: '172.16.0.99', description: '端口扫描' },
    { type: 'ddos_attack', severity: 'critical', sourceIP: '45.33.32.156', description: 'DDoS攻击' }
];

async function runDemo() {
    console.log('═══════════════════════════════════════════════');
    console.log('       FluxGuard Pro - 交付演示测试');
    console.log('═══════════════════════════════════════════════\n');
    console.log(`Agent ID: ${AGENT_ID}`);
    console.log(`Server:   ${SERVER_URL}\n`);

    const socket = io(SERVER_URL, {
        auth: { type: 'agent', agentId: AGENT_ID }
    });

    socket.on('connect', () => {
        console.log('✅ 已连接到控制平台');

        // Register
        socket.emit('agent:register', {
            agentId: AGENT_ID,
            hostname: 'demo-web-server',
            platform: 'linux',
            arch: 'x64',
            version: '2.0.0'
        });
        console.log('📝 Agent 已注册\n');
    });

    socket.on('command', (cmd) => {
        console.log(`📥 收到指令: ${cmd.type}`);
    });

    // Heartbeat
    setInterval(() => {
        if (socket.connected) {
            const cpu = Math.floor(20 + Math.random() * 40);
            const mem = Math.floor(40 + Math.random() * 30);
            socket.emit('agent:heartbeat', {
                agentId: AGENT_ID,
                hostname: 'demo-web-server',
                platform: 'linux',
                uptime: Math.floor(process.uptime()),
                cpuUsage: cpu,
                memoryUsage: mem,
                lastHeartbeat: new Date().toISOString(),
                isOnline: true
            });
            console.log(`💓 心跳: CPU ${cpu}% | 内存 ${mem}%`);
        }
    }, 10000);

    // Threat simulation
    let threatIdx = 0;
    setInterval(() => {
        if (socket.connected) {
            const threat = mockThreats[threatIdx % mockThreats.length];
            threatIdx++;

            socket.emit('agent:threat', {
                agentId: AGENT_ID,
                threat: { ...threat, timestamp: new Date().toISOString() },
                timestamp: new Date().toISOString()
            });

            const emoji = threat.severity === 'critical' ? '🔴' : threat.severity === 'high' ? '🟠' : '🟡';
            console.log(`${emoji} 威胁: [${threat.severity}] ${threat.type} - ${threat.description} (来自 ${threat.sourceIP})`);
        }
    }, 8000);

    console.log('📊 Demo 运行中... 按 Ctrl+C 停止\n');
}

runDemo().catch(console.error);
