/**
 * FluxGuard E2E Demo Script
 * 
 * 模拟真实的生产环境场景：
 * 1. Agent 连接并注册
 * 2. 发送系统状态心跳
 * 3. 检测并上报安全威胁
 * 4. 接收平台下发的指令
 */

import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';
const AGENT_ID = `agent-demo-${Date.now().toString(36)}`;

interface AgentStatus {
    agentId: string;
    hostname: string;
    platform: string;
    uptime: number;
    cpuUsage: number;
    memoryUsage: number;
    lastHeartbeat: string;
    isOnline: boolean;
}

interface ThreatAlert {
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    sourceIP: string;
    destPort: number;
    description: string;
    payload?: string;
    autoBlock?: boolean;
}

class DemoAgent {
    private socket: Socket | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private threatInterval: NodeJS.Timeout | null = null;

    // 模拟威胁数据
    private readonly mockThreats: ThreatAlert[] = [
        {
            type: 'sql_injection',
            severity: 'critical',
            sourceIP: '192.168.1.100',
            destPort: 443,
            description: 'SQL注入攻击尝试',
            payload: "' OR 1=1 --",
            autoBlock: true
        },
        {
            type: 'xss_attack',
            severity: 'high',
            sourceIP: '10.0.0.55',
            destPort: 80,
            description: 'XSS跨站脚本攻击',
            payload: '<script>alert("xss")</script>'
        },
        {
            type: 'brute_force',
            severity: 'high',
            sourceIP: '203.0.113.50',
            destPort: 22,
            description: 'SSH暴力破解尝试 (50次失败登录)',
            autoBlock: true
        },
        {
            type: 'port_scan',
            severity: 'medium',
            sourceIP: '172.16.0.99',
            destPort: 0,
            description: '端口扫描活动检测 (扫描了100+端口)'
        },
        {
            type: 'ddos_attack',
            severity: 'critical',
            sourceIP: '45.33.32.156',
            destPort: 443,
            description: 'DDoS攻击 - 异常流量峰值 (10000 req/s)',
            autoBlock: true
        }
    ];

    async start(): Promise<void> {
        console.log('🚀 启动 FluxGuard Demo Agent...\n');
        console.log(`   Agent ID: ${AGENT_ID}`);
        console.log(`   Server:   ${SERVER_URL}`);
        console.log('');

        await this.connect();
        this.startHeartbeat();
        this.startThreatSimulation();

        console.log('\n📊 Demo 运行中... 按 Ctrl+C 停止\n');
    }

    private async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log('🔌 正在连接到控制平台...');

            this.socket = io(SERVER_URL, {
                auth: {
                    type: 'agent',
                    agentId: AGENT_ID
                },
                reconnection: true,
                timeout: 10000
            });

            this.socket.on('connect', () => {
                console.log('✅ 已连接到控制平台');
                this.register();
                resolve();
            });

            this.socket.on('disconnect', () => {
                console.log('⚠️  与控制平台断开连接');
            });

            this.socket.on('connect_error', (err) => {
                console.error('❌ 连接失败:', err.message);
            });

            // 监听平台下发的指令
            this.socket.on('command', (cmd) => {
                console.log(`\n📥 收到指令: ${cmd.type}`);
                this.handleCommand(cmd);
            });

            setTimeout(() => {
                if (!this.socket?.connected) {
                    console.log('⚠️  连接超时，继续运行...');
                    resolve();
                }
            }, 5000);
        });
    }

    private register(): void {
        if (!this.socket) return;

        const registration = {
            agentId: AGENT_ID,
            hostname: 'demo-web-server',
            platform: 'linux',
            arch: 'x64',
            cpus: 8,
            totalMemory: 16 * 1024 * 1024 * 1024, // 16GB
            version: '2.0.0'
        };

        this.socket.emit('agent:register', registration);
        console.log('📝 Agent 已注册');
    }

    private startHeartbeat(): void {
        const sendHeartbeat = () => {
            if (!this.socket?.connected) return;

            const status: AgentStatus = {
                agentId: AGENT_ID,
                hostname: 'demo-web-server',
                platform: 'linux',
                uptime: Math.floor(process.uptime()),
                cpuUsage: Math.floor(20 + Math.random() * 40), // 20-60%
                memoryUsage: Math.floor(40 + Math.random() * 30), // 40-70%
                lastHeartbeat: new Date().toISOString(),
                isOnline: true
            };

            this.socket.emit('agent:heartbeat', status);
            console.log(`💓 心跳: CPU ${status.cpuUsage}% | 内存 ${status.memoryUsage}%`);
        };

        // 立即发送一次
        sendHeartbeat();

        // 每 10 秒发送一次
        this.heartbeatInterval = setInterval(sendHeartbeat, 10000);
    }

    private startThreatSimulation(): void {
        let threatIndex = 0;

        const sendThreat = () => {
            if (!this.socket?.connected) return;

            const threat = this.mockThreats[threatIndex % this.mockThreats.length];
            threatIndex++;

            const alertData = {
                agentId: AGENT_ID,
                threat: {
                    ...threat,
                    timestamp: new Date().toISOString()
                },
                timestamp: new Date().toISOString()
            };

            this.socket.emit('agent:threat', alertData);

            const severityEmoji = {
                low: '🟢',
                medium: '🟡',
                high: '🟠',
                critical: '🔴'
            };

            console.log(`${severityEmoji[threat.severity]} 威胁告警: [${threat.severity.toUpperCase()}] ${threat.type} - ${threat.description}`);
            console.log(`   来源: ${threat.sourceIP}:${threat.destPort}`);
            if (threat.autoBlock) {
                console.log(`   ⛔ 已自动封禁 IP: ${threat.sourceIP}`);
            }
        };

        // 5秒后开始，每 8 秒发送一个威胁
        setTimeout(() => {
            sendThreat();
            this.threatInterval = setInterval(sendThreat, 8000);
        }, 5000);
    }

    private handleCommand(cmd: { type: string; payload?: any }): void {
        switch (cmd.type) {
            case 'scan':
                console.log('   🔍 开始安全扫描...');
                setTimeout(() => {
                    console.log('   ✅ 扫描完成: 发现 3 个中等风险漏洞');
                    this.socket?.emit('agent:scan_result', {
                        agentId: AGENT_ID,
                        vulnerabilities: 3,
                        status: 'completed'
                    });
                }, 3000);
                break;

            case 'block_ip':
                console.log(`   ⛔ 封禁 IP: ${cmd.payload?.ip}`);
                break;

            case 'unblock_ip':
                console.log(`   ✅ 解封 IP: ${cmd.payload?.ip}`);
                break;

            default:
                console.log(`   ❓ 未知指令: ${cmd.type}`);
        }
    }

    stop(): void {
        console.log('\n🛑 停止 Demo Agent...');

        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        if (this.threatInterval) {
            clearInterval(this.threatInterval);
        }
        if (this.socket) {
            this.socket.disconnect();
        }

        console.log('👋 Demo 结束');
    }
}

// 主函数
async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('       FluxGuard Pro - 交付演示测试');
    console.log('═══════════════════════════════════════════════════════\n');

    const agent = new DemoAgent();

    // 处理退出信号
    process.on('SIGINT', () => {
        agent.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        agent.stop();
        process.exit(0);
    });

    try {
        await agent.start();
    } catch (error) {
        console.error('Demo 启动失败:', error);
        process.exit(1);
    }
}

main();
