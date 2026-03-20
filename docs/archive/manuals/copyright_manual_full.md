# AetherGuard 智能服务器安全防御平台
## 用户操作手册与技术规范说明书 V1.0.0

**申请单位**: (填写您的公司或个人名称)
**日期**: 2026年1月24日

---

## 目录

1.  **系统概述**
    *   1.1 产品简介
    *   1.2 核心架构
    *   1.3 运行环境要求
2.  **功能模块详解**
    *   2.1 全局态势感知 (Dashboard)
    *   2.2 分布式 Agent 节点管理
    *   2.3 站点防护策略 (Sites)
    *   2.4 自动化部署向导
    *   2.5 硬件化运维 (ESP32 Devices)
    *   2.6 主动漏洞扫描 (Scanner)
    *   2.7 历史审计与报表
    *   2.8 告警中心
    *   2.9 AI 智能配置
    *   2.10 系统管理
3.  **技术实现细节**
    *   3.1 API 接口规范
    *   3.2 硬件通信协议
    *   3.3 数据库设计
4.  **附录**

---

## 1. 系统概述

### 1.1 产品简介
AetherGuard 是一款下一代基于 Agent 的分布式服务器安全防御系统。它彻底重构了传统防火墙架构，采用创新的 **"中心化控制 + 分布式执行 + 硬件级部署"** 三位一体防御体系。既能防御常见的 SQL 注入、XSS 攻击，又能通过 AI 分析识别复杂的业务逻辑漏洞。

### 1.2 核心架构
系统采用 "Control Plane" (控制平面) 与 "Data Plane" (数据平面) 分离的设计：
*   **Hub (中枢)**: 负责策略下发、AI 运算、数据聚合。
*   **Agent (探针)**: 驻留在业务服务器，负责流量采集与阻断执行。
*   **Dongle (硬件)**: 物理密钥与带外管理通道。

### 1.3 运行环境要求
*   **服务端**: Linux (Ubuntu 20.04+), 4 Core CPU, 8GB RAM
*   **客户端**: Chrome 90+, Edge 90+, Firefox 88+

---

## 2. 功能模块详解

### 2.1 全局态势感知 (Dashboard)
系统首页提供了上帝视角的安全监控能力。
*   **实时流量图**: 展示全网 QPS 与恶意请求拦截量。
*   **攻击源分布**: 基于 IP 地理位置的威胁热力图。
*   **节点健康度**: 实时展示所有在线 Agent 的 CPU/内存负载。

![全局态势感知界面](assets/dashboard.png)

### 2.2 分布式 Agent 节点管理
在此模块集中管理所有已接入的服务器节点。
*   **状态监控**: 列表展示每个节点的在线状态、最后心跳时间。
*   **版本管理**: 支持一键对指定节点进行热更新。
*   **资源预警**: 当节点负载超过 80% 时自动标记为警告状态。

![Agent管理界面](assets/agents.png)

### 2.3 站点防护策略 (Sites)
针对不同的业务域名配置独立的防护规则。
*   **策略开关**: 一键开启/关闭 WAF 模块、CC 防护模块。
*   **敏感度调节**: 设置 AI 分析的阈值（高/中/低/即使阻断）。
*   **白名单管理**: 配置信任 IP 段与特权路径。

![站点管理界面](assets/sites.png)

### 2.4 自动化部署向导
为降低运维成本，系统内置了脚本生成器。
*   **多系统适配**: 自动检测 OS 是 Ubuntu 还是 CentOS。
*   **Token 注入**: 生成的脚本中已包含一次性认证 Token。
*   **一键复制**: 运维人员只需复制一行 curl 命令即可完成部署。

![部署向导界面](assets/deploy.png)

### 2.5 硬件化运维 (ESP32 Devices)
这是本系统的特色功能，通过物理硬件增强安全性。
*   **设备列表**: 展示所有插入了 Deployment Dongle 的物理机。
*   **远程控制**: 下发 Shell 指令到硬件端执行。
*   **物理确认**: 高危操作需人工按下硬件上的物理按钮才可执行。

![硬件管理界面](assets/devices.png)

### 2.6 主动漏洞扫描 (Scanner)
结合 Nuclei 引擎的主动防御模块。
*   **任务编排**: 设置定期扫描任务（如每周一凌晨 3 点）。
*   **漏洞库更新**: 自动从云端同步最新的 CVE 特征库。
*   **报告生成**: 扫描结束后自动生成 PDF 修复建议报告。

![扫描器界面](assets/scanner.png)

### 2.7 历史审计与报表 (History)
详细记录每一次攻防对抗的时间、源 IP、攻击载荷。
*   **攻击回溯**: 查看被 AI 拦截的原始 HTTP 请求包。
*   **证据留存**: 所有的拦截记录均包含数字签名，防篡改。

![历史记录界面](assets/history.png)

### 2.8 告警中心 (Alerts)
聚合展示所有级别的安全事件。
*   **告警分级**: Critical (严重), Warning (警告), Info (提示)。
*   **通知渠道**: 支持配置 SMTP 邮件、Slack Webhook、钉钉机器人。

![告警列表界面](assets/alerts.png)

### 2.9 AI 智能配置 (Settings)
配置系统的 "大脑"。
*   **模型选择**: 可以在轻量级本地模型与高性能云端模型间切换。
*   **隐私模式**: 开启后，敏感数据仅在本地进行向量化处理。

![AI配置界面](assets/settings_ai.png)

### 2.10 系统管理 (Admin)
*   **API Key 管理**: 为第三方系统颁发访问令牌。
*   **用户管理**: 添加/删除管理员账户，重置密码。

![系统管理界面](assets/admin.png)

---

## 3. 技术实现细节 (API 设计)

为了保证扩展性，系统通过 RESTful API 对外暴露能力。以下是核心接口定义：

### 3.1 鉴权模块 (Auth)
```typescript
// POST /api/auth/login
// 用户登录接口，返回 JWT Token
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    // ... 验证逻辑 ...
    const token = jwt.sign({ id: user.id }, config.JWT_SECRET);
    res.json({ token });
});
```

### 3.2 节点通信 (Agent)
```typescript
// WebSocket /ws/agent
// Agent 与 Hub 保持长连接
ws.on('connection', (socket) => {
    socket.on('heartbeat', (data) => {
        // 更新节点状态
        AgentService.updateStatus(data.id, data.status);
    });
});
```

### 3.3 硬件协议 (ESP32)
```cpp
// 硬件端采用紧凑二进制协议
struct Packet {
    uint8_t magic;      // 0xA5
    uint8_t cmd_id;     // 指令ID
    uint16_t length;    // 载荷长度
    uint8_t payload[];  // 变长数据
};
```

*(此处省略后续 5000 行详细代码及数据库 Schema 定义...)*
import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';

const router = Router();

// 妯℃嫙鐢ㄦ埛閿欒鏁版嵁
router.get('/errors', AdminController.getErrors);

// 妯℃嫙绯荤粺鎬ц兘鏁版嵁
router.get('/performance', AdminController.getPerformance);

// 鎺ユ敹鏃ュ織鐨勭鐐?
router.post('/logs', AdminController.submitLogs);

export default router;

/**
 * Agent 绠＄悊 API 璺敱
 */

import { Router, Request, Response } from 'express';
import logger from '../../utils/logger';

const router = Router();

// Agent Gateway 寮曠敤 (灏嗙敱 index.ts 娉ㄥ叆)
let agentGateway: any = null;

export function setAgentGateway(gateway: any): void {
    agentGateway = gateway;
}

/**
 * GET /api/agents
 * 鑾峰彇鎵€鏈夊凡杩炴帴鐨?Agent 鍒楄〃
 */
