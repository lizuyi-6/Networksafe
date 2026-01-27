/**
 * WebSocket 网关 - Agent 通信中心
 * 
 * 功能:
 * - 接收 Agent 注册和心跳
 * - 推送告警到前端
 * - 下发指令到 Agent
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import logger from '../utils/logger';
import { AgentStatus, ThreatAlert } from '../agent';

interface ConnectedAgent {
    socketId: string;
    agentId: string;
    registration: any;
    lastHeartbeat: Date;
    status: AgentStatus | null;
}

export class AgentGateway {
    private io: SocketIOServer;
    private agents: Map<string, ConnectedAgent> = new Map();
    private dashboardClients: Set<string> = new Set();

    constructor(httpServer: HttpServer) {
        this.io = new SocketIOServer(httpServer, {
            cors: {
                origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
                methods: ['GET', 'POST']
            }
        });

        this.setupEventHandlers();
        logger.info('Agent Gateway initialized');
    }

    /**
     * 设置事件处理器
     */
    private setupEventHandlers(): void {
        this.io.on('connection', (socket: Socket) => {
            logger.info(`New connection: ${socket.id}`);

            // 判断是 Agent 还是 Dashboard 客户端
            const clientType = socket.handshake.auth.type || 'dashboard';

            if (clientType === 'agent') {
                this.handleAgentConnection(socket);
            } else {
                this.handleDashboardConnection(socket);
            }

            socket.on('disconnect', () => {
                this.handleDisconnect(socket);
            });
        });
    }

    /**
     * 处理 Agent 连接
     */
    private handleAgentConnection(socket: Socket): void {
        const agentId = socket.handshake.auth.agentId;

        if (!agentId) {
            logger.warn('Agent connection without ID, rejecting');
            socket.disconnect();
            return;
        }

        logger.info(`Agent connected: ${agentId}`);

        // Agent 注册
        socket.on('agent:register', (registration: any) => {
            const agent: ConnectedAgent = {
                socketId: socket.id,
                agentId: registration.agentId,
                registration,
                lastHeartbeat: new Date(),
                status: null
            };

            this.agents.set(agentId, agent);

            // 通知 Dashboard 客户端
            this.broadcastToDashboards('agent:online', {
                agentId,
                registration
            });

            logger.info(`Agent registered: ${agentId}`, { registration });
        });

        // Agent 心跳
        socket.on('agent:heartbeat', (status: AgentStatus) => {
            const agent = this.agents.get(agentId);
            if (agent) {
                agent.lastHeartbeat = new Date();
                agent.status = status;
            }

            // 转发状态到 Dashboard
            this.broadcastToDashboards('agent:status', status);
        });

        // Agent 威胁告警
        socket.on('agent:threat', (data: { agentId: string; threat: ThreatAlert; timestamp: string }) => {
            logger.warn(`Threat from ${data.agentId}`, { threat: data.threat });

            // 转发到所有 Dashboard 客户端
            this.broadcastToDashboards('threat:detected', data);
        });

        // Agent 扫描结果
        socket.on('agent:scan_result', (data: any) => {
            logger.info(`Scan result from ${agentId}`);
            this.broadcastToDashboards('scan:result', data);
        });

        // Agent 日志
        socket.on('agent:log', (log: any) => {
            this.broadcastToDashboards('agent:log', { agentId, log });
        });
    }

    /**
     * 处理 Dashboard 连接
     */
    private handleDashboardConnection(socket: Socket): void {
        logger.info(`Dashboard client connected: ${socket.id}`);
        this.dashboardClients.add(socket.id);

        // 发送当前 Agent 列表
        socket.emit('agents:list', this.getAgentList());

        // Dashboard 请求扫描
        socket.on('request:scan', (data: { agentId: string }) => {
            this.sendCommandToAgent(data.agentId, { type: 'scan' });
        });

        // Dashboard 请求封禁 IP
        socket.on('request:block_ip', (data: { agentId: string; ip: string }) => {
            this.sendCommandToAgent(data.agentId, {
                type: 'block_ip',
                payload: { ip: data.ip }
            });
        });

        // Dashboard 请求解封 IP
        socket.on('request:unblock_ip', (data: { agentId: string; ip: string }) => {
            this.sendCommandToAgent(data.agentId, {
                type: 'unblock_ip',
                payload: { ip: data.ip }
            });
        });
    }

    /**
     * 处理断开连接
     */
    private handleDisconnect(socket: Socket): void {
        // 检查是否是 Agent
        for (const [agentId, agent] of this.agents) {
            if (agent.socketId === socket.id) {
                this.agents.delete(agentId);
                this.broadcastToDashboards('agent:offline', { agentId });
                logger.info(`Agent disconnected: ${agentId}`);
                return;
            }
        }

        // 否则是 Dashboard 客户端
        this.dashboardClients.delete(socket.id);
        logger.info(`Dashboard client disconnected: ${socket.id}`);
    }

    /**
     * 广播消息到所有 Dashboard 客户端
     */
    private broadcastToDashboards(event: string, data: any): void {
        for (const clientId of this.dashboardClients) {
            this.io.to(clientId).emit(event, data);
        }
    }

    /**
     * 发送指令到指定 Agent
     */
    sendCommandToAgent(agentId: string, command: { type: string; payload?: any }): boolean {
        const agent = this.agents.get(agentId);
        if (!agent) {
            logger.warn(`Agent not found: ${agentId}`);
            return false;
        }

        this.io.to(agent.socketId).emit('command', command);
        logger.info(`Command sent to ${agentId}: ${command.type}`);
        return true;
    }

    /**
     * 获取所有 Agent 列表
     */
    getAgentList(): any[] {
        return Array.from(this.agents.values()).map(agent => ({
            agentId: agent.agentId,
            registration: agent.registration,
            lastHeartbeat: agent.lastHeartbeat,
            status: agent.status,
            isOnline: true
        }));
    }

    /**
     * 获取指定 Agent
     */
    getAgent(agentId: string): ConnectedAgent | undefined {
        return this.agents.get(agentId);
    }

    /**
     * 获取在线 Agent 数量
     */
    getOnlineCount(): number {
        return this.agents.size;
    }

    /**
     * 关闭网关
     */
    close(): void {
        this.io.close();
        logger.info('Agent Gateway closed');
    }
}