router.get('/', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const agents = agentGateway.getAgentList();
        res.json({
            success: true,
            count: agents.length,
            agents
        });
    } catch (error: any) {
        logger.error('Failed to get agents', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/agents/:id
 * 鑾峰彇鎸囧畾 Agent 璇︽儏
 */
router.get('/:id', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const agent = agentGateway.getAgent(req.params.id);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        res.json({
            success: true,
            agent: {
                agentId: agent.agentId,
                registration: agent.registration,
                lastHeartbeat: agent.lastHeartbeat,
                status: agent.status,
                isOnline: true
            }
        });
    } catch (error: any) {
        logger.error('Failed to get agent', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/agents/:id/scan
 * 瑙﹀彂鎸囧畾 Agent 杩愯瀹夊叏鎵弿
 */
router.post('/:id/scan', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const success = agentGateway.sendCommandToAgent(req.params.id, { type: 'scan' });

        if (!success) {
            return res.status(404).json({ error: 'Agent not found or offline' });
        }

        res.json({
            success: true,
            message: 'Scan command sent'
        });
    } catch (error: any) {
        logger.error('Failed to trigger scan', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/agents/:id/block
 * 閫氳繃鎸囧畾 Agent 灏佺 IP
 */
router.post('/:id/block', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const { ip, duration } = req.body;

        if (!ip) {
            return res.status(400).json({ error: 'IP address required' });
        }

        const success = agentGateway.sendCommandToAgent(req.params.id, {
            type: 'block_ip',
            payload: { ip, duration: duration || 3600 }
        });

        if (!success) {
            return res.status(404).json({ error: 'Agent not found or offline' });
        }

        res.json({
            success: true,
            message: `Block command sent for IP: ${ip}`
        });
    } catch (error: any) {
        logger.error('Failed to block IP', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/agents/:id/unblock
 * 閫氳繃鎸囧畾 Agent 瑙ｅ皝 IP
 */
router.post('/:id/unblock', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const { ip } = req.body;

        if (!ip) {
            return res.status(400).json({ error: 'IP address required' });
        }

        const success = agentGateway.sendCommandToAgent(req.params.id, {
            type: 'unblock_ip',
            payload: { ip }
        });

        if (!success) {
            return res.status(404).json({ error: 'Agent not found or offline' });
        }

        res.json({
            success: true,
            message: `Unblock command sent for IP: ${ip}`
        });
    } catch (error: any) {
        logger.error('Failed to unblock IP', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/agents/stats/summary
 * 鑾峰彇 Agent 缁熻鎽樿
 */
router.get('/stats/summary', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const agents = agentGateway.getAgentList();

        res.json({
            success: true,
            summary: {
                totalAgents: agents.length,
                onlineAgents: agents.filter((a: any) => a.isOnline).length,
                offlineAgents: 0, // TODO: 瀹炵幇绂荤嚎璺熻釜
                lastUpdated: new Date().toISOString()
            }
        });
    } catch (error: any) {
        logger.error('Failed to get stats', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
/**
 * AetherGuard - AI 妯″瀷绔偣閰嶇疆 API
 * 
 * 涓?ESP32 绂荤嚎妯″紡鎻愪緵澶氭ā鍨嬬鐐归厤缃?
 * 浼樺厛绾? 鐢ㄦ埛鑷畾涔夋湇鍔″櫒 > 绗旇鏈湰鍦版ā鍨?
 */

import { Router, Request, Response } from 'express';
import logger from '../../utils/logger';

const router = Router();

// AI 绔偣閰嶇疆缁撴瀯
interface AIEndpoint {
    id: string;
    name: string;           // 鏄剧ず鍚嶇О
    url: string;            // API 绔偣 URL
    modelName: string;      // 妯″瀷鍚嶇О
    apiKey: string;         // API 瀵嗛挜 (鍔犲瘑瀛樺偍)
    enabled: boolean;       // 鏄惁鍚敤
    priority: number;       // 浼樺厛绾?(鏁板瓧瓒婂皬瓒婁紭鍏?
    timeout: number;        // 瓒呮椂鏃堕棿 (ms)
    type: 'ollama' | 'openai' | 'custom'; // 绔偣绫诲瀷
    lastTest?: {
        success: boolean;
        latency: number;
        timestamp: string;
    };
}

// 瀛樺偍 (鍐呭瓨 + 鍚庣画鍙寔涔呭寲)
const endpoints = new Map<string, AIEndpoint>();

// 鍒濆鍖栭粯璁ょ鐐?
function initDefaults() {
    // 榛樿绗旇鏈鐐?
    endpoints.set('default-laptop', {
        id: 'default-laptop',
        name: '鏈湴绗旇鏈?(Ollama)',
        url: 'http://192.168.4.1:5000/api/analyze',
        modelName: 'llama3',
        apiKey: '',
        enabled: true,
        priority: 100, // 鏈€浣庝紭鍏堢骇 (浣滀负鍏滃簳)
        timeout: 10000,
        type: 'ollama'
    });
}

initDefaults();

/**
 * GET /api/ai-endpoints
 * 鑾峰彇鎵€鏈?AI 绔偣閰嶇疆
 */
router.get('/', (_req: Request, res: Response) => {
    try {
        const sortedEndpoints = Array.from(endpoints.values())
            .sort((a, b) => a.priority - b.priority)
            .map(ep => ({
                ...ep,
                apiKey: ep.apiKey ? '******' : '', // 闅愯棌瀵嗛挜
            }));

        res.json({
            success: true,
            endpoints: sortedEndpoints,
        });
    } catch (error: any) {
        logger.error('Failed to get AI endpoints', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/ai-endpoints
 * 娣诲姞鏂扮殑 AI 绔偣
 */
router.post('/', (req: Request, res: Response) => {
    try {
        const { name, url, modelName, apiKey, type, timeout, priority } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: 'URL is required' });
        }

        const id = `custom-${Date.now()}`;

        const endpoint: AIEndpoint = {
            id,
            name: name || `Custom Endpoint ${endpoints.size}`,
            url,
            modelName: modelName || 'default',
            apiKey: apiKey || '',
            enabled: true,
            priority: priority ?? 10,
            timeout: timeout || 15000,
            type: type || 'custom',
        };

        endpoints.set(id, endpoint);

        logger.info('AI endpoint added', { id, url });

        res.json({
            success: true,
            endpoint: {
                ...endpoint,
                apiKey: endpoint.apiKey ? '******' : '',
            },
        });
    } catch (error: any) {
        logger.error('Failed to add AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * PUT /api/ai-endpoints/:id
 * 鏇存柊 AI 绔偣
 */
router.put('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const endpoint = endpoints.get(id);

        if (!endpoint) {
            return res.status(404).json({ success: false, error: 'Endpoint not found' });
        }

        // 鏇存柊瀛楁
        if (req.body.name) endpoint.name = req.body.name;
        if (req.body.url) endpoint.url = req.body.url;
        if (req.body.modelName) endpoint.modelName = req.body.modelName;
        if (req.body.apiKey) endpoint.apiKey = req.body.apiKey;
        if (req.body.enabled !== undefined) endpoint.enabled = req.body.enabled;
        if (req.body.priority !== undefined) endpoint.priority = req.body.priority;
        if (req.body.timeout) endpoint.timeout = req.body.timeout;

        endpoints.set(id, endpoint);

        logger.info('AI endpoint updated', { id });

        res.json({
            success: true,
            endpoint: {
                ...endpoint,
                apiKey: endpoint.apiKey ? '******' : '',
            },
        });
    } catch (error: any) {
        logger.error('Failed to update AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * DELETE /api/ai-endpoints/:id
 * 鍒犻櫎 AI 绔偣
 */
router.delete('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // 涓嶅厑璁稿垹闄ら粯璁ょ鐐?
        if (id === 'default-laptop') {
            return res.status(400).json({ success: false, error: 'Cannot delete default endpoint' });
        }

        if (!endpoints.has(id)) {
            return res.status(404).json({ success: false, error: 'Endpoint not found' });
        }

        endpoints.delete(id);

        logger.info('AI endpoint deleted', { id });

        res.json({
            success: true,
            message: `Endpoint ${id} deleted`,
        });
    } catch (error: any) {
        logger.error('Failed to delete AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/ai-endpoints/:id/test
 * 娴嬭瘯 AI 绔偣杩為€氭€?
 */
router.post('/:id/test', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const endpoint = endpoints.get(id);

        if (!endpoint) {
            return res.status(404).json({ success: false, error: 'Endpoint not found' });
        }

        const startTime = Date.now();

        try {
            // 鍙戦€佹祴璇曡姹?
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), endpoint.timeout);

            const response = await fetch(endpoint.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(endpoint.apiKey && { 'Authorization': `Bearer ${endpoint.apiKey}` }),
                },
                body: JSON.stringify({
                    model: endpoint.modelName,
                    prompt: 'test connection',
                    stream: false,
                }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            const latency = Date.now() - startTime;
            const success = response.ok;

            // 鏇存柊娴嬭瘯缁撴灉
            endpoint.lastTest = {
                success,
                latency,
                timestamp: new Date().toISOString(),
            };
            endpoints.set(id, endpoint);

            res.json({
                success,
                latency,
                status: response.status,
            });
        } catch (fetchError: any) {
            const latency = Date.now() - startTime;

            endpoint.lastTest = {
                success: false,
                latency,
                timestamp: new Date().toISOString(),
            };
            endpoints.set(id, endpoint);

            res.json({
                success: false,
                latency,
                error: fetchError.message,
            });
        }
    } catch (error: any) {
        logger.error('Failed to test AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /api/ai-endpoints/sync-config
 * 鑾峰彇 ESP32 鍚屾閰嶇疆 (绱у噾鏍煎紡)
 */
router.get('/sync-config', (_req: Request, res: Response) => {
    try {
        // 鍙繑鍥炲惎鐢ㄧ殑绔偣锛屾寜浼樺厛绾ф帓搴?
        const enabledEndpoints = Array.from(endpoints.values())
            .filter(ep => ep.enabled)
            .sort((a, b) => a.priority - b.priority)
            .map(ep => ({
                url: ep.url,
                model: ep.modelName,
                key: ep.apiKey,
            }));

        res.json({
            success: true,
            endpoints: enabledEndpoints,
        });
    } catch (error: any) {
        logger.error('Failed to get sync config', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// 瀵煎嚭杈呭姪鍑芥暟
export function getEndpointList(): AIEndpoint[] {
    return Array.from(endpoints.values())
        .filter(ep => ep.enabled)
        .sort((a, b) => a.priority - b.priority);
}

export default router;
/**
 * Authentication Routes
 * 
 * Handles user registration, login, and token management
 */

import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import {
    AuthenticatedRequest,
    generateTokens,
    verifyRefreshToken,
    authenticate
} from '../../middleware/auth.middleware';
import { getDatabase } from '../../config/database';
import logger from '../../utils/logger';

const router = Router();

// Password validation
const PASSWORD_MIN_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { email, password, username } = req.body;

        // Validate input
        if (!email || !password || !username) {
            return res.status(400).json({
                error: 'Email, password, and username are required',
                code: 'VALIDATION_ERROR'
            });
        }

        if (!EMAIL_REGEX.test(email)) {
            return res.status(400).json({
                error: 'Invalid email format',
                code: 'INVALID_EMAIL'
            });
        }

        if (password.length < PASSWORD_MIN_LENGTH) {
            return res.status(400).json({
                error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
                code: 'PASSWORD_TOO_SHORT'
            });
        }

        const db = getDatabase();

        // Check if user already exists
        const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (existingUser) {
            return res.status(409).json({
                error: 'Email already registered',
                code: 'USER_EXISTS'
            });
        }

        // Hash password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Create user
        const userId = uuidv4();
        const tenantId = uuidv4(); // Each user gets their own tenant by default
        const role = 'tenant'; // Default role

        db.prepare(`
      INSERT INTO users (id, email, username, password_hash, role, tenant_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(userId, email, username, passwordHash, role, tenantId);

        // Generate tokens
        const tokens = generateTokens({
            userId,
            email,
            username,
            role,
            tenantId
        });

        logger.info(`New user registered: ${email}`);

        res.status(201).json({
            message: 'User registered successfully',
            user: {
                userId,
                email,
                username,
                role,
                tenantId
            },
            ...tokens
        });

    } catch (error: any) {
        logger.error('Registration error', { error: error.message });
        res.status(500).json({
            error: 'Registration failed',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * POST /api/auth/login
 * Authenticate user and return tokens
 */
router.post('/login', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: 'Email and password are required',
                code: 'VALIDATION_ERROR'
            });
        }

        const db = getDatabase();

        // Find user
        const user = db.prepare(`
      SELECT id, email, username, password_hash, role, tenant_id, status
      FROM users WHERE email = ?
    `).get(email) as any;

        if (!user) {
            return res.status(401).json({
                error: 'Invalid credentials',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Check if account is active
        if (user.status === 'suspended') {
            return res.status(403).json({
                error: 'Account suspended',
                code: 'ACCOUNT_SUSPENDED'
            });
        }

        // Verify password
        const passwordValid = await bcrypt.compare(password, user.password_hash);
        if (!passwordValid) {
            logger.warn(`Failed login attempt for: ${email}`);
            return res.status(401).json({
                error: 'Invalid credentials',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Update last login
        db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(user.id);

        // Generate tokens
        const tokens = generateTokens({
            userId: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            tenantId: user.tenant_id
        });

        logger.info(`User logged in: ${email}`);

        res.json({
            message: 'Login successful',
            user: {
                userId: user.id,
                email: user.email,
                username: user.username,
                role: user.role,
                tenantId: user.tenant_id
            },
            ...tokens
        });

    } catch (error: any) {
        logger.error('Login error', { error: error.message });
        res.status(500).json({
            error: 'Login failed',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                error: 'Refresh token required',
                code: 'TOKEN_MISSING'
            });
        }

        const decoded = verifyRefreshToken(refreshToken);
        if (!decoded) {
            return res.status(401).json({
                error: 'Invalid or expired refresh token',
                code: 'TOKEN_INVALID'
            });
        }

        const db = getDatabase();

        // Get user info
        const user = db.prepare(`
      SELECT id, email, username, role, tenant_id, status
      FROM users WHERE id = ?
    `).get(decoded.userId) as any;

        if (!user || user.status === 'suspended') {
            return res.status(401).json({
                error: 'User not found or suspended',
                code: 'USER_INVALID'
            });
        }

        // Generate new tokens
        const tokens = generateTokens({
            userId: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            tenantId: user.tenant_id
        });

        res.json({
            message: 'Token refreshed',
            ...tokens
        });

    } catch (error: any) {
        logger.error('Token refresh error', { error: error.message });
        res.status(500).json({
            error: 'Token refresh failed',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * GET /api/auth/me
 * Get current user info (requires authentication)
 */
router.get('/me', authenticate, (req: AuthenticatedRequest, res: Response) => {
    res.json({
        user: req.user
    });
});

/**
 * POST /api/auth/logout
 * Logout user (client should discard tokens)
 */
router.post('/logout', authenticate, (req: AuthenticatedRequest, res: Response) => {
    // In a production system, you might want to:
    // 1. Add token to a blacklist in Redis
    // 2. Invalidate all refresh tokens for this user
    // For now, we just acknowledge the logout

    logger.info(`User logged out: ${req.user?.email}`);

    res.json({
        message: 'Logout successful'
    });
});

/**
 * PUT /api/auth/password
 * Change user password
 */
router.put('/password', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'Current and new password required',
                code: 'VALIDATION_ERROR'
            });
        }

        if (newPassword.length < PASSWORD_MIN_LENGTH) {
            return res.status(400).json({
                error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
                code: 'PASSWORD_TOO_SHORT'
            });
        }

        const db = getDatabase();

        // Get current password hash
        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?')
            .get(req.user!.userId) as any;

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify current password
        const passwordValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!passwordValid) {
            return res.status(401).json({
                error: 'Current password is incorrect',
                code: 'INVALID_PASSWORD'
            });
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 12);

        // Update password
        db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(newPasswordHash, req.user!.userId);

        logger.info(`Password changed for user: ${req.user?.email}`);

        res.json({
            message: 'Password changed successfully'
        });

    } catch (error: any) {
        logger.error('Password change error', { error: error.message });
        res.status(500).json({
            error: 'Password change failed',
            code: 'INTERNAL_ERROR'
        });
    }
});

export default router;
import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
    // Mock config
    res.json({
        antiBot: {
            enabled: true,
            requestThreshold: 100,
            fastRequestThreshold: 10,
            blockDuration: 3600,
        },
        rateLimit: {
            requestsPerMinute: 60,
            windowSeconds: 60,
        },
    });
});

router.post('/', (req, res) => {
    // Mock save
    res.json({ success: true, message: 'Configuration saved' });
});

export default router;
/**
 * AetherGuard - ESP32 璁惧绠＄悊 API
 * 
 * 鎻愪緵 ESP32 纭欢缃戝叧鐨?REST API 鎺ュ彛
 */

import { Router, Request, Response } from 'express';
import logger from '../../utils/logger';

const router = Router();

// 璁惧瀛樺偍 (鍐呭瓨 + 鍚庣画鍙墿灞曞埌鏁版嵁搴?
interface DeviceInfo {
    deviceId: string;
    version: string;
    chipModel: string;
    flashSize: number;
    freeHeap: number;
    sdkVersion: string;
    mode: 'online' | 'offline';
    isOnline: boolean;
    lastHeartbeat: Date;
    connectedAgents: string[];
    status?: {
        cpuUsage: number;
        memoryUsage: number;
        uptime: number;
        wifiRssi: number;
    };
    systemInfo?: {
        hostname: string;
        os: string;
        kernel: string;
        arch: string;
    };
}

const devices = new Map<string, DeviceInfo>();

// 瀵嗙爜鏈?
const codebook: Record<string, string> = {
    'E001': 'Connection refused',
    'E002': 'Permission denied',
    'E003': 'Out of memory',
    'E004': 'Disk full',
    'E005': 'Service unavailable',
    'S001': 'CPU usage critical (>90%)',
    'S002': 'Memory usage critical (>85%)',
    'S003': 'Disk usage critical (>90%)',
    'A001': 'SQL Injection detected',
    'A002': 'XSS attempt blocked',
    'A003': 'Path traversal attempt',
    'A004': 'Command injection detected',
    'A005': 'Brute force attack',
    'A006': 'DDoS pattern detected',
};

/**
 * GET /api/devices
 * 鑾峰彇鎵€鏈?ESP32 璁惧鍒楄〃
 */
router.get('/', (_req: Request, res: Response) => {
    try {
        const deviceList = Array.from(devices.values()).map(device => ({
            ...device,
            lastHeartbeat: device.lastHeartbeat.toISOString(),
        }));

        res.json({
            success: true,
            total: deviceList.length,
            online: deviceList.filter(d => d.isOnline).length,
            devices: deviceList,
        });
    } catch (error: any) {
        logger.error('Failed to get devices', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /api/devices/:id
 * 鑾峰彇鍗曚釜璁惧璇︽儏
 */
router.get('/:id', (req: Request, res: Response) => {
    try {
        const device = devices.get(req.params.id);

        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        res.json({
            success: true,
            device: {
                ...device,
                lastHeartbeat: device.lastHeartbeat.toISOString(),
            },
        });
    } catch (error: any) {
        logger.error('Failed to get device', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/devices/:id/cmd
 * 鍙戦€佸懡浠ゅ埌璁惧
 */
router.post('/:id/cmd', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { command, params } = req.body;

        const device = devices.get(id);

        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        if (!device.isOnline) {
            return res.status(400).json({ success: false, error: 'Device is offline' });
        }

        // 璁板綍鍛戒护鏃ュ織
        logger.info('Command sent to device', {
            deviceId: id,
            command,
            params
        });

        // 瀹為檯鍙戦€佸懡浠ら渶瑕侀€氳繃 WebSocket Gateway
        // 杩欓噷杩斿洖鎴愬姛锛屽疄闄呭彂閫佸湪 device-gateway.ts 涓鐞?
        res.json({
            success: true,
            message: `Command "${command}" queued for device ${id}`,
        });
    } catch (error: any) {
        logger.error('Failed to send command', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * PUT /api/devices/:id
 * 鏇存柊璁惧閰嶇疆
 */
router.put('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const device = devices.get(id);

        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        // 鏇存柊鍙厤缃瓧娈?
        if (req.body.connectedAgents) {
            device.connectedAgents = req.body.connectedAgents;
        }

        devices.set(id, device);

        logger.info('Device updated', { deviceId: id });

        res.json({
            success: true,
            device: {
                ...device,
                lastHeartbeat: device.lastHeartbeat.toISOString(),
            },
        });
    } catch (error: any) {
        logger.error('Failed to update device', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * DELETE /api/devices/:id
 * 娉ㄩ攢璁惧
 */
router.delete('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        if (!devices.has(id)) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        devices.delete(id);

        logger.info('Device unregistered', { deviceId: id });

        res.json({
            success: true,
            message: `Device ${id} unregistered`,
        });
    } catch (error: any) {
        logger.error('Failed to delete device', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /api/devices/codebook
 * 鑾峰彇瀵嗙爜鏈?
 */
router.get('/codebook', (_req: Request, res: Response) => {
    res.json({
        success: true,
        codebook,
    });
});

/**
 * POST /api/devices/codebook
 * 鏇存柊瀵嗙爜鏈?
 */
router.post('/codebook', (req: Request, res: Response) => {
    try {
        const { entries } = req.body;

        if (!entries || typeof entries !== 'object') {
            return res.status(400).json({ success: false, error: 'Invalid entries' });
        }

        Object.assign(codebook, entries);

        logger.info('Codebook updated', { entriesAdded: Object.keys(entries).length });

        res.json({
            success: true,
            totalEntries: Object.keys(codebook).length,
        });
    } catch (error: any) {
        logger.error('Failed to update codebook', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// 瀵煎嚭璁惧绠＄悊鍑芥暟渚?WebSocket Gateway 浣跨敤
export function registerDevice(info: Omit<DeviceInfo, 'isOnline' | 'lastHeartbeat' | 'connectedAgents'>): void {
    const device: DeviceInfo = {
        ...info,
        isOnline: true,
        lastHeartbeat: new Date(),
        connectedAgents: [],
    };
    devices.set(info.deviceId, device);
    logger.info('Device registered', { deviceId: info.deviceId });
}

export function updateDeviceStatus(deviceId: string, status: DeviceInfo['status']): void {
    const device = devices.get(deviceId);
    if (device) {
        device.status = status;
        device.lastHeartbeat = new Date();
        devices.set(deviceId, device);
    }
}

export function setDeviceOffline(deviceId: string): void {
    const device = devices.get(deviceId);
    if (device) {
        device.isOnline = false;
        devices.set(deviceId, device);
        logger.info('Device went offline', { deviceId });
    }
}

export function getDeviceList(): DeviceInfo[] {
    return Array.from(devices.values());
}

export function getCodebook(): Record<string, string> {
    return codebook;
}

export default router;
import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
    // Mock logs
    res.json([
        {
            id: 1,
            time: new Date().toISOString(),
            type: 'ANTIBOT',
            level: 'WARN',
            message: 'Suspicious User-Agent detected: curl/7.68.0',
            ip: '192.168.1.100',
        },
        {
            id: 2,
            time: new Date(Date.now() - 15000).toISOString(),
            type: 'RATELIMIT',
            level: 'ERROR',
            message: 'Rate limit exceeded for user',
            ip: '10.0.0.55',
        }
    ]);
});

export default router;
import { Router, Request, Response } from 'express';
import { OptimizationEngine } from '../../scanner/optimization-engine';
import logger from '../../utils/logger';

const router = Router();
const optimizationEngine = new OptimizationEngine();

/**
 * POST /api/scanner/run
 * Run server scan
 */
router.post('/run', async (req: Request, res: Response) => {
  try {
    const options = req.body.options || {};

    logger.info('Starting server scan...');

    const result = await optimizationEngine.runFullScan(options);

    // Save scan result to database
    const db = require('../../config/database').getDatabase();
    const stmt = db.getDb().prepare(`
      INSERT INTO scan_results (siteId, scanType, result, recommendations, status)
      VALUES (NULL, 'all', ?, ?, 'completed')
    `);

    const resultId = stmt.run(
      JSON.stringify(result.systemInfo),
      JSON.stringify(result.recommendations)
    ).lastInsertRowid;

    res.json({
      success: true,
      data: {
        id: resultId,
        ...result
      }
    });
  } catch (error: any) {
    logger.error('Scan failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/scanner/apply
 * Apply an optimization
 */
router.post('/apply', async (req: Request, res: Response) => {
  try {
    const { recommendation } = req.body;

    if (!recommendation) {
      return res.status(400).json({ success: false, error: 'recommendation is required' });
    }

    logger.info(`Applying optimization: ${recommendation.title}`);

    const result = await optimizationEngine.applyOptimization(recommendation);

    res.json(result);
  } catch (error: any) {
    logger.error('Failed to apply optimization', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/scanner/results/:id
 * Get scan result by ID
 */
router.get('/results/:id', async (req: Request, res: Response) => {
  try {
    const db = require('../../config/database').getDatabase();
    const result = db.getDb().prepare('SELECT * FROM scan_results WHERE id = ?').get(req.params.id);

    if (!result) {
      return res.status(404).json({ success: false, error: 'Scan result not found' });
    }

    res.json({
      success: true,
      data: {
        ...result,
        result: JSON.parse(result.result),
        recommendations: JSON.parse(result.recommendations)
      }
    });
  } catch (error: any) {
    logger.error('Failed to get scan result', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/scanner/report/:id
 * Generate scan report
 */
router.get('/report/:id', async (req: Request, res: Response) => {
  try {
    const db = require('../../config/database').getDatabase();
    const result = db.getDb().prepare('SELECT * FROM scan_results WHERE id = ?').get(req.params.id);

    if (!result) {
      return res.status(404).json({ success: false, error: 'Scan result not found' });
    }

    const systemInfo = JSON.parse(result.result);
    const recommendations = JSON.parse(result.recommendations);

    const report = optimizationEngine.generateReport(systemInfo, recommendations);

    res.set('Content-Type', 'text/plain');
    res.send(report);
  } catch (error: any) {
    logger.error('Failed to generate report', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
    res.json([
        { id: 1, domain: 'api.example.com', status: 'secure' },
        { id: 2, domain: 'admin.example.com', status: 'warning' },
    ]);
});

export default router;
import { Router, Request, Response } from 'express';
import { getDatabase } from '../../config/database';
import logger from '../../utils/logger';

const router = Router();

/**
 * GET /api/sites
 * Get all sites
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDatabase().getDb();
    const sites = db.prepare('SELECT * FROM sites ORDER BY createdAt DESC').all();

    // Convert integer booleans
    const formattedSites = sites.map((site: any) => ({
      ...site,
      sslEnabled: Boolean(site.sslEnabled),
      antiBotEnabled: Boolean(site.antiBotEnabled),
      rateLimitEnabled: Boolean(site.rateLimitEnabled),
      concurrencyEnabled: Boolean(site.concurrencyEnabled)
    }));

    res.json({ success: true, data: formattedSites });
  } catch (error: any) {
    logger.error('Failed to get sites', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sites/:id
 * Get site by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase().getDb();
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);

    if (!site) {
      return res.status(404).json({ success: false, error: 'Site not found' });
    }

    res.json({ success: true, data: site });
  } catch (error: any) {
    logger.error('Failed to get site', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sites
 * Create new site
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { domain, target, sslEnabled = true, security } = req.body;

    if (!domain || !target) {
      return res.status(400).json({ success: false, error: 'domain and target are required' });
    }

    const db = getDatabase().getDb();

    const stmt = db.prepare(`
      INSERT INTO sites (
        domain, target, sslEnabled,
        antiBotEnabled, rateLimitEnabled, concurrencyEnabled,
        rateLimitRequests, concurrencyMax
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      domain,
      target,
      sslEnabled ? 1 : 0,
      security?.antiBot ? 1 : 0,
      security?.rateLimit?.enabled ? 1 : 0,
      security?.concurrency?.enabled ? 1 : 0,
      security?.rateLimit?.requestsPerMinute || 60,
      security?.concurrency?.maxConcurrent || 5
    );

    logger.info(`Site created: ${domain} -> ${target}`);

    res.json({
      success: true,
      data: { id: result.lastInsertRowid, domain, target }
    });
  } catch (error: any) {
    logger.error('Failed to create site', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/sites/:id
 * Update site
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { domain, target, sslEnabled, security } = req.body;

    const db = getDatabase().getDb();

    const stmt = db.prepare(`
      UPDATE sites SET
        domain = COALESCE(?, domain),
        target = COALESCE(?, target),
        sslEnabled = COALESCE(?, sslEnabled),
        antiBotEnabled = COALESCE(?, antiBotEnabled),
        rateLimitEnabled = COALESCE(?, rateLimitEnabled),
        concurrencyEnabled = COALESCE(?, concurrencyEnabled),
        rateLimitRequests = COALESCE(?, rateLimitRequests),
        concurrencyMax = COALESCE(?, concurrencyMax),
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(
      domain,
      target,
      sslEnabled !== undefined ? (sslEnabled ? 1 : 0) : null,
      security?.antiBot !== undefined ? (security.antiBot ? 1 : 0) : null,
      security?.rateLimit?.enabled !== undefined ? (security.rateLimit.enabled ? 1 : 0) : null,
      security?.concurrency?.enabled !== undefined ? (security.concurrency.enabled ? 1 : 0) : null,
      security?.rateLimit?.requestsPerMinute || null,
      security?.concurrency?.maxConcurrent || null,
      req.params.id
    );

    logger.info(`Site updated: ${req.params.id}`);

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to update site', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/sites/:id
 * Delete site
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase().getDb();
    db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);

    logger.info(`Site deleted: ${req.params.id}`);

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to delete site', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
import { Router, Request, Response } from 'express';
import { SmartFixer } from '../../scanner/smart-fixer';
import { OptimizationEngine } from '../../scanner/optimization-engine';
import logger from '../../utils/logger';

const router = Router();
const optimizationEngine = new OptimizationEngine();

/**
 * POST /api/scanner/smart-fix
 * Fix a problem using AI
 */
router.post('/smart-fix', async (req: Request, res: Response) => {
  try {
    const { recommendation, context, options } = req.body;

    if (!recommendation) {
      return res.status(400).json({ success: false, error: 'recommendation is required' });
    }

    logger.info(`Starting smart fix for: ${recommendation.title}`);

    // Create smart fixer with options
    const smartFixer = new SmartFixer({
      enableAI: options?.enableAI !== false,
      aiProvider: options?.aiProvider || {
        name: process.env.AI_PROVIDER || 'ollama',
        apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
        baseURL: process.env.AI_BASE_URL,
        model: process.env.AI_MODEL || 'llama2'
      },
      maxAttempts: options?.maxAttempts || 3,
      executionTimeout: options?.executionTimeout || 60000,
      enableRealTimeMonitoring: options?.enableRealTimeMonitoring !== false
    });

    // Run smart fix
    const result = await smartFixer.fixProblem(recommendation, context);

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    logger.error('Smart fix failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/scanner/batch-fix
 * Fix multiple problems in batch
 */
router.post('/batch-fix', async (req: Request, res: Response) => {
  try {
    const { recommendations, context, options } = req.body;

    if (!recommendations || !Array.isArray(recommendations)) {
      return res.status(400).json({ success: false, error: 'recommendations array is required' });
    }

    logger.info(`Batch fixing ${recommendations.length} problems`);

    const smartFixer = new SmartFixer(options);

    const results = await smartFixer.batchFix(recommendations, context);

    const summary = {
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      totalAttempts: results.reduce((sum, r) => sum + r.attempts.length, 0),
      totalTime: results.reduce((sum, r) => sum + r.totalTime, 0)
    };

    logger.info('Batch fix complete', { summary });

    res.json({
      success: true,
      data: {
        results,
        summary
      }
    });
  } catch (error: any) {
    logger.error('Batch fix failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/scanner/dry-fix
 * Simulate fixing without executing
 */
router.post('/dry-fix', async (req: Request, res: Response) => {
  try {
    const { recommendation, context, options } = req.body;

    if (!recommendation) {
      return res.status(400).json({ success: false, error: 'recommendation is required' });
    }

    logger.info(`Dry run for: ${recommendation.title}`);

    const smartFixer = new SmartFixer(options);

    const dryRunResult = await smartFixer.dryFix(recommendation, context);

    res.json({
      success: true,
      data: dryRunResult
    });
  } catch (error: any) {
    logger.error('Dry fix failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/scanner/ai-status
 * Check AI provider status
 */
router.get('/ai-status', async (req: Request, res: Response) => {
  try {
    const provider = {
      name: process.env.AI_PROVIDER || 'ollama',
      model: process.env.AI_MODEL || 'llama2',
      baseURL: process.env.AI_BASE_URL || 'http://localhost:11434',
      configured: !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.AI_BASE_URL)
    };

    // Test connection if configured
    let status = 'not_configured';
    let error = null;

    if (provider.configured) {
      try {
        if (provider.name === 'ollama') {
          // Test Ollama connection
          const axios = require('axios');
          await axios.get(`${provider.baseURL}/api/tags`, { timeout: 5000 });
          status = 'available';
        } else if (provider.name === 'openai' || provider.name === 'anthropic') {
          // Just check if API key is present
          status = 'available';
        }
      } catch (err: any) {
        status = 'unavailable';
        error = err.message;
      }
    }

    res.json({
      success: true,
      data: {
        provider,
        status,
        error
      }
    });
  } catch (error: any) {
    logger.error('AI status check failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/scanner/ai-analyze
 * Analyze a problem using AI
 */
router.post('/ai-analyze', async (req: Request, res: Response) => {
  try {
    const { problem, context } = req.body;

    if (!problem) {
      return res.status(400).json({ success: false, error: 'problem is required' });
    }

    const { AIEngine } = await import('../../scanner/ai-engine');

    const aiEngine = new AIEngine({
      name: (process.env.AI_PROVIDER || 'ollama') as any,
      apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.AI_BASE_URL,
      model: process.env.AI_MODEL || 'llama2'
    });

    const analysis = await aiEngine.analyzeProblem({
      problem,
      context: {
        systemInfo: context?.systemInfo || {},
        logs: context?.logs || [],
        configFiles: context?.configFiles || {}
      }
    });

    res.json({
      success: true,
      data: analysis
    });
  } catch (error: any) {
    logger.error('AI analysis failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
import { Router } from 'express';
import simulationService from '../../services/simulation.service';

const router = Router();

router.get('/', (req, res) => {
    res.json(simulationService.getStats());
});

export default router;
/**
 * AI 妯″瀷绔偣閰嶇疆缁勪欢
 * 
 * 鏀寔閰嶇疆澶氫釜 AI 妯″瀷鏉ユ簮锛?
 * - 鐢ㄦ埛绗旇鏈湰鍦版ā鍨?(Ollama)
 * - 鐢ㄦ埛鏈嶅姟鍣ㄩ儴缃茬殑澶фā鍨?
 * - 绗笁鏂?API (OpenAI 鍏煎)
 */

import { useState, useEffect } from 'react';
import {
    Brain, Plus, Trash2, TestTube,
    Server, Laptop, Globe, Check, X, Loader2,
    ChevronDown, ChevronUp, AlertCircle
} from 'lucide-react';

interface AIEndpoint {
    id: string;
    name: string;
    url: string;
    modelName: string;
    apiKey: string;
    enabled: boolean;
    priority: number;
    timeout: number;
    type: 'ollama' | 'openai' | 'custom';
    lastTest?: {
        success: boolean;
        latency: number;
        timestamp: string;
    };
}

interface AddEndpointFormData {
    name: string;
    url: string;
    modelName: string;
    apiKey: string;
    type: 'ollama' | 'openai' | 'custom';
    priority: number;
}

const AIEndpointSettings = () => {
    const [endpoints, setEndpoints] = useState<AIEndpoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [testingId, setTestingId] = useState<string | null>(null);

    const [formData, setFormData] = useState<AddEndpointFormData>({
        name: '',
        url: '',
        modelName: '',
        apiKey: '',
        type: 'ollama',
        priority: 10,
    });

    // 妯℃嫙绔偣鏁版嵁
    useEffect(() => {
        const mockEndpoints: AIEndpoint[] = [
            {
                id: 'default-laptop',
                name: '鏈湴绗旇鏈?(Ollama)',
                url: 'http://192.168.4.1:5000/api/analyze',
                modelName: 'llama3',
                apiKey: '',
                enabled: true,
                priority: 100,
                timeout: 10000,
                type: 'ollama',
                lastTest: {
                    success: true,
                    latency: 234,
                    timestamp: new Date().toISOString(),
                },
            },
        ];

        setTimeout(() => {
            setEndpoints(mockEndpoints);
            setLoading(false);
        }, 500);
    }, []);

    const handleAddEndpoint = () => {
        if (!formData.url) return;

        const newEndpoint: AIEndpoint = {
            id: `custom-${Date.now()}`,
            name: formData.name || `鑷畾涔夌鐐?${endpoints.length}`,
            url: formData.url,
            modelName: formData.modelName || 'default',
            apiKey: formData.apiKey,
            enabled: true,
            priority: formData.priority,
            timeout: 15000,
            type: formData.type,
        };

        setEndpoints(prev => [...prev, newEndpoint]);
        setShowAddForm(false);
        setFormData({
            name: '',
            url: '',
            modelName: '',
            apiKey: '',
            type: 'ollama',
            priority: 10,
        });
    };

    const handleDeleteEndpoint = (id: string) => {
        if (id === 'default-laptop') return;
        setEndpoints(prev => prev.filter(ep => ep.id !== id));
    };

    const handleToggleEndpoint = (id: string) => {
        setEndpoints(prev => prev.map(ep =>
            ep.id === id ? { ...ep, enabled: !ep.enabled } : ep
        ));
    };

    const handleTestEndpoint = async (id: string) => {
        setTestingId(id);

        // 妯℃嫙娴嬭瘯
        await new Promise(resolve => setTimeout(resolve, 1500));

        const success = Math.random() > 0.3;
        const latency = Math.floor(Math.random() * 500) + 100;

        setEndpoints(prev => prev.map(ep =>
            ep.id === id ? {
                ...ep,
                lastTest: {
                    success,
                    latency,
                    timestamp: new Date().toISOString(),
                },
            } : ep
        ));

        setTestingId(null);
    };

    const handlePriorityChange = (id: string, direction: 'up' | 'down') => {
        setEndpoints(prev => {
            const sorted = [...prev].sort((a, b) => a.priority - b.priority);
            const idx = sorted.findIndex(ep => ep.id === id);

            if (direction === 'up' && idx > 0) {
                const temp = sorted[idx].priority;
                sorted[idx].priority = sorted[idx - 1].priority;
                sorted[idx - 1].priority = temp;
            } else if (direction === 'down' && idx < sorted.length - 1) {
                const temp = sorted[idx].priority;
                sorted[idx].priority = sorted[idx + 1].priority;
                sorted[idx + 1].priority = temp;
            }

            return sorted;
        });
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'ollama': return <Laptop size={16} className="text-emerald-500" />;
            case 'openai': return <Globe size={16} className="text-blue-500" />;
            default: return <Server size={16} className="text-orange-500" />;
        }
    };

    const sortedEndpoints = [...endpoints].sort((a, b) => a.priority - b.priority);

    return (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            {/* Header */}
            <div className="flex justify-between items-center mb-5">
                <div className="flex items-center gap-2">
                    <Brain size={18} className="text-primary" />
                    <h3 className="font-semibold text-foreground">AI 妯″瀷绔偣閰嶇疆</h3>
                </div>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all"
                >
                    <Plus size={14} /> 娣诲姞绔偣
                </button>
            </div>

            {/* Info Banner */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertCircle size={16} className="text-blue-500 mt-0.5" />
                <div className="text-xs text-blue-700 dark:text-blue-300">
                    <strong>绂荤嚎妯″紡 AI 璋冪敤浼樺厛绾?</strong> 鎸夊垪琛ㄩ『搴忓皾璇曡皟鐢紝澶辫触鍒欒嚜鍔ㄩ檷绾у埌涓嬩竴涓鐐广€?
                    寤鸿灏嗗欢杩熸渶浣庣殑鏈嶅姟鍣ㄦ斁鍦ㄦ渶鍓嶉潰銆?
                </div>
            </div>

            {/* Add Form */}
            {showAddForm && (
                <div className="bg-muted/30 border border-border rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">绔偣鍚嶇О</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="渚嬪: 鐢熶骇鏈嶅姟鍣ㄦā鍨?
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">绫诲瀷</label>
                            <select
                                value={formData.type}
                                onChange={e => setFormData(prev => ({ ...prev, type: e.target.value as any }))}
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            >
                                <option value="ollama">Ollama</option>
                                <option value="openai">OpenAI 鍏煎</option>
                                <option value="custom">鑷畾涔?/option>
                            </select>
                        </div>
                    </div>

                    <div className="mb-4">
                        <label className="block text-xs text-muted-foreground mb-1">API 绔偣 URL *</label>
                        <input
                            type="text"
                            value={formData.url}
                            onChange={e => setFormData(prev => ({ ...prev, url: e.target.value }))}
                            placeholder="http://your-server:5000/api/analyze"
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">妯″瀷鍚嶇О</label>
                            <input
                                type="text"
                                value={formData.modelName}
                                onChange={e => setFormData(prev => ({ ...prev, modelName: e.target.value }))}
                                placeholder="llama3 / gpt-4 / qwen"
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">API Key (鍙€?</label>
                            <input
                                type="password"
                                value={formData.apiKey}
                                onChange={e => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                                placeholder="sk-..."
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => setShowAddForm(false)}
                            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            鍙栨秷
                        </button>
                        <button
                            onClick={handleAddEndpoint}
                            disabled={!formData.url}
                            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            娣诲姞
                        </button>
                    </div>
                </div>
            )}

            {/* Endpoints List */}
            {loading ? (
                <div className="text-center py-8 text-muted-foreground">
                    <Loader2 size={24} className="mx-auto mb-2 animate-spin" />
                    鍔犺浇涓?..
                </div>
            ) : sortedEndpoints.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                    鏆傛棤閰嶇疆鐨?AI 绔偣
                </div>
            ) : (
                <div className="space-y-3">
                    {sortedEndpoints.map((endpoint, index) => (
                        <div
                            key={endpoint.id}
                            className={`border rounded-lg p-4 transition-all ${endpoint.enabled
                                ? 'border-border bg-card'
                                : 'border-border/50 bg-muted/20 opacity-60'
                                }`}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3">
                                    {/* Priority Controls */}
                                    <div className="flex flex-col items-center">
                                        <button
                                            onClick={() => handlePriorityChange(endpoint.id, 'up')}
                                            disabled={index === 0}
                                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                        >
                                            <ChevronUp size={14} />
                                        </button>
                                        <span className="text-xs font-bold text-muted-foreground">{index + 1}</span>
                                        <button
                                            onClick={() => handlePriorityChange(endpoint.id, 'down')}
                                            disabled={index === sortedEndpoints.length - 1}
                                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                        >
                                            <ChevronDown size={14} />
                                        </button>
                                    </div>

                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            {getTypeIcon(endpoint.type)}
                                            <span className="font-medium text-foreground">{endpoint.name}</span>
                                            {endpoint.id === 'default-laptop' && (
                                                <span className="px-1.5 py-0.5 text-xxs bg-primary/10 text-primary rounded">榛樿</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground mb-1">{endpoint.url}</div>
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <span>妯″瀷: {endpoint.modelName}</span>
                                            {endpoint.lastTest && (
                                                <span className={`flex items-center gap-1 ${endpoint.lastTest.success ? 'text-emerald-500' : 'text-red-500'
                                                    }`}>
                                                    {endpoint.lastTest.success ? <Check size={12} /> : <X size={12} />}
                                                    {endpoint.lastTest.latency}ms
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleTestEndpoint(endpoint.id)}
                                        disabled={testingId === endpoint.id}
                                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all"
                                        title="娴嬭瘯杩炴帴"
                                    >
                                        {testingId === endpoint.id ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <TestTube size={16} />
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleToggleEndpoint(endpoint.id)}
                                        className={`p-2 rounded-lg transition-all ${endpoint.enabled
                                            ? 'text-emerald-500 hover:bg-emerald-500/10'
                                            : 'text-muted-foreground hover:bg-muted'
                                            }`}
                                        title={endpoint.enabled ? '绂佺敤' : '鍚敤'}
                                    >
                                        {endpoint.enabled ? <Check size={16} /> : <X size={16} />}
                                    </button>
                                    {endpoint.id !== 'default-laptop' && (
                                        <button
                                            onClick={() => handleDeleteEndpoint(endpoint.id)}
                                            className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                            title="鍒犻櫎"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Footer */}
            <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
                <strong>璋冪敤閫昏緫:</strong> 鎸変紭鍏堢骇椤哄簭灏濊瘯姣忎釜鍚敤鐨勭鐐癸紝棣栦釜鎴愬姛鍝嶅簲灏嗚閲囩敤銆?
                濡傛灉鎵€鏈夎嚜瀹氫箟绔偣澶辫触锛屽皢鍥為€€鍒版湰鍦扮瑪璁版湰妯″瀷銆?
            </div>
        </div>
    );
};

export default AIEndpointSettings;
import React from 'react';

interface ErrorDisplayProps {
    title?: string;
    message: string;
    onRetry?: () => void;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
    title = 'Error Loading Data',
    message,
    onRetry
}) => {
    return (
        <div className="p-8 flex flex-col items-center justify-center text-red-500">
            <p className="text-xl font-bold mb-2">{title}</p>
            <p className="text-sm font-mono bg-red-50 p-3 rounded border border-red-100">
                {message}
            </p>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
                >
                    Retry
                </button>
            )}
        </div>
    );
};

export default ErrorDisplay;
import React from 'react';
import { motion } from 'framer-motion';
import logoImg from '../assets/logo_new.png';

// Types for the subscription tiers
export type PlanTier = 'starter' | 'professional' | 'enterprise' | null;

interface LogoProps {
    tier?: PlanTier;
    className?: string;
    showText?: boolean;
}

const Logo: React.FC<LogoProps> = ({ tier, className = "", showText = true }) => {
    // Badge Configuration
    const getBadgeConfig = (tier: PlanTier) => {
        switch (tier) {
            case 'starter':
                return { text: 'STARTER', color: 'bg-gray-700 text-gray-200 border-gray-500' };
            case 'professional':
                return { text: 'PRO', color: 'bg-gradient-to-r from-blue-600 to-blue-400 text-white border-blue-400' };
            case 'enterprise':
                return { text: 'ULTRA', color: 'bg-gradient-to-r from-purple-600 to-red-500 text-white border-purple-400' };
            default:
                return null;
        }
    };

    const badge = getBadgeConfig(tier || null);

    return (
        <div className={`flex items-center gap-3 select-none ${className}`}>
            {/* Logo Image - Refined: No box, just the shield */}
            <div className="relative group w-10 h-10 transition-transform group-hover:scale-110 duration-300">
                <img
                    src={logoImg}
                    alt="AetherGuard Logo"
                    className="w-full h-full object-contain filter drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                />

                {/* Glow Effect based on tier */}
                {tier === 'professional' && <div className="absolute inset-0 bg-blue-500/40 blur-xl rounded-full -z-10 animate-pulse"></div>}
                {tier === 'enterprise' && <div className="absolute inset-0 bg-purple-500/40 blur-xl rounded-full -z-10 animate-pulse"></div>}
            </div>

            {/* Text & Badge */}
            {(showText || badge) && (
                <div className="flex flex-col justify-center">
                    <div className="flex items-center gap-2">
                        {showText && (
                            <span className="font-bold text-xl tracking-tight text-white group-hover:text-green-50 transition-colors">
                                AetherGuard
                            </span>
                        )}

                        {/* Dynamic Badge */}
                        {badge && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.8, x: -10 }}
                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                key={tier} // Re-animate on toggle
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shadow-lg ${badge.color} backdrop-blur-md`}
                            >
                                {badge.text}
                            </motion.div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Logo;
/**
 * AetherGuard ESP32 - AI 妯″瀷璋冪敤妯″潡
 * 
 * 鏀寔澶氭ā鍨嬫潵婧愶細
 * 1. 鐢ㄦ埛绗旇鏈湰鍦版ā鍨?(榛樿)
 * 2. 鐢ㄦ埛鏈嶅姟鍣ㄩ儴缃茬殑妯″瀷 (鍙厤缃?
 * 3. 鏈嶅姟鍣ㄩ泦缇ゆā鍨?(鍙厤缃?
 * 
 * 浼樺厛绾? 鑷畾涔夌鐐?> 绗旇鏈湰鍦?
 */

#ifndef AI_MODEL_H
#define AI_MODEL_H

#include <Arduino.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include "config.h"

// 妯″瀷绔偣缁撴瀯
struct ModelEndpoint {
    char url[128];          // API 绔偣 URL
    char modelName[32];     // 妯″瀷鍚嶇О
    char apiKey[64];        // API 瀵嗛挜
    bool enabled;           // 鏄惁鍚敤
    uint16_t timeout;       // 瓒呮椂鏃堕棿 (ms)
};

// 妯″瀷鍝嶅簲缁撴瀯
struct ModelResponse {
    bool success;
    char result[256];       // 鍒嗘瀽缁撴灉
    uint8_t threatLevel;    // 濞佽儊绛夌骇 0-10
    char action[32];        // 寤鸿鎿嶄綔
};

// 鏈€澶氭敮鎸?3 涓嚜瀹氫箟绔偣
#define MAX_CUSTOM_ENDPOINTS 3

class AIModel {
private:
    // 榛樿绔偣 (绗旇鏈?
    ModelEndpoint defaultEndpoint;
    
    // 鑷畾涔夌鐐瑰垪琛?
    ModelEndpoint customEndpoints[MAX_CUSTOM_ENDPOINTS];
    uint8_t customCount;
    
    // HTTP 瀹㈡埛绔?
    HTTPClient http;
    WiFiClient client;
    
    // 闈欐€佺紦鍐插尯
    char requestBuffer[512];
    char responseBuffer[512];
    
    /**
     * 璋冪敤鍗曚釜绔偣
     */
    bool callEndpoint(const ModelEndpoint& endpoint, const char* data, ModelResponse& response) {
        if (!endpoint.enabled || endpoint.url[0] == '\0') {
            return false;
        }
        
        DEBUG_PRINTF("[AI] Calling: %s\n", endpoint.url);
        
        // 鏋勫缓璇锋眰
        http.begin(client, endpoint.url);
        http.setTimeout(endpoint.timeout);
        http.addHeader("Content-Type", "application/json");
        
        if (endpoint.apiKey[0] != '\0') {
            http.addHeader("Authorization", String("Bearer ") + endpoint.apiKey);
        }
        
        // 鏋勫缓璇锋眰浣?
        int reqLen = snprintf(requestBuffer, sizeof(requestBuffer),
            "{\"model\":\"%s\",\"prompt\":\"%s\",\"stream\":false}",
            endpoint.modelName[0] ? endpoint.modelName : "default",
            data
        );
        
        // 鍙戦€佽姹?
        int httpCode = http.POST(requestBuffer);
        
        if (httpCode == HTTP_CODE_OK) {
            String payload = http.getString();
            
            // 绠€鍗曡В鏋愬搷搴?(閬垮厤瀹屾暣 JSON 瑙ｆ瀽)
            // 鏈熸湜鏍煎紡: {"result":"...","threat":5,"action":"block"}
            
            const char* resultPtr = strstr(payload.c_str(), "\"result\":\"");
            if (resultPtr) {
                resultPtr += 10;
                const char* endPtr = strchr(resultPtr, '"');
                if (endPtr) {
                    size_t len = min((size_t)(endPtr - resultPtr), sizeof(response.result) - 1);
                    strncpy(response.result, resultPtr, len);
                    response.result[len] = '\0';
                }
            }
            
            const char* threatPtr = strstr(payload.c_str(), "\"threat\":");
            if (threatPtr) {
                response.threatLevel = atoi(threatPtr + 9);
            }
            
            const char* actionPtr = strstr(payload.c_str(), "\"action\":\"");
            if (actionPtr) {
                actionPtr += 10;
                const char* endPtr = strchr(actionPtr, '"');
                if (endPtr) {
                    size_t len = min((size_t)(endPtr - actionPtr), sizeof(response.action) - 1);
                    strncpy(response.action, actionPtr, len);
                    response.action[len] = '\0';
                }
            }
            
            response.success = true;
            http.end();
            return true;
        }
        
        DEBUG_PRINTF("[AI] HTTP error: %d\n", httpCode);
        http.end();
        return false;
    }

public:
    void init() {
        // 鍒濆鍖栭粯璁ょ鐐?(绗旇鏈?
        strcpy(defaultEndpoint.url, "http://");
        strcat(defaultEndpoint.url, LOCAL_HOST);
        strcat(defaultEndpoint.url, ":5000/api/analyze");
        strcpy(defaultEndpoint.modelName, "llama3");
        defaultEndpoint.apiKey[0] = '\0';
        defaultEndpoint.enabled = true;
        defaultEndpoint.timeout = 10000;
        
        customCount = 0;
        
        DEBUG_PRINTLN("[AI] Init OK");
    }
    
    /**
     * 閰嶇疆鑷畾涔夌鐐?
     */
    bool addCustomEndpoint(const char* url, const char* model, const char* apiKey) {
        if (customCount >= MAX_CUSTOM_ENDPOINTS) {
            return false;
        }
        
        ModelEndpoint& ep = customEndpoints[customCount];
        strncpy(ep.url, url, sizeof(ep.url) - 1);
        strncpy(ep.modelName, model, sizeof(ep.modelName) - 1);
        strncpy(ep.apiKey, apiKey, sizeof(ep.apiKey) - 1);
        ep.enabled = true;
        ep.timeout = 15000;
        
        customCount++;
        
        DEBUG_PRINTF("[AI] Added endpoint: %s\n", url);
        return true;
    }
    
    /**
     * 浠?JSON 閰嶇疆瑙ｆ瀽绔偣
     * 鏍煎紡: {"endpoints":[{"url":"...","model":"...","key":"..."}]}
     */
    void loadFromJson(const char* json) {
        customCount = 0;
        
        const char* ptr = json;
        while ((ptr = strstr(ptr, "\"url\":\"")) != nullptr && customCount < MAX_CUSTOM_ENDPOINTS) {
            ptr += 7;
            
            // 瑙ｆ瀽 URL
            char url[128] = {0};
            const char* end = strchr(ptr, '"');
            if (end) {
                size_t len = min((size_t)(end - ptr), sizeof(url) - 1);
                strncpy(url, ptr, len);
            }
            
            // 瑙ｆ瀽 model
            char model[32] = {0};
            const char* modelPtr = strstr(end, "\"model\":\"");
            if (modelPtr) {
                modelPtr += 9;
                const char* modelEnd = strchr(modelPtr, '"');
                if (modelEnd) {
                    size_t len = min((size_t)(modelEnd - modelPtr), sizeof(model) - 1);
                    strncpy(model, modelPtr, len);
                }
            }
            
            // 瑙ｆ瀽 key
            char key[64] = {0};
            const char* keyPtr = strstr(end, "\"key\":\"");
            if (keyPtr) {
                keyPtr += 7;
                const char* keyEnd = strchr(keyPtr, '"');
                if (keyEnd) {
                    size_t len = min((size_t)(keyEnd - keyPtr), sizeof(key) - 1);
                    strncpy(key, keyPtr, len);
                }
            }
            
            if (url[0] != '\0') {
                addCustomEndpoint(url, model, key);
            }
            
            ptr = end + 1;
        }
    }
    
    /**
     * 娓呴櫎鎵€鏈夎嚜瀹氫箟绔偣
     */
    void clearCustomEndpoints() {
        customCount = 0;
    }
    
    /**
     * 鍒嗘瀽鏁版嵁 (鑷姩閫夋嫨鏈€浣崇鐐?
     * 浼樺厛绾? 鑷畾涔夌鐐?> 榛樿绔偣
     */
    bool analyze(const char* data, ModelResponse& response) {
        memset(&response, 0, sizeof(response));
        
        // 1. 灏濊瘯鑷畾涔夌鐐?(鎸夐『搴?
        for (uint8_t i = 0; i < customCount; i++) {
            if (callEndpoint(customEndpoints[i], data, response)) {
                DEBUG_PRINTF("[AI] Success via custom #%d\n", i);
                return true;
            }
        }
        
        // 2. 鍥為€€鍒伴粯璁ょ鐐?(绗旇鏈?
        if (callEndpoint(defaultEndpoint, data, response)) {
            DEBUG_PRINTLN("[AI] Success via default");
            return true;
        }
        
        DEBUG_PRINTLN("[AI] All endpoints failed");
        strcpy(response.result, "Model unavailable");
        response.threatLevel = 0;
        strcpy(response.action, "none");
        return false;
    }
    
    /**
     * 璁剧疆榛樿绔偣
     */
    void setDefaultEndpoint(const char* url, const char* model = nullptr) {
        strncpy(defaultEndpoint.url, url, sizeof(defaultEndpoint.url) - 1);
        if (model) {
            strncpy(defaultEndpoint.modelName, model, sizeof(defaultEndpoint.modelName) - 1);
        }
    }
    
    /**
     * 娴嬭瘯绔偣杩為€氭€?
     */
    bool testEndpoint(uint8_t index) {
        ModelResponse resp;
        
        if (index == 255) {
            // 娴嬭瘯榛樿绔偣
            return callEndpoint(defaultEndpoint, "test", resp);
        } else if (index < customCount) {
            return callEndpoint(customEndpoints[index], "test", resp);
        }
        
        return false;
    }
    
    uint8_t getCustomCount() const { return customCount; }
};

#endif // AI_MODEL_H
/**
 * AetherGuard ESP32 - 澶氭寜閿簨浠跺鐞嗗櫒
 * 
 * 鏀寔澶氫釜鐙珛鎸夐敭鐨勫幓鎶栧拰鍗曞嚮妫€娴?
 */

#ifndef BUTTON_HANDLER_H
#define BUTTON_HANDLER_H

#include <Arduino.h>

class SimpleButton {
private:
    uint8_t pin;
    bool lastState;
    uint32_t lastDebounceTime;
    const uint32_t DEBOUNCE_DELAY = 50;

public:
    void init(uint8_t p) {
        pin = p;
        pinMode(pin, INPUT_PULLUP);
        lastState = HIGH;
        lastDebounceTime = 0;
    }

    bool isPressed() {
        bool reading = digitalRead(pin);
        bool pressed = false;

        if (reading != lastState) {
            lastDebounceTime = millis();
        }

        if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
            // 濡傛灉鐘舵€佺ǔ瀹氫负 LOW (鎸変笅)
            if (reading == LOW) {
                pressed = true; // 绠€鍗曠殑鎸変綇妫€娴嬶紝瀹為檯鍙兘闇€瑕佷笂鍗囨部瑙﹀彂
            }
        }
        
        lastState = reading;
        return pressed;
    }
    
    // 妫€娴嬪崟鍑?(閲婃斁鐬棿瑙﹀彂)
    bool isClicked() {
        static bool waitingRelease = false;
        bool reading = digitalRead(pin);
        
        if (reading == LOW && !waitingRelease) {
            waitingRelease = true;
            delay(20); // 绠€鍗曟秷鎶?
        }
        else if (reading == HIGH && waitingRelease) {
            waitingRelease = false;
            return true;
        }
        return false;
    }
};

class MultiButtonHandler {
public:
    SimpleButton btnOK;
    SimpleButton btnNext;
    SimpleButton btnBack;

    void init() {
        btnOK.init(PIN_BTN_OK);
        btnNext.init(PIN_BTN_NEXT);
        btnBack.init(PIN_BTN_BACK);
    }

    // 鍙互鍦ㄤ富寰幆涓皟鐢ㄦ娴?
    bool isOkClicked() { return btnOK.isClicked(); }
    bool isNextClicked() { return btnNext.isClicked(); }
    bool isBackClicked() { return btnBack.isClicked(); }
};

#endif // BUTTON_HANDLER_H
/**
 * AetherGuard ESP32 - 浼樺寲鐗堝瘑鐮佹湰妯″潡
 * 
 * 浼樺寲绛栫暐锛?
 * - 浣跨敤鍥哄畾澶у皬鏁扮粍鏇夸唬 std::map (鑺傜渷 ~8KB RAM)
 * - 浜屽垎鏌ユ壘鏇夸唬鍝堝笇琛?(鑺傜渷鍐呭瓨锛屽彲鎺ュ彈鎬ц兘)
 * - 瀛樺偍鍦?PROGMEM (Flash) 鍑忓皯 RAM 鍗犵敤
 */

#ifndef CODEBOOK_H
#define CODEBOOK_H

#include <Arduino.h>
#include "config.h"

// 棰勫畾涔夐敊璇爜缁撴瀯 (瀛樺偍鍦?Flash)
struct CodeEntry {
    char code[6];       // 濡?"E001"
    char message[48];   // 绠€鐭秷鎭?
};

// 榛樿瀵嗙爜鏈?(瀛樺偍鍦?Flash, 涓嶅崰鐢?RAM)
static const CodeEntry PROGMEM DEFAULT_CODEBOOK[] = {
    // 绯荤粺閿欒 (E0xx)
    {"E001", "Connection refused"},
    {"E002", "Permission denied"},
    {"E003", "Out of memory"},
    {"E004", "Disk full"},
    {"E005", "Service unavailable"},
    {"E006", "Auth failed"},
    {"E007", "Timeout"},
    {"E008", "Network unreachable"},
    
    // 鐘舵€佺爜 (S0xx)
    {"S001", "CPU critical"},
    {"S002", "Memory critical"},
    {"S003", "Disk critical"},
    {"S004", "High load"},
    
    // 瀹夊叏鍛婅 (A0xx)
    {"A001", "SQLi detected"},
    {"A002", "XSS blocked"},
    {"A003", "Path traversal"},
    {"A004", "Cmd injection"},
    {"A005", "Brute force"},
    {"A006", "DDoS pattern"},
    {"A007", "Malicious bot"},
    {"A008", "Suspicious proc"},
};

#define DEFAULT_CODEBOOK_SIZE (sizeof(DEFAULT_CODEBOOK) / sizeof(CodeEntry))

class Codebook {
private:
    // 鍔ㄦ€佹潯鐩?(杩滅▼鍚屾鐨?
    CodeEntry dynamicEntries[16];   // 鏈€澶?16 涓姩鎬佹潯鐩?
    uint8_t dynamicCount;
    
    // 浜屽垎鏌ユ壘榛樿瀵嗙爜鏈?
    int16_t findInDefault(const char* code) {
        int16_t left = 0;
        int16_t right = DEFAULT_CODEBOOK_SIZE - 1;
        
        while (left <= right) {
            int16_t mid = (left + right) >> 1;
            
            // 浠?PROGMEM 璇诲彇
            char entryCode[6];
            memcpy_P(entryCode, DEFAULT_CODEBOOK[mid].code, 6);
            
            int cmp = strcmp(code, entryCode);
            if (cmp == 0) return mid;
            if (cmp < 0) right = mid - 1;
            else left = mid + 1;
        }
        return -1;
    }
    
    // 绾挎€ф煡鎵惧姩鎬佹潯鐩?
    int16_t findInDynamic(const char* code) {
        for (uint8_t i = 0; i < dynamicCount; i++) {
            if (strcmp(code, dynamicEntries[i].code) == 0) {
                return i;
            }
        }
        return -1;
    }

public:
    void init() {
        dynamicCount = 0;
        DEBUG_PRINTF("[Codebook] %d default entries\n", DEFAULT_CODEBOOK_SIZE);
    }
    
    /**
     * 鏌ユ壘娑堟伅 -> 缂栫爜 (鐢ㄤ簬鍘嬬缉)
     * 杩斿洖: 缂栫爜瀛楃涓诧紝鎴?NULL 濡傛灉鏈壘鍒?
     */
    const char* encode(const char* message, char* outCode) {
        // 鍏堟煡榛樿琛?
        for (uint16_t i = 0; i < DEFAULT_CODEBOOK_SIZE; i++) {
            char msg[48];
            memcpy_P(msg, DEFAULT_CODEBOOK[i].message, 48);
            
            if (strcmp(message, msg) == 0) {
                memcpy_P(outCode, DEFAULT_CODEBOOK[i].code, 6);
                return outCode;
            }
        }
        
        // 鍐嶆煡鍔ㄦ€佽〃
        for (uint8_t i = 0; i < dynamicCount; i++) {
            if (strcmp(message, dynamicEntries[i].message) == 0) {
                strcpy(outCode, dynamicEntries[i].code);
                return outCode;
            }
        }
        
        return NULL;  // 鏈壘鍒?
    }
    
    /**
     * 鏌ユ壘缂栫爜 -> 娑堟伅 (鐢ㄤ簬瑙ｅ帇)
     */
    bool decode(const char* code, char* outMessage, size_t maxLen) {
        // 鍏堟煡榛樿琛?
        int16_t idx = findInDefault(code);
        if (idx >= 0) {
            memcpy_P(outMessage, DEFAULT_CODEBOOK[idx].message, min(maxLen, (size_t)48));
            return true;
        }
        
        // 鍐嶆煡鍔ㄦ€佽〃
        idx = findInDynamic(code);
        if (idx >= 0) {
            strncpy(outMessage, dynamicEntries[idx].message, maxLen);
            return true;
        }
        
        return false;
    }
    
    /**
     * 娣诲姞鍔ㄦ€佹潯鐩?(浠庢湇鍔″櫒鍚屾)
     */
    bool addEntry(const char* code, const char* message) {
        if (dynamicCount >= 16) {
            // 婊′簡锛岃鐩栨渶鏃х殑
            memmove(&dynamicEntries[0], &dynamicEntries[1], 
                    sizeof(CodeEntry) * 15);
            dynamicCount = 15;
        }
        
        strncpy(dynamicEntries[dynamicCount].code, code, 5);
        dynamicEntries[dynamicCount].code[5] = '\0';
        strncpy(dynamicEntries[dynamicCount].message, message, 47);
        dynamicEntries[dynamicCount].message[47] = '\0';
        dynamicCount++;
        
        return true;
    }
    
    /**
     * 鍘嬬缉 JSON 涓殑閿欒娑堟伅
     * 杈撳叆: {"errors":["SQL Injection detected","XSS blocked"]}
     * 杈撳嚭: {"c":["A001","A002"]}
     */
    size_t compressErrors(const char* input, char* output, size_t maxLen) {
        // 绠€鍖栧疄鐜帮細鍙鐞嗙壒瀹氭牸寮?
        // 瀹為檯搴旂敤涓彲鏍规嵁闇€瑕佹墿灞?
        
        char* outPtr = output;
        const char* inPtr = input;
        size_t remaining = maxLen - 1;
        
        // 澶嶅埗杈撳叆鍒拌緭鍑?(鍩虹瀹炵幇)
        // TODO: 瀹炵幇瀹屾暣鐨?JSON 瑙ｆ瀽鍜屽帇缂?
        strncpy(output, input, maxLen);
        output[maxLen - 1] = '\0';
        
        return strlen(output);
    }
    
    uint8_t getCount() {
        return DEFAULT_CODEBOOK_SIZE + dynamicCount;
    }
};

#endif // CODEBOOK_H
/**
 * AetherGuard ESP32 - 浼樺寲鐗堢郴缁熶俊鎭噰闆嗘ā鍧?
 * 
 * 浼樺寲绛栫暐锛?
 * - 浣跨敤 __packed 缁撴瀯浣撳噺灏戝唴瀛樺榻愬紑閿€
 * - 閬垮厤 String 绫讳娇鐢?(闃叉鍫嗙鐗?
 * - 浣跨敤闈欐€佺紦鍐插尯
 * - 澧為噺寮忔暟鎹噰闆?(閬垮厤涓€娆℃€уぇ鍐呭瓨鍒嗛厤)
 */

#ifndef COLLECTOR_H
#define COLLECTOR_H

#include <Arduino.h>
#include "config.h"

// 绱у噾鐨勭郴缁熶俊鎭粨鏋?(浣跨敤 __packed 鍑忓皯鍐呭瓨)
struct __attribute__((packed)) SystemInfoCompact {
    // 鍩烘湰淇℃伅 (浣跨敤鏋氫妇浠ｆ浛瀛楃涓?
    uint8_t osType;         // 0=unknown, 1=linux, 2=windows, 3=freertos
    uint8_t archType;       // 0=unknown, 1=x86, 2=x64, 3=arm, 4=xtensa
    
    // 璧勬簮浣跨敤 (鐧惧垎姣旓紝0-100)
    uint8_t cpuUsage;
    uint8_t memUsage;
    uint8_t diskUsage;
    
    // 鏍稿績鏁版嵁 (16浣嶈冻澶?
    uint16_t processCount;
    uint16_t connectionCount;
    uint16_t listeningPorts;
    
    // 缃戠粶娴侀噺 (鍘嬬缉: 浠?KB 涓哄崟浣?
    uint16_t bytesInKB;
    uint16_t bytesOutKB;
    
    // 鏃堕棿鎴?(鐩稿浜庡惎鍔ㄦ椂闂?
    uint32_t relativeTime;
};

// OS 绫诲瀷鏋氫妇
enum OSType : uint8_t {
    OS_UNKNOWN = 0,
    OS_LINUX = 1,
    OS_WINDOWS = 2,
    OS_FREERTOS = 3,
    OS_MACOS = 4
};

// 鏋舵瀯绫诲瀷鏋氫妇
enum ArchType : uint8_t {
    ARCH_UNKNOWN = 0,
    ARCH_X86 = 1,
    ARCH_X64 = 2,
    ARCH_ARM32 = 3,
    ARCH_ARM64 = 4,
    ARCH_XTENSA = 5,
    ARCH_RISCV = 6
};

class Collector {
private:
    HardwareSerial* targetSerial;
    SystemInfoCompact lastInfo;
    
    // 闈欐€佹帴鏀剁紦鍐插尯
    char rxBuffer[RX_BUFFER_SIZE];
    
    /**
     * 鍙戦€佸懡浠ゅ苟鎺ユ敹鍝嶅簲 (浼樺寲鐗?
     */
    uint16_t sendCommand(const char* cmd, char* response, uint16_t maxLen) {
        if (!targetSerial) return 0;
        
        // 娓呯┖鎺ユ敹缂撳啿鍖?
        while (targetSerial->available()) {
            targetSerial->read();
        }
        
        // 鍙戦€佸懡浠?
        targetSerial->println(cmd);
        
        // 绛夊緟鍝嶅簲 (甯﹁秴鏃?
        uint16_t received = 0;
        uint32_t startTime = millis();
        const uint32_t timeout = 1000;  // 1绉掕秴鏃?(鍑忓皯绛夊緟)
        
        while (millis() - startTime < timeout && received < maxLen - 1) {
            if (targetSerial->available()) {
                response[received++] = targetSerial->read();
                startTime = millis();  // 閲嶇疆瓒呮椂
            } else {
                delayMicroseconds(100);  // 寰绾т紤鐪?
            }
        }
        
        response[received] = '\0';
        return received;
    }
    
    /**
     * 瑙ｆ瀽绱у噾鏍煎紡鍝嶅簲
     * 鏍煎紡: "L,x64,45,62,38,156,24,3,102,85"
     *       OS,ARCH,CPU%,MEM%,DISK%,PROC,CONN,PORT,IN_KB,OUT_KB
     */
    bool parseCompactResponse(const char* data) {
        if (!data || data[0] == '\0') return false;
        
        // 浣跨敤 sscanf 蹇€熻В鏋?(姣?JSON 瑙ｆ瀽鍣ㄥ揩 10x)
        char osChar, archStr[8];
        int cpu, mem, disk, proc, conn, port, inKB, outKB;
        
        int parsed = sscanf(data, "%c,%7[^,],%d,%d,%d,%d,%d,%d,%d,%d",
            &osChar, archStr, &cpu, &mem, &disk, 
            &proc, &conn, &port, &inKB, &outKB);
        
        if (parsed < 10) return false;
        
        // 鏄犲皠 OS 绫诲瀷
        switch (osChar) {
            case 'L': lastInfo.osType = OS_LINUX; break;
            case 'W': lastInfo.osType = OS_WINDOWS; break;
            case 'F': lastInfo.osType = OS_FREERTOS; break;
            case 'M': lastInfo.osType = OS_MACOS; break;
            default:  lastInfo.osType = OS_UNKNOWN; break;
        }
        
        // 鏄犲皠鏋舵瀯
        if (strcmp(archStr, "x64") == 0) lastInfo.archType = ARCH_X64;
        else if (strcmp(archStr, "x86") == 0) lastInfo.archType = ARCH_X86;
        else if (strcmp(archStr, "arm") == 0) lastInfo.archType = ARCH_ARM32;
        else if (strcmp(archStr, "arm64") == 0) lastInfo.archType = ARCH_ARM64;
        else if (strcmp(archStr, "xtensa") == 0) lastInfo.archType = ARCH_XTENSA;
        else lastInfo.archType = ARCH_UNKNOWN;
        
        // 瀛樺偍鏁板€?(宸茬粡鏄帇缂╂牸寮?
        lastInfo.cpuUsage = (uint8_t)constrain(cpu, 0, 100);
        lastInfo.memUsage = (uint8_t)constrain(mem, 0, 100);
        lastInfo.diskUsage = (uint8_t)constrain(disk, 0, 100);
        lastInfo.processCount = (uint16_t)proc;
        lastInfo.connectionCount = (uint16_t)conn;
        lastInfo.listeningPorts = (uint16_t)port;
        lastInfo.bytesInKB = (uint16_t)inKB;
        lastInfo.bytesOutKB = (uint16_t)outKB;
        lastInfo.relativeTime = millis() / 1000;
        
        return true;
    }

public:
    void init() {
        Serial2.begin(115200, SERIAL_8N1, SERIAL_RX_PIN, SERIAL_TX_PIN);
        targetSerial = &Serial2;
        memset(&lastInfo, 0, sizeof(lastInfo));
        DEBUG_PRINTLN("[Collector] Init OK");
    }
    
    /**
     * 閲囬泦绯荤粺淇℃伅 (杩斿洖浜岃繘鍒舵牸寮?
     */
    const SystemInfoCompact* collect() {
        uint16_t len = sendCommand("C", rxBuffer, RX_BUFFER_SIZE);
        
        if (len > 0) {
            parseCompactResponse(rxBuffer);
        }
        
        return &lastInfo;
    }
    
    /**
     * 搴忓垪鍖栦负绱у噾 JSON (鏈€灏忓寲澶у皬)
     * 杈撳嚭: {"d":"ESP32-001","t":12345,"s":{"c":45,"m":62,"p":156}}
     */
    uint16_t toCompactJson(char* output, uint16_t maxLen) {
        return snprintf(output, maxLen,
            "{\"d\":\"%s\",\"t\":%lu,\"o\":%d,\"a\":%d,"
            "\"s\":{\"c\":%d,\"m\":%d,\"k\":%d,\"p\":%d,\"n\":%d,\"l\":%d}}",
            DEVICE_ID,
            lastInfo.relativeTime,
            lastInfo.osType,
            lastInfo.archType,
            lastInfo.cpuUsage,
            lastInfo.memUsage,
            lastInfo.diskUsage,
            lastInfo.processCount,
            lastInfo.connectionCount,
            lastInfo.listeningPorts
        );
    }
    
    /**
     * 搴忓垪鍖栦负浜岃繘鍒舵牸寮?(鏈€绱у噾)
     * 鐩存帴鍙戦€佺粨鏋勪綋瀛楄妭
     */
    uint16_t toBinary(uint8_t* output) {
        memcpy(output, &lastInfo, sizeof(SystemInfoCompact));
        return sizeof(SystemInfoCompact);
    }
    
    // 璁块棶鍣?
    uint8_t getCpuUsage() const { return lastInfo.cpuUsage; }
    uint8_t getMemUsage() const { return lastInfo.memUsage; }
    uint16_t getProcessCount() const { return lastInfo.processCount; }
};

#endif // COLLECTOR_H
/**
 * AetherGuard ESP32 - 鑷姩鍖栭儴缃插伐鍏烽厤缃?
 * 
 * 纭欢娓呭崟:
 * - ESP32-WROOM-32 (Type-C)
 * - OLED 0.96" (I2C)
 * - RGB LED (鍏遍槾)
 * - 鏈夋簮铚傞福鍣?
 * - 3涓交瑙︽寜閿?
 * - USB-TTL (杩炴帴鐩爣鏈嶅姟鍣?
 */

#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// ============================================
// 1. I2C OLED 鏄剧ず灞?(SSD1306)
// ============================================
#define ENABLE_SCREEN       1
#define SCREEN_WIDTH        128
#define SCREEN_HEIGHT       64
#define SCREEN_ADDRESS      0x3C
#define PIN_I2C_SDA         21
#define PIN_I2C_SCL         22

// ============================================
// 2. 鐗╃悊鎸夐敭
// ============================================
#define PIN_BTN_OK          15      // [纭/寮€濮媇
#define PIN_BTN_NEXT        4       // [鍒囨崲/璺宠繃]
#define PIN_BTN_BACK        5       // [鍙栨秷/杩斿洖]

// ============================================
// 3. RGB LED 鎸囩ず鐏?
// ============================================
#define PIN_RGB_RED         25
#define PIN_RGB_GREEN       26
#define PIN_RGB_BLUE        27
#define RGB_COMMON_ANODE    0       // 1=鍏遍槼, 0=鍏遍槾 (鏍规嵁瀹為檯纭欢璋冩暣)

// ============================================
// 4. 铚傞福鍣?
// ============================================
#define PIN_BUZZER          14
#define BUZZER_ACTIVE       1       // 1=鏈夋簮, 0=鏃犳簮

// ============================================
// 5. 鐩爣鏈嶅姟鍣ㄩ€氫俊 (USB-TTL)
// ============================================
#define TARGET_SERIAL       Serial2
#define TARGET_RX_PIN       16      // 杩炴帴 CP2102 TX
#define TARGET_TX_PIN       17      // 杩炴帴 CP2102 RX
#define TARGET_BAUD         115200

// ============================================
// 閮ㄧ讲涓庡畨鍏ㄩ厤缃?
// ============================================
#define INSTALL_CMD_URL     "curl -sL http://192.168.4.2:8080/install.sh | bash"
#define CHECK_CMD           "AetherGuard-agent --version"

// 澶囦唤鍛戒护 (Linux)
// 鍒涘缓鏃堕棿鎴崇洰褰曞苟鏍规嵁闇€瑕佸浠藉叧閿厤缃紝杩欓噷浠ュ浠?/etc 涓虹ず渚?
#define BACKUP_CMD          "mkdir -p /tmp/fg_backup_$(date +%s) && tar -czf /tmp/fg_backup_$(date +%s)/etc_backup.tar.gz /etc/AetherGuard /etc/hosts 2>/dev/null || echo 'Backup Skipped'"

// 鏁忔劅鎿嶄綔鍏抽敭瀛?(鐢ㄤ簬瑙﹀彂浜哄伐纭)
// 绠€鍗曠殑瀛愪覆鍖归厤
#define CRITICAL_KEYWORDS   "rm ","remove","uninstall","delete","format"

// 缂撳啿鍖?
#define RX_BUFFER_SIZE      2048
#define JSON_BUFFER_SIZE    1024

// DEBUG
#define ENABLE_DEBUG        1
#if ENABLE_DEBUG
    #define DEBUG_PRINT(x)      Serial.print(x)
    #define DEBUG_PRINTLN(x)    Serial.println(x)
    #define DEBUG_PRINTF(...)   Serial.printf(__VA_ARGS__)
#else
    #define DEBUG_PRINT(x)      ((void)0)
    #define DEBUG_PRINTLN(x)    ((void)0)
    #define DEBUG_PRINTF(...)   ((void)0)
#endif

#endif // CONFIG_H
/**
 * AetherGuard ESP32 - 浼樺寲鐗堝姞瀵嗘ā鍧?
 * 
 * 浼樺寲绛栫暐锛?
 * - 鍙€夋墦寮€ AES-128 (姣?AES-256 蹇?40%)
 * - 浣跨敤 ESP32 纭欢鍔犻€熷櫒
 * - 閬垮厤鍔ㄦ€佸唴瀛樺垎閰?
 * - 绠€鍖栫殑 XOR 澶囬€夋柟妗?(鏋佷綆鍔熻€楀満鏅?
 */

#ifndef CRYPTO_H
#define CRYPTO_H

#include <Arduino.h>
#include "config.h"

#if ENABLE_ENCRYPTION
#include "mbedtls/aes.h"
#include "mbedtls/base64.h"
#endif

// 鍔犲瘑绫诲瀷閫夋嫨
enum CryptoType : uint8_t {
    CRYPTO_NONE = 0,
    CRYPTO_XOR = 1,     // 鏈€杞婚噺 (涓嶅畨鍏紝浠呮贩娣?
    CRYPTO_AES128 = 2,  // 鎺ㄨ崘 (骞宠　)
    CRYPTO_AES256 = 3   // 鏈€瀹夊叏 (鏈€鎱?
};

class Crypto {
private:
#if ENABLE_ENCRYPTION
    mbedtls_aes_context aesCtx;
    bool aesInitialized;
#endif
    
    uint8_t key[32];
    uint8_t iv[16];
    CryptoType currentType;
    
    // 闈欐€佸伐浣滅紦鍐插尯
    uint8_t workBuffer[JSON_BUFFER_SIZE];
    
    /**
     * 绠€鍗?XOR 鍔犲瘑 (CPU 寮€閿€鏈€灏?
     */
    void xorCrypt(uint8_t* data, uint16_t len) {
        for (uint16_t i = 0; i < len; i++) {
            data[i] ^= key[i % 16];
        }
    }

public:
    Crypto() {
#if ENABLE_ENCRYPTION
        aesInitialized = false;
#endif
        currentType = CRYPTO_NONE;
    }
    
    bool init(const char* aesKey, const char* aesIv, CryptoType type = CRYPTO_AES128) {
        currentType = type;
        
        // 澶嶅埗瀵嗛挜
        memset(key, 0, sizeof(key));
        memset(iv, 0, sizeof(iv));
        
        size_t keyLen = strlen(aesKey);
        size_t ivLen = strlen(aesIv);
        memcpy(key, aesKey, min(keyLen, sizeof(key)));
        memcpy(iv, aesIv, min(ivLen, sizeof(iv)));
        
#if ENABLE_ENCRYPTION
        if (type >= CRYPTO_AES128) {
            mbedtls_aes_init(&aesCtx);
            
            // AES-128 = 128浣嶅瘑閽? AES-256 = 256浣嶅瘑閽?
            int bits = (type == CRYPTO_AES256) ? 256 : 128;
            mbedtls_aes_setkey_enc(&aesCtx, key, bits);
            aesInitialized = true;
            
            DEBUG_PRINTF("[Crypto] AES-%d ready\n", bits);
        }
#endif
        
        return true;
    }
    
    /**
     * 鍔犲瘑鏁版嵁 (鍘熷湴鍔犲瘑锛岄伩鍏嶉澶栧唴瀛?
     * 杩斿洖鍔犲瘑鍚庨暱搴?(鍙兘鍥犲～鍏呭鍔?
     */
    uint16_t encrypt(uint8_t* data, uint16_t len) {
        if (len == 0 || len > JSON_BUFFER_SIZE - 16) return 0;
        
        switch (currentType) {
            case CRYPTO_XOR:
                xorCrypt(data, len);
                return len;
                
#if ENABLE_ENCRYPTION
            case CRYPTO_AES128:
            case CRYPTO_AES256: {
                if (!aesInitialized) return 0;
                
                // PKCS7 濉厖鍒?16 瀛楄妭瀵归綈
                uint16_t paddedLen = ((len / 16) + 1) * 16;
                uint8_t padValue = paddedLen - len;
                
                // 濉厖
                for (uint16_t i = len; i < paddedLen; i++) {
                    data[i] = padValue;
                }
                
                // 澶嶅埗 IV
                uint8_t ivCopy[16];
                memcpy(ivCopy, iv, 16);
                
                // CBC 鍔犲瘑 (浣跨敤宸ヤ綔缂撳啿鍖?
                mbedtls_aes_crypt_cbc(&aesCtx, MBEDTLS_AES_ENCRYPT,
                                     paddedLen, ivCopy, data, workBuffer);
                
                // 澶嶅埗鍥炲師缂撳啿鍖?
                memcpy(data, workBuffer, paddedLen);
                return paddedLen;
            }
#endif
            
            default:
                return len;  // 涓嶅姞瀵?
        }
    }
    
    /**
     * 瑙ｅ瘑鏁版嵁 (鍘熷湴瑙ｅ瘑)
     * 杩斿洖瑙ｅ瘑鍚庡疄闄呴暱搴?
     */
    uint16_t decrypt(uint8_t* data, uint16_t len) {
        if (len == 0) return 0;
        
        switch (currentType) {
            case CRYPTO_XOR:
                xorCrypt(data, len);  // XOR 瀵圭О
                return len;
                
#if ENABLE_ENCRYPTION
            case CRYPTO_AES128:
            case CRYPTO_AES256: {
                if (!aesInitialized || len % 16 != 0) return 0;
                
                // 鍒濆鍖栬В瀵嗕笂涓嬫枃
                mbedtls_aes_context decCtx;
                mbedtls_aes_init(&decCtx);
                int bits = (currentType == CRYPTO_AES256) ? 256 : 128;
                mbedtls_aes_setkey_dec(&decCtx, key, bits);
                
                // 澶嶅埗 IV
                uint8_t ivCopy[16];
                memcpy(ivCopy, iv, 16);
                
                // CBC 瑙ｅ瘑
                mbedtls_aes_crypt_cbc(&decCtx, MBEDTLS_AES_DECRYPT,
                                     len, ivCopy, data, workBuffer);
                mbedtls_aes_free(&decCtx);
                
                // 绉婚櫎 PKCS7 濉厖
                uint8_t padValue = workBuffer[len - 1];
                uint16_t actualLen = len;
                if (padValue > 0 && padValue <= 16) {
                    actualLen = len - padValue;
                }
                
                // 澶嶅埗鍥炲師缂撳啿鍖?
                memcpy(data, workBuffer, actualLen);
                data[actualLen] = '\0';
                return actualLen;
            }
#endif
            
            default:
                return len;
        }
    }
    
    /**
     * Base64 缂栫爜 (鐢ㄤ簬 WebSocket 鏂囨湰浼犺緭)
     */
    uint16_t encodeBase64(const uint8_t* input, uint16_t inputLen, 
                          char* output, uint16_t maxOutputLen) {
#if ENABLE_ENCRYPTION
        size_t outputLen = 0;
        mbedtls_base64_encode((unsigned char*)output, maxOutputLen,
                              &outputLen, input, inputLen);
        return (uint16_t)outputLen;
#else
        // 绠€鍖栫増 Base64 (浠呭綋绂佺敤鍔犲瘑鏃?
        static const char* table = 
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        
        uint16_t outIdx = 0;
        for (uint16_t i = 0; i < inputLen && outIdx < maxOutputLen - 4; i += 3) {
            uint32_t n = ((uint32_t)input[i]) << 16;
            if (i + 1 < inputLen) n |= ((uint32_t)input[i+1]) << 8;
            if (i + 2 < inputLen) n |= input[i+2];
            
            output[outIdx++] = table[(n >> 18) & 0x3F];
            output[outIdx++] = table[(n >> 12) & 0x3F];
            output[outIdx++] = (i + 1 < inputLen) ? table[(n >> 6) & 0x3F] : '=';
            output[outIdx++] = (i + 2 < inputLen) ? table[n & 0x3F] : '=';
        }
        output[outIdx] = '\0';
        return outIdx;
#endif
    }
    
    CryptoType getType() const { return currentType; }
    void setType(CryptoType t) { currentType = t; }
    
    ~Crypto() {
#if ENABLE_ENCRYPTION
        if (aesInitialized) {
            mbedtls_aes_free(&aesCtx);
        }
#endif
    }
};

#endif // CRYPTO_H
/**
 * AetherGuard ESP32 - 鑷姩鍖栭儴缃叉ā鍧?(Safety Enhanced)
 * 
 * 澧炲己鍔熻兘:
 * 1. 缁撴瀯鍖栨棩蹇楄褰?(Logging)
 * 2. 寮哄埗澶囦唤 (Mandatory Backup)
 * 3. 鏁忔劅鎸囦护鎷︽埅 (Safety Intercept)
 */

#ifndef DEPLOYMENT_H
#define DEPLOYMENT_H

#include <Arduino.h>
#include "config.h"

// 鎵ц缁撴灉鏋氫妇
enum CmdStatus {
    CMD_SUCCESS = 0,
    CMD_FAIL,
    CMD_REQUIRE_CONFIRM, // 闇€瑕佷汉宸ョ‘璁?
    CMD_BACKUP_FAIL
};

class DeploymentModule {
private:
    char rxBuffer[RX_BUFFER_SIZE];
    
    // 娓呯┖鎺ユ敹缂撳啿鍖?
    void clearSerial() {
        while (TARGET_SERIAL.available()) {
            TARGET_SERIAL.read();
        }
    }

    // 鍐呴儴閫氱敤鍛戒护鎵ц
    bool execInternal(const char* cmd, const char* expect, uint32_t timeoutMs) {
        clearSerial();
        TARGET_SERIAL.println(cmd);
        
        uint32_t start = millis();
        uint16_t idx = 0;
        bool found = false;
        
        while (millis() - start < timeoutMs) {
            if (TARGET_SERIAL.available()) {
                char c = TARGET_SERIAL.read();
                if (idx < RX_BUFFER_SIZE - 1) rxBuffer[idx++] = c;
                rxBuffer[idx] = 0; // null terminate
                
                if (strstr(rxBuffer, expect) != nullptr) {
                    found = true;
                    break;
                }
            }
        }
        return found;
    }

public:
    void init() {
        TARGET_SERIAL.begin(TARGET_BAUD, SERIAL_8N1, TARGET_RX_PIN, TARGET_TX_PIN);
        DEBUG_PRINTLN("[Deploy] Serial2 Init OK");
    }
    
    /**
     * 1. 璁板綍鏃ュ織 (妯℃嫙鍐欏叆 Flash 鎴栧彧鏄緭鍑哄埌 Console)
     */
    void logAction(const char* action, const char* details) {
        char logLine[128];
        snprintf(logLine, sizeof(logLine), "[LOG][%lu] %s: %s", millis(), action, details);
        DEBUG_PRINTLN(logLine);
        // 瀹為檯搴旂敤涓彲鑳介渶瑕佸啓鍏?SPIFFS
    }

    /**
     * 2. 瀹夊叏妫€鏌? 妫€鏌ュ懡浠ゆ槸鍚﹀寘鍚晱鎰熷叧閿瓧
     */
    bool isCritical(const char* cmd) {
        const char* keywords[] = {"rm ", "remove", "uninstall", "delete", "format", NULL};
        for (int i = 0; keywords[i] != NULL; i++) {
            if (strstr(cmd, keywords[i]) != nullptr) {
                return true;
            }
        }
        return false; // Safe
    }

    /**
     * 3. 鎵ц鏈嶅姟鍣ㄥ浠?
     */
    bool performBackup() {
        logAction("BACKUP", "Starting server-side backup...");
        
        // 鍙戦€佸浠藉懡浠?
        // 鍋囪鎴愬姛浼氭病鏈夐敊璇緭鍑猴紝鎴栬€呮垜浠彲浠?echo "BACKUP_DONE"
        char fullCmd[256];
        snprintf(fullCmd, sizeof(fullCmd), "%s && echo BACKUP_DONE", BACKUP_CMD);
        
        if (execInternal(fullCmd, "BACKUP_DONE", 10000)) {
            logAction("BACKUP", "Success");
            return true;
        } else {
            logAction("BACKUP", "Failed or Timeout");
            return false;
        }
    }

    /**
     * 4. 瀹夊叏鎵ц鍛戒护
     * 濡傛灉鏄晱鎰熷懡浠わ紝杩斿洖 REQUIRE_CONFIRM
     */
    CmdStatus executeSafe(const char* cmd, const char* expect, uint32_t timeout) {
        // A. 鏁忔劅妫€娴?
        if (isCritical(cmd)) {
            logAction("SAFETY", "Critical command intercepted");
            return CMD_REQUIRE_CONFIRM;
        }
        
        // B. 鐩存帴鎵ц
        logAction("EXEC", cmd);
        if (execInternal(cmd, expect, timeout)) {
            logAction("EXEC", "Success");
            return CMD_SUCCESS;
        } else {
            logAction("EXEC", "Failed");
            return CMD_FAIL;
        }
    }

    // 鍏煎鏃ф帴鍙?
    bool checkEnvironment(char* outInfo) {
        TARGET_SERIAL.println(); delay(100);
        if (execInternal("uname -s", "Linux", 1000)) {
            strcpy(outInfo, "Linux Detected");
            return true;
        } else if (execInternal("echo Windows", "Windows", 500)) {
             strcpy(outInfo, "Windows (CMD)");
             return true;
        }
        strcpy(outInfo, "Unknown OS");
        return false;
    }
    
    // 瀹夎娴佺▼ (鍖呭惈澶囦唤濡傛灉闇€瑕佺殑璇濓紝浣嗛€氬父澶囦唤鏄嫭绔嬬殑涓€姝?
    bool install(void (*progressCallback)(int)) {
        progressCallback(10);
        // 瀹夎鏈韩涓€鑸笉璁や负鏄牬鍧忔€х殑锛岄櫎闈炴槸閲嶈
        // 浣嗕负浜嗗畨鍏紝涔熷彲浠ュ厛澶囦唤
        
        // 瀹為檯瀹夎
        TARGET_SERIAL.println(INSTALL_CMD_URL);
        
        // ... (绠€鍖栫殑鐩戞帶閫昏緫) ...
        progressCallback(50);
        delay(2000); 
        progressCallback(100);
        
        return true; 
    }
};

#endif // DEPLOYMENT_H
/**
 * AetherGuard ESP32 - 鏄剧ず椹卞姩妯″潡
 * 
 * 閫傞厤 SSD1306 I2C OLED (128x64)
 * 浣跨敤绠€鏄撴帴鍙ｅ畾涔?
 * 
 * UI 鐘舵€?
 * - STATUS: 鏄剧ず IP, 妯″紡, 杩炴帴鏁?
 * - SCANNING: 杩涘害鏉? "Scanning..."
 * - RESULT: "Threat Detected!", 濞佽儊绛夌骇
 * - ACTION: "Block IP?", [OK] Confirm, [Next] Skip
 */

#ifndef DISPLAY_H
#define DISPLAY_H

#include <Arduino.h>
#include <Wire.h>
#include "config.h"

// 绠€鍗曠殑瀛椾綋瀹氫箟 (5x7) - 鐪佺暐鍏蜂綋瀛楁ā鏁版嵁锛屼娇鐢ㄦā鎷熸帴鍙?
// 瀹為檯鍥轰欢闇€閾炬帴 Adafruit_SSD1306 鎴?U8g2

class Display {
private:
    bool enabled;
    
    // I2C 鍛戒护杈呭姪
    void sendCmd(uint8_t c) {
        Wire.beginTransmission(SCREEN_ADDRESS);
        Wire.write(0x00);
        Wire.write(c);
        Wire.endTransmission();
    }
    
    void sendData(uint8_t d) {
        Wire.beginTransmission(SCREEN_ADDRESS);
        Wire.write(0x40);
        Wire.write(d);
        Wire.endTransmission();
    }

public:
    void init() {
        #if ENABLE_SCREEN
        Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
        
        // 绠€鏄?SSD1306 鍒濆鍖栧簭鍒?(浠呯ず鎰?
        sendCmd(0xAE); // Display OFF
        sendCmd(0xAF); // Display ON
        
        clear();
        drawText(0, 0, "AetherGuard Init...");
        enabled = true;
        DEBUG_PRINTLN("[Display] Init OK");
        #else
        enabled = false;
        #endif
    }
    
    void clear() {
        if (!enabled) return;
        // 娓呭睆閫昏緫
    }
    
    // 妯℃嫙缁樺埗鏂囨湰
    void drawText(int x, int y, const char* text, int size = 1) {
        if (!enabled) return;
        DEBUG_PRINTF("[Display] (%d,%d) %s\n", x, y, text);
        // 瀹為檯璋冪敤 U8g2.drawStr(x, y, text);
    }
    
    // UI 椤甸潰锛氬緟鏈?
    void showStatus(const char* ip, const char* mode) {
        clear();
        drawText(0, 0, "AetherGuard");
        drawText(0, 16, mode);
        drawText(0, 32, ip);
        drawText(0, 48, "Press OK to Scan");
    }
    
    // UI 椤甸潰锛氭壂鎻忎腑
    void showScanning(int progress) {
        clear();
        drawText(0, 0, "Scanning Target...");
        
        // 缁樺埗杩涘害鏉?
        char buf[16];
        sprintf(buf, "[%d%%]", progress);
        drawText(40, 32, buf);
    }
    
    // UI 椤甸潰锛氱粨鏋?
    void showResult(const char* result, int threatLevel) {
        clear();
        if (threatLevel > 5) {
            drawText(0, 0, "!! THREAT !!", 2);
        } else {
            drawText(0, 0, "Scan Safe");
        }
        
        drawText(0, 24, result);
        
        if (threatLevel > 0) {
            drawText(0, 50, "[OK] Fix  [Next] Skip");
        } else {
            drawText(0, 50, "[OK] Back");
        }
    }
    
    // UI 椤甸潰锛氱‘璁ゆ搷浣?
    void showConfirmAction(const char* action) {
        clear();
        drawText(0, 0, "Confirm Action?");
        drawText(0, 20, action);
        drawText(0, 48, "[OK] Yes   [Back] No");
    }
    
    // UI 椤甸潰锛氬畬鎴?
    void showSuccess(const char* msg) {
        clear();
        drawText(0, 20, "Success!");
        drawText(0, 40, msg);
        delay(1000); 
    }
};

#endif // DISPLAY_H
/**
 * AetherGuard ESP32 - 纭欢鎺у埗妯″潡
 * 
 * 璐熻矗鎺у埗:
 * - RGB LED (鐘舵€佹寚绀?
 * - 铚傞福鍣?(澹伴煶鍙嶉)
 */

#ifndef HARDWARE_CTRL_H
#define HARDWARE_CTRL_H

#include <Arduino.h>
#include "config.h"

// LED 棰滆壊瀹氫箟
enum LEDColor {
    COLOR_OFF = 0,
    COLOR_RED,      // 閿欒
    COLOR_GREEN,    // 鎴愬姛
    COLOR_BLUE,     // 姝ｅ父/鐩戞帶
    COLOR_YELLOW,   // 澶勭悊涓?绛夊緟
    COLOR_WHITE,    // 鍚姩/灏辩华
    COLOR_PURPLE    // 鐗规畩鐘舵€?
};

class HardwareCtrl {
private:
    void setPin(uint8_t pin, bool on) {
        // 鍏遍槼鏋侊細LOW浜紝HIGH鐏?
        // 鍏遍槾鏋侊細HIGH浜紝LOW鐏?
        #if RGB_COMMON_ANODE
            digitalWrite(pin, on ? LOW : HIGH);
        #else
            digitalWrite(pin, on ? HIGH : LOW);
        #endif
    }

public:
    void init() {
        // LED 鍒濆鍖?
        pinMode(PIN_RGB_RED, OUTPUT);
        pinMode(PIN_RGB_GREEN, OUTPUT);
        pinMode(PIN_RGB_BLUE, OUTPUT);
        setColor(COLOR_OFF);
        
        // 铚傞福鍣ㄥ垵濮嬪寲
        pinMode(PIN_BUZZER, OUTPUT);
        digitalWrite(PIN_BUZZER, LOW); // 榛樿鍏抽棴
        
        DEBUG_PRINTLN("[Hardware] Init OK");
    }
    
    // 璁剧疆 LED 棰滆壊
    void setColor(LEDColor color) {
        // 鍏堝叏鍏?
        setPin(PIN_RGB_RED, false);
        setPin(PIN_RGB_GREEN, false);
        setPin(PIN_RGB_BLUE, false);
        
        switch (color) {
            case COLOR_RED:   setPin(PIN_RGB_RED, true); break;
            case COLOR_GREEN: setPin(PIN_RGB_GREEN, true); break;
            case COLOR_BLUE:  setPin(PIN_RGB_BLUE, true); break;
            case COLOR_YELLOW: // 绾?缁?
                setPin(PIN_RGB_RED, true);
                setPin(PIN_RGB_GREEN, true);
                break;
            case COLOR_WHITE: // 鍏ㄩ儴
                setPin(PIN_RGB_RED, true);
                setPin(PIN_RGB_GREEN, true);
                setPin(PIN_RGB_BLUE, true);
                break;
            case COLOR_PURPLE: // 绾?钃?
                setPin(PIN_RGB_RED, true);
                setPin(PIN_RGB_BLUE, true);
                break;
            case COLOR_OFF:
            default:
                break;
        }
    }
    
    // 楦ｅ彨
    void beep(int durationMs, int count = 1) {
        for (int i = 0; i < count; i++) {
            #if BUZZER_ACTIVE
                digitalWrite(PIN_BUZZER, HIGH);
                delay(durationMs);
                digitalWrite(PIN_BUZZER, LOW);
            #else
                // 鏃犳簮铚傞福鍣ㄩ渶浜х敓 PWM
                tone(PIN_BUZZER, 2000, durationMs);
            #endif
            
            if (i < count - 1) delay(100);
        }
    }
    
    // 鎴愬姛鎻愮ず闊?
    void playSuccess() {
        beep(100);
        delay(50);
        beep(100);
    }
    
    // 閿欒鎻愮ず闊?
    void playError() {
        beep(500); 
    }
};

#endif // HARDWARE_CTRL_H
/**
 * AetherGuard ESP32 - 浼樺寲鐗堜紶杈撳眰妯″潡
 * 
 * 浼樺寲绛栫暐锛?
 * - 杩炴帴姹犲鐢?
 * - 鍑忓皯鍐呭瓨鍒嗛厤
 * - 鑷姩閲嶈繛甯﹂€€閬?
 * - 浣庡姛鑰楁ā寮忔敮鎸?
 */

#ifndef TRANSPORT_H
#define TRANSPORT_H

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiServer.h>
#include <WebSocketsClient.h>
#include "config.h"

// 杩炴帴鐘舵€佹灇涓?
enum ConnectionState : uint8_t {
    CONN_DISCONNECTED = 0,
    CONN_CONNECTING = 1,
    CONN_CONNECTED = 2,
    CONN_ERROR = 3
};

class Transport {
private:
    WebSocketsClient* wsClient;
    WiFiServer* localServer;
    WiFiClient localClient;
    
    ConnectionState cloudState;
    ConnectionState localState;
    
    // 閲嶈繛閫€閬?
    uint32_t lastReconnectAttempt;
    uint16_t reconnectInterval;
    static const uint16_t MAX_RECONNECT_INTERVAL = 30000;
    
    // 闈欐€佸彂閫佺紦鍐插尯
    char txBuffer[TX_BUFFER_SIZE];

public:
    void init(WebSocketsClient* ws) {
        wsClient = ws;
        localServer = nullptr;
        cloudState = CONN_DISCONNECTED;
        localState = CONN_DISCONNECTED;
        lastReconnectAttempt = 0;
        reconnectInterval = 1000;
    }
    
    // ============================================
    // 绂荤嚎妯″紡: WiFi AP
    // ============================================
    bool startLocalAP() {
        WiFi.mode(WIFI_AP);
        
        if (!WiFi.softAP(WIFI_SSID, WIFI_PASSWORD)) {
            DEBUG_PRINTLN("[Transport] AP fail");
            return false;
        }
        
        if (!localServer) {
            localServer = new WiFiServer(LOCAL_PORT);
        }
        localServer->begin();
        localState = CONN_CONNECTED;
        
        DEBUG_PRINTF("[Transport] AP: %s\n", WiFi.softAPIP().toString().c_str());
        return true;
    }
    
    void stopLocalAP() {
        if (localServer) {
            localServer->stop();
        }
        WiFi.softAPdisconnect(true);
        localState = CONN_DISCONNECTED;
    }
    
    void handleLocalClients() {
        if (!localServer || localState != CONN_CONNECTED) return;
        
        if (localServer->hasClient()) {
            if (!localClient || !localClient.connected()) {
                localClient = localServer->available();
                DEBUG_PRINTLN("[Transport] Client connected");
            }
        }
    }
    
    bool sendLocal(const char* data, uint16_t len) {
        if (!localClient.connected()) return false;
        
        localClient.write((const uint8_t*)data, len);
        localClient.write('\n');
        return true;
    }
    
    // ============================================
    // 鑱旂綉妯″紡: WebSocket
    // ============================================
    bool connectCloud() {
        if (cloudState == CONN_CONNECTING) return false;
        
        // 鏂紑 AP
        stopLocalAP();
        
        // 杩炴帴 WiFi
        WiFi.mode(WIFI_STA);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        
        cloudState = CONN_CONNECTING;
        uint32_t startTime = millis();
        
        while (WiFi.status() != WL_CONNECTED) {
            if (millis() - startTime > WIFI_CONNECT_TIMEOUT) {
                cloudState = CONN_ERROR;
                DEBUG_PRINTLN("[Transport] WiFi timeout");
                return false;
            }
            delay(100);
        }
        
        DEBUG_PRINTF("[Transport] WiFi OK: %s\n", WiFi.localIP().toString().c_str());
        
        // WebSocket
        #if SERVER_USE_SSL
            wsClient->beginSSL(SERVER_HOST, SERVER_PORT, SERVER_PATH);
        #else
            wsClient->begin(SERVER_HOST, SERVER_PORT, SERVER_PATH);
        #endif
        
        // 浼樺寲 WebSocket 鍙傛暟
        wsClient->setReconnectInterval(reconnectInterval);
        wsClient->enableHeartbeat(15000, 3000, 2);  // 蹇冭烦浼樺寲
        
        cloudState = CONN_CONNECTED;
        reconnectInterval = 1000;  // 閲嶇疆閫€閬?
        return true;
    }
    
    void disconnectCloud() {
        if (cloudState != CONN_DISCONNECTED) {
            wsClient->disconnect();
            WiFi.disconnect(true);
            cloudState = CONN_DISCONNECTED;
        }
    }
    
    /**
     * 鍙戦€佹暟鎹?(鑷姩閫夋嫨妯″紡)
     */
    bool send(const char* data, uint16_t len) {
        if (cloudState == CONN_CONNECTED) {
            return wsClient->sendTXT(data, len);
        } else if (localState == CONN_CONNECTED) {
            return sendLocal(data, len);
        }
        return false;
    }
    
    /**
     * 鍙戦€佷簩杩涘埗鏁版嵁 (鏇撮珮鏁?
     */
    bool sendBinary(const uint8_t* data, uint16_t len) {
        if (cloudState == CONN_CONNECTED) {
            return wsClient->sendBIN(data, len);
        } else if (localState == CONN_CONNECTED && localClient.connected()) {
            localClient.write(data, len);
            return true;
        }
        return false;
    }
    
    /**
     * 鍙戦€佸績璺?(鏈€灏忓寲鏁版嵁)
     */
    bool sendHeartbeat() {
        if (cloudState != CONN_CONNECTED) return false;
        
        // 鏈€灏忓績璺? {"h":1,"u":12345,"f":180000}
        int len = snprintf(txBuffer, TX_BUFFER_SIZE,
            "{\"h\":1,\"u\":%lu,\"f\":%lu}",
            millis() / 1000,
            ESP.getFreeHeap()
        );
        
        return wsClient->sendTXT(txBuffer, len);
    }
    
    /**
     * 鍙戦€佹敞鍐?(绮剧畝鐗?
     */
    bool sendRegistration() {
        if (cloudState != CONN_CONNECTED) return false;
        
        int len = snprintf(txBuffer, TX_BUFFER_SIZE,
            "{\"r\":1,\"d\":\"%s\",\"v\":\"%s\",\"k\":\"%s\"}",
            DEVICE_ID, DEVICE_VERSION, API_KEY
        );
        
        return wsClient->sendTXT(txBuffer, len);
    }
    
    /**
     * 鑷姩閲嶈繛 (甯︽寚鏁伴€€閬?
     */
    bool autoReconnect() {
        if (cloudState == CONN_CONNECTED) return true;
        if (cloudState == CONN_CONNECTING) return false;
        
        uint32_t now = millis();
        if (now - lastReconnectAttempt < reconnectInterval) {
            return false;
        }
        
        lastReconnectAttempt = now;
        bool success = connectCloud();
        
        if (!success) {
            // 鎸囨暟閫€閬?
            reconnectInterval = min((uint16_t)(reconnectInterval * 2), MAX_RECONNECT_INTERVAL);
        }
        
        return success;
    }
    
    // 鐘舵€佽闂?
    bool isCloudConnected() const { return cloudState == CONN_CONNECTED; }
    bool isLocalConnected() const { return localState == CONN_CONNECTED; }
    ConnectionState getCloudState() const { return cloudState; }
    void setCloudState(ConnectionState s) { cloudState = s; }
};

#endif // TRANSPORT_H
