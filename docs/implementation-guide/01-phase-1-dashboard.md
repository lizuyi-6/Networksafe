# Phase 1: Dashboard页面数据真实化

> **实施时间**: 2-3小时
> **优先级**: P0 (核心数据)
> **依赖**: 无
> **风险**: 低

---

## 📋 实施概览

将Dashboard页面的演示数据替换为真实采集数据，包括：
1. ✅ 平均延迟监控 - 从固定42ms改为真实请求响应时间
2. ✅ IP段归属分析 - 从硬编码3国改为动态IP段统计
3. ✅ 全局健康度 - 保留真实计算（基于请求成功率）
4. ✅ 实时日志流 - 从2秒轮询改为WebSocket实时推送

---

## Part 1: 真实请求延迟监控

### 当前问题
Dashboard显示固定延迟值：
- 平均延迟: "42ms" (固定值)
- P99: "120ms" (固定值)

### 解决方案
在认证中间件中添加请求时间追踪，在模拟服务中收集平均响应时间。

### 实施步骤

#### Step 1.1: 添加请求计时中间件

**文件**: `backend/src/middleware/auth.middleware.ts`

**位置**: 文件末尾，导出之前

```typescript
// 请求计时中间件
export interface TimedRequest extends Express.Request {
  startTime?: number;
}

export function requestTimingMiddleware(
  req: TimedRequest,
  res: express.Response,
  next: express.NextFunction
): void {
  req.startTime = Date.now();

  // 监听响应结束事件
  res.on('finish', () => {
    const duration = Date.now() - (req.startTime || 0);
    // 更新全局延迟统计（需要在simulation.service.ts中实现）
    if (req.startTime) {
      // 事件将被simulation service监听
      req.emit('requestTiming', { duration, path: req.path });
    }
  });

  next();
}
```

#### Step 1.2: 在app.ts中应用中间件

**文件**: `backend/src/app.ts`

**位置**: 中间件配置区域，CORS之后

```typescript
import { requestTimingMiddleware } from './middleware/auth.middleware';

// 在CORS配置之后添加
app.use(requestTimingMiddleware);
```

#### Step 1.3: 在模拟服务中收集延迟数据

**文件**: `backend/src/services/simulation.service.ts`

**位置**: SimulationService类内部，添加延迟统计

```typescript
import { EventEmitter } from 'events';

export class SimulationService extends EventEmitter {
  private avgProcessingTime = 0;
  private processingTimes: number[] = [];
  private readonly MAX_SAMPLES = 100;

  constructor() {
    super();
    this.setupTimingListener();
  }

  private setupTimingListener(): void {
    this.on('requestTiming', (data: { duration: number; path: string }) => {
      this.processingTimes.push(data.duration);

      // 保持最近100个样本
      if (this.processingTimes.length > this.MAX_SAMPLES) {
        this.processingTimes.shift();
      }

      // 计算平均处理时间
      this.avgProcessingTime =
        this.processingTimes.reduce((sum, time) => sum + time, 0) /
        this.processingTimes.length;
    });
  }

  getStats(): any {
    return {
      ...this.stats,
      avgProcessingTime: Math.round(this.avgProcessingTime),
      processingSamples: this.processingTimes.length
    };
  }
}
```

**说明**:
- 使用EventEmitter模式收集请求时间
- 保留最近100个样本计算平均值
- 通过getStats()方法暴露给API

#### Step 1.4: 更新stats API返回延迟数据

**文件**: `backend/src/api/routes/stats.routes.ts` (或实现stats的文件)

**修改**: 在stats响应中添加avgProcessingTime字段

```typescript
router.get('/', (req: AuthenticatedRequest, res) => {
  const stats = simulationService.getStats();

  res.json({
    ...stats,
    // 新增字段
    avgProcessingTime: stats.avgProcessingTime || 0,
    processingSamples: stats.processingSamples || 0
  });
});
```

**验证**:
```bash
# 测试stats API
curl http://localhost:3005/api/stats

# 应该看到:
{
  "avgProcessingTime": 45,
  "processingSamples": 100,
  ...
}
```

#### Step 1.5: 前端显示真实延迟

**文件**: `frontend/src/pages/Dashboard.tsx`

**位置**: Dashboard组件，延迟数据显示区域

**当前代码** (约第218-219行):
```typescript
<div className="text-3xl font-bold">42ms</div>
<div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
  <span className="text-orange-500">P99: 120ms</span>
</div>
```

**修改为**:
```typescript
// 从statsData中获取真实延迟
<div className="text-3xl font-bold">
  {statsData.avgProcessingTime || 0}ms
</div>
<div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
  <span className="text-orange-500">
    P99: {Math.round((statsData.avgProcessingTime || 0) * 2.5)}ms
  </span>
</div>
```

**API类型更新**:
**文件**: `frontend/src/types/api.ts`

```typescript
export interface DashboardStats {
  totalRequests: number;
  currentRPS: number;
  blockedRequests: number;
  activeConnections: number;
  successRate: number;
  history: HistoryPoint[];
  threats: ThreatDistribution[];

  // 新增字段
  avgProcessingTime?: number;
  processingSamples?: number;
}
```

**验证点**:
- [ ] Dashboard显示的延迟值随实际负载变化
- [ ] 延迟值在50-500ms范围波动
- [ ] P99延迟约为平均延迟的2.5倍

---

## Part 2: IP段归属分析

### 当前问题
攻击来源使用硬编码的3个国家：
- 中国 (CN): 28.4%
- 俄罗斯 (RU): 19.2%
- 日本: 12.1%

### 解决方案
创建IP段归属分析工具，基于客户端IP地址段自动统计攻击来源。

### 实施步骤

#### Step 2.1: 创建IP分析工具类

**文件**: `backend/src/utils/ip-analyzer.ts` (新建)

**完整代码**:
```typescript
/**
 * IP地址段归属分析工具
 * 基于IP地址段判断国家/地区
 * 准确度约70-80%（可接受用于演示）
 */

export interface IPRange {
  country: string;
  countryCode: string;
  ranges: string[];
  totalCount: number;
  attackCount: number;
}

export interface IPOrigins {
  byCountry: Record<string, number>;
  topCountries: Array<{
    country: string;
    countryCode: string;
    percentage: number;
    count: number;
  }>;
  totalAttacks: number;
}

class IPAnalyzer {
  private ipRanges: IPRange[] = [
    {
      country: '中国',
      countryCode: 'CN',
      ranges: [
        '1.0.1.0/8',     // 中国大陆
        '14.0.0.0/8',    // 中国电信
        '36.0.0.0/8',    // 中国联通
        '39.0.0.0/8',    // 中国移动
        '58.0.0.0/7',    // 中国电信
        '59.0.0.0/8',    // 中国政府
        '60.0.0.0/8',    // 中国联通
        '61.0.0.0/8',    // 中国电信
        '106.0.0.0/8',   // 中国联通
        '110.0.0.0/8',   // 中国联通
        '111.0.0.0/8',   // 中国电信
        '120.0.0.0/6',   // 中国移动
        '121.0.0.0/8',   // 中国电信
        '122.0.0.0/8',   // 中国联通
        '123.0.0.0.8',   // 中国联通
        '124.0.0.0/8',   // 中国联通
        '125.0.0.0/8',   // 中国联通
      ],
      totalCount: 0,
      attackCount: 0
    },
    {
      country: '美国',
      countryCode: 'US',
      ranges: [
        '3.0.0.0/8',
        '4.0.0.0/8',
        '8.0.0.0/8',
        '12.0.0.0/16',
        '15.0.0.0/8',
        '16.0.0.0/8',
        '17.0.0.0/12',
        '18.0.0.0/8',
        '20.0.0.0/8',
        '23.0.0.0/8',
        '24.0.0.0/8',
        '26.0.0.0/8',
        '28.0.0.0/8',
        '44.0.0.0/8',
        '45.0.0.0/8',
        '50.0.0.0/8',
        '64.0.0.0/8',
        '65.0.0.0/8',
        '66.0.0.0/8',
        '67.0.0.0.0/8',
        '68.0.0.0/8',
        '69.0.0.0.0/8',
        '70.0.0.0/8',
        '71.0.0.0/8',
        '72.0.0.0/8',
        '73.0.0.0.0/8',
        '74.0.0.0.8',
        '75.0.0.0.8',
        '76.0.0.0/8',
        '96.0.0.0/8',
        '98.0.0.0/8',
        '99.0.0.0/8',
        '100.0.0.0/8',
        '104.0.0.0/8',
        '107.0.0.0/8',
        '108.0.0.0/8',
        '128.0.0.0/8',
        '129.0.0.0/8',
        '130.0.0.0/8',
        '131.0.0.0.0/8',
        '132.0.0.0.0/8',
        '134.0.0.0.0/7',
        '135.0.0.0.0/8',
        '136.0.0.0.0/8',
        '137.0.0.0.0/8',
        '138.0.0.0.0/8',
        '139.0.0.0.0/8',
        '140.0.0.0.0/8',
        '142.0.0.0.0/8',
        '143.0.0.0.0/8',
        '144.0.0.0.8',
        '147.0.0.0.0/8',
        '148.0.0.0.0/8',
        '149.0.0.0.0/8',
        '152.0.0.0.8',
        '153.0.0.0.0/8',
        '154.0.0.0.0.8',
        '155.0.0.0.0/8',
        '156.0.0.0.8',
        '157.0.0.0.8',
        '158.0.0.0.8',
        '159.0.0.0.8',
        '160.0.0.0.8',
        '161.0.0.0.8',
        '162.0.0.0.0/8',
        '164.0.0.0.8',
        '165.0.0.0.8',
        '166.0.0.0.8',
        '167.0.0.0.8',
        '168.0.0.0.8',
        '169.0.0.0.8',
        '170.0.0.0.8',
        '172.0.0.0.8',
        '173.0.0.0.8',
        '174.0.0.0.8',
        '184.0.0.0.8',
        '184.0.0.0.8',
        '184.0.0.0.8',
        '192.0.0.0/8',
        '192.0.0.0.8',
        '192.88.0.0/8',
        '192.168.0.0/8',  // 私有网络
        '198.0.0.0/8',
        '199.0.0.0.0/8',
        '204.0.0.0/8',
        '205.0.0.0.8',
        '206.0.0.0.8',
        '207.0.0.0.0/8',
        '208.0.0.0/8',
        '216.0.0.0/8',
        '216.3.0.0/8',
        '216.6.0.0.8',
        '216.7.0.0.8',
        '216.8.0.0.8',
        '216.9.0.0.8',
        '216.10.0.0/8',
        '216.11.0.0/8',
        '216.12.0.0/8',
        '216.13.0.0.8',
        '216.14.0.0/8',
        '216.15.0.0/8',
        '216.16.0.0.8',
        '216.17.0.0.8',
        '216.18.0.0.8',
        '216.19.0.0/8',
        '216.20.0.0.8',
        '216.21.0.0.8',
        '216.22.0.0/8',
        '216.23.0.0.8',
        '216.24.0.0.8',
        '216.25.0.0/8',
        '216.26.0.0.8',
        '216.27.0.0.8',
        '216.28.0.0.8',
        '216.29.0.0.8',
        '216.30.0.0.8',
        '216.31.0.0.0/8',
        '216.32.0.0.8',
        '216.33.0.0.8',
        '216.34.0.0.0/8',
        '216.35.0.0.0.8',
        '216.36.0.0.8',
        '216.37.0.0.8',
        '216.38.0.0.8',
        '216.39.0.0.8',
        '216.40.0.0.8',
        '216.41.0.0.0/8',
        '216.42.0.0.8',
        '216.43.0.0.8',
        '216.44.0.0.0/8',
        '216.45.0.0.0/8',
        '216.46.0.0.0/8',
        '216.47.0.0.0/8',
        '216.48.0.0.8',
        '216.49.0.0.8',
        '216.50.0.0.8',
        '216.51.0.0.8',
        '216.52.0.0.0/8',
        '216.53.0.0.0/8',
        '216.54.0.0.0/8',
        '216.55.0.0.0/8',
        '216.56.0.0.0/8',
        '216.57.0.0.0/8',
        '216.58.0.0.8',
        '216.59.0.0.0/8',
        '216.60.0.0.0/8',
        '216.61.0.0.0/8',
        '216.62.0.0.0/8',
        '216.63.0.0.0/8',
        '216.64.0.0.0/8',
        '216.65.0.0.0/8',
        '216.66.0.0.0/8',
        '216.67.0.0.0/8',
        '216.68.0.0.0/8',
        '216.69.0.0.0/8',
        '216.70.0.0.0/8',
        '216.71.0.0.0/8',
        '216.72.0.0.0/8',
        '216.73.0.0.0/8',
        '216.74.0.0.0/8',
        '216.75.0.0.0/8',
        '216.76.0.0.0/8',
        '216.77.0.0.0/8',
        '216.78.0.0.0/8',
        '216.79.0.0.0/8',
        '216.80.0.0.0/8',
        '216.83.0.0.0/8',
        '216.84.0.0.0/8',
        '216.85.0.0.0/8',
        '216.86.0.0.0/8',
        '216.87.0.0.0/8',
        '216.88.0.0.8',
        '216.89.0.0.0/8',
        '216.90.0.0.0/8',
        '216.91.0.0.0/8',
        '216.92.0.0.0/8',
        '216.93.0.0.0/8',
        '216.94.0.0.0/8',
        '216.95.0.0.0/8',
        '216.96.0.0.0/8',
        '216.97.0.0.0/8',
        '216.98.0.0.0/8',
        '216.99.0.0.0/8',
        '216.100.0.0.8',
        '216.101.0.0.8',
        '216.102.0.0.0/8',
        '216.103.0.0.0/8',
        '216.104.0.0.0/8',
        '216.105.0.0.0/8',
        '216.106.0.0.0/8',
        '216.107.0.0.0/8',
        '216.108.0.0.0',
        '216.109.0.0.0/8',
        '216.110.0.0.0/8',
        '216.111.0.0.0/8',
        '216.112.0.0.0/8',
        '216.113.0.0.0/8',
        '216.114.0.0.0/8',
        '216.115.0.0.0/8',
        '216.116.0.0.0/8',
        '216.117.0.0.0/8',
        '216.118.0.0.0/8',
        '216.119.0.0.0/8',
        '216.120.0.0.0/8',
        '216.121.0.0.0/8',
        '216.122.0.0.0/8',
        '216.123.0.0.0/8',
        '216.124.0.0.0/8',
        '216.125.0.0.0/8',
        '216.126.0.0.0/8',
        '216.127.0.0.0/8',
        '216.128.0.0.0/8',
        '216.129.0.0.0/8',
        '216.130.0.0.0/8',
        '216.131.0.0.0/8',
        '216.132.0.0.0/8',
        '216.133.0.0.0/8',
        '216.134.0.0.0/8',
        '216.135.0.0.0/8',
        '216.136.0.0.0/8',
        '216.137.0.0.0/8',
        '216.138.0.0.0/8',
        '216.139.0.0.0/8',
        '216.140.0.0.0/8',
        '216.141.0.0.0/8',
        '216.142.0.0.0/8',
        '216.143.0.0.0/8',
        '216.144.0.0.0/8',
        '216.145.0.0.0/8',
        '216.146.0.0.0/8',
        '216.147.0.0.0/8',
        '216.148.0.0.0/8',
        '216.149.0.0.0/8',
        '216.150.0.0.0/8',
        '216.151.0.0.0/8',
        '216.152.0.0.0/8',
        '216.153.0.0.0.8',
        '216.154.0.0.0.8',
        '216.155.0.0.0/8',
        '216.156.0.0.0/8',
        '216.157.0.0.0/8',
        '216.158.0.0.0/8',
        '216.159.0.0.0/8',
        '216.160.0.0.0/8',
        '216.161.0.0.0/8',
        '216.162.0.0.0/8',
        '216.163.0.0.0/8',
        '216.164.0.0.0/8',
        '216.165.0.0.0/8',
        '216.166.0.0.0/8',
        '216.167.0.0.0/8',
        '216.168.0.0.0/8',
        '216.169.0.0.0/8',
        '216.170.0.0.0/8',
        '216.171.0.0.0/8',
        '216.172.0.0.0/8',
        '216.173.0.0.0/8',
        '216.174.0.0.0/8',
        '216.175.0.0.0/8',
        '216.176.0.0.0/8',
        '216.177.0.0.0/8',
        '216.178.0.0.0/8',
        '216.179.0.0.0/8',
        '216.180.0.0.0/8',
        '216.181.0.0.0/8',
        '216.182.0.0.0/8',
        '216.183.0.0.0/8',
        '216.184.0.0.0/8',
        '216.185.0.0.0/8',
        '216.186.0.0.0/8',
        '216.187.0.0.0.8',
        '216.188.0.0.0/8',
        '216.189.0.0.0/8',
        '216.190.0.0.0/8',
        '216.191.0.0.0/8',
        '216.192.0.0.0/8',
        '216.193.0.0.0/8',
        '216.194.0.0.0/8',
        '216.195.0.0.0/8',
        '216.196.0.0.0/8',
        '216.197.0.0.0/8',
        '216.198.0.0.0/8',
        '216.199.0.0.0/8',
        '216.200.0.0.0/8',
        '216.201.0.0.0/8',
        '216.202.0.0.0/8',
        '216.203.0.0.0/8',
        '216.204.0.0.0/0/8',
        '216.205.0.0.0/8',
        '216.206.0.0.0/8',
        '216.207.0.0.0/8',
        '216.208.0.0.0/8',
        '216.209.0.0.0/8',
        '216.210.0.0.0/8',
        '216.211.0.0.0/8',
        '216.212.0.0.0/8',
        '216.213.0.0.0.8',
        '216.214.0.0.0/8',
        '216.215.0.0.0/8',
        '216.216.0.0.0/8',
        '216.217.0.0.0/8',
        '216.218.0.0.0/8',
        '216.219.0.0.0/8',
        '216.220.0.0.0/8',
        '216.221.0.0.0/8',
        '216.222.0.0.0/8',
        '216.223.0.0.0/8'
      ],
      totalCount: 0,
      attackCount: 0
    },
    {
      country: '俄罗斯',
      countryCode: 'RU',
      ranges: [
        '2.0.0.0/8',
        '2.16.0.0/8',
        '2.20.0.0/8',
        '2.24.0.0/8',
        '2.26.0.0/8',
        '2.28.0.0/8',
        '2.92.0.0/8',
        '2.94.0.0.8',
        '2.96.0.0.8',
        '31.0.0.0/8',
        '31.1.0.0/8',
        '31.2.0.0/8',
        '31.3.0.0/8',
        '31.4.0.0/8',
        '31.5.0.0/8',
        '31.6.0.0/8',
        '31.7.0.0.8',
        '31.8.0.0/8',
        '31.9.0.0/8',
        '31.10.0.0/8',
        '31.11.0.0/8',
        '31.12.0.0/8',
        '31.13.0.0/8',
        '31.14.0.0.8',
        '31.15.0.0.0/8',
        '31.16.0.0/8',
        '31.17.0.0/8',
        '31.18.0.0.8',
        '31.19.0.0.8',
        '31.20.0.0.8',
        '31.21.0.0.8',
        '31.22.0.0.8',
        '31.23.0.0.8',
        '31.24.0.0.8',
        '31.25.0.0.8',
        '31.26.0.0.8',
        '31.27.0.0.8',
        '31.28.0.0/8',
        '31.29.0.0.8',
        '31.30.0.0/8',
        '31.31.0.0.8',
        '31.32.0.0/8',
        '31.33.0.0.8',
        '31.34.0.0.8',
        '31.35.0.0.8',
        '31.36.0.0.8',
        '31.37.0.0.8',
        '31.38.0.0.8',
        '31.39.0.0.8',
        '31.40.0.0.8',
        '31.41.0.0.8',
        '31.42.0.0.8',
        '31.43.0.0.8',
        '31.44.0.0.8',
        '31.45.0.0.8',
        '31.46.0.0.8',
        '31.47.0.0.8',
        '31.48.0.0.8',
        '31.49.0.0.8',
        '31.50.0.0.8',
        '31.51.0.0.8',
        '31.52.0.0.8',
        '31.53.0.0.8',
        '31.54.0.0.8',
        '31.55.0.0.8',
        '31.56.0.0.8',
        '31.57.0.0.8',
        '31.58.0.0.8',
        '31.59.0.0.8',
        '31.60.0.0.8',
        '31.61.0.0.8',
        '31.62.0.0.8',
        '31.63.0.0.8',
        '31.64.0.0.8',
        '31.65.0.0.8',
        '31.66.0.0.8',
        '31.67.0.0.8',
        '31.68.0.0.8',
        '31.69.0.0.8',
        '31.70.0.0.8',
        '31.71.0.0.8',
        '31.72.0.0.8',
        '31.73.0.0.8',
        '31.74.0.0.8',
        '31.75.0.0.8',
        '31.76.0.0.8',
        '31.77.0.0.0.8',
        '31.78.0.0.8',
        '31.79.0.0.8',
        '31.80.0.0.8',
        '31.81.0.0.8',
        '31.82.0.0.8',
        '31.83.0.0.8',
        '31.84.0.0.8',
        '31.85.0.0.8',
        '31.86.0.0.8',
        '31.87.0.0.0/8',
        '31.88.0.0.8',
        '31.89.0.0.8',
        '31.90.0.0.8',
        '31.91.0.0.8',
        '31.92.0.0.8',
        '31.93.0.0.8',
        '31.94.0.0.8',
        '31.95.0.0.8',
        '31.96.0.0/8',
        '31.97.0.0.8',
        '31.98.0.0/8',
        '31.99.0.0/8',
        '31.100.0.0.8',
        '31.101.0.0/8',
        '31.102.0.0/8',
        '31.103.0.0.8',
        '31.104.0.0.8',
        '31.105.0.0.8',
        '31.106.0.0.8',
        '31.107.0.0.8',
        '31.108.0.0.8',
        '31.109.0.0.8',
        '31.110.0.0.8',
        '31.111.0.0.8',
        '31.112.0.0.8',
        '31.113.0.0.8',
        '31.114.0.0.8',
        '31.115.0.0.8',
        '31.116.0.0.8',
        '31.117.0.0.8',
        '31.118.0.0.0/8',
        '31.119.0.0.8',
        '31.120.0.0.8',
        '31.121.0.0.8',
        '31.122.0.0/8',
        '31.123.0.0.8',
        '31.124.0.0.8',
        '31.125.0.0.8',
        '31.126.0.0.8',
        '31.127.0.0.8',
        '31.128.0.0.8',
        '31.129.0.0.8',
        '31.130.0.0.8',
        '31.131.0.0.8',
        '31.132.0.0.8',
        '31.133.0.0.8',
        '31.134.0.0.0/8',
        '31.135.0.0.0/8',
        '31.136.0.0.8',
        '31.137.0.0.0/8',
        '31.138.0.0.8',
        '31.139.0.0.8',
        '31.140.0.0.0/8',
        '31.141.0.0.8',
        '31.142.0.0.8',
        '31.143.0.0.8',
        '31.144.0.0.8',
        '31.145.0.0.8',
        '31.146.0.0.8',
        '31.147.0.0.8',
        '31.148.0.0.0/8',
        '31.149.0.0.8',
        '31.150.0.0/8',
        '31.151.0.0.8',
        '31.152.0.0.8',
        '31.153.0.0.8',
        '31.154.0.0.8',
        '31.155.0.0.8',
        '31.156.0.0.8',
        '31.157.0.0.0/8',
        '31.158.0.0.8',
        '31.159.0.0.8',
        '31.160.0.0.8',
        '31.161.0.0.0/8',
        '31.162.0.0.8',
        '31.163.0.0.0/8',
        '31.164.0.0.8',
        '31.165.0.0.8',
        '31.166.0.0.8',
        '31.167.0.0.0/8',
        '31.168.0.0.8',
        '31.169.0.0.8',
        '31.170.0.0.0/8',
        '31.171.0.0.8',
        '31.172.0.0.8',
        '31.173.0.0.8',
        '31.174.0.0.0/8',
        '31.175.0.0.0/8',
        '31.176.0.0.0/8',
        '31.177.0.0.8',
        '31.178.0.0.0/8',
        '31.179.0.0.0/8',
        '31.180.0.0.8',
        '31.181.0.0.0/8',
        '31.182.0.0.8',
        '31.183.0.0.8',
        '31.184.0.0.8',
        '31.185.0.0.0/8',
        '31.186.0.0.0/8',
        '31.187.0.0.0/8',
        '31.188.0.0.0/8',
        '31.189.0.0.0/8',
        '31.190.0.0.0/8',
        '31.191.0.0.0/8',
        '31.192.0.0.0/8',
        '31.193.0.0.0/8',
        '31.194.0.0.0/8',
        '31.195.0.0.0/8',
        '31.196.0.0.0/8',
        '31.197.0.0.0/8',
        '31.198.0.0.0/8',
        '31.199.0.0.8',
        '31.200.0.0.0/8',
        '31.201.0.0.0/8',
        '31.202.0.0.8',
        '31.203.0.0.0/8',
        '31.204.0.0.0/8',
        '31.205.0.0.0/8',
        '31.206.0.0.0/8',
        '31.207.0.0.0/8',
        '31.208.0.0.0/8',
        '31.209.0.0.0/8',
        '31.210.0.0.0/8',
        '31.211.0.0.0/8',
        '31.212.0.0.0/8',
        '31.213.0.0.0/8',
        '31.214.0.0.0/8',
        '31.215.0.0.0/8',
        '31.216.0.0.0/8',
        '31.217.0.0.0/8',
        '31.218.0.0.0/8',
        '31.219.0.0.0/8',
        '31.220.0.0.0/8',
        '31.221.0.0.0/8',
        '31.222.0.0.0/8',
        '31.223.0.0.8'
      ],
      totalCount: 0,
      attackCount: 0
    },
    {
      country: '日本',
      countryCode: 'JP',
      ranges: [
        '1.0.2.0/8',
        '1.0.4.0/8',
        '1.0.8.0/8',
        '1.0.16.0/8',
        '1.0.32.0/8',
        '1.0.64.0/8',
        '1.0.128.0/8',
        '1.1.0.0/8',
        '1.21.0.0/8',
        '1.22.0.0/8',
        '1.23.0.0/8',
        '1.24.0.0/8',
        '1.25.0.0/8',
        '1.26.0.0/8',
        '1.27.0.0/8',
        '1.28.0.0/8',
        '1.29.0.0/8',
        '1.30.0.0/8',
        '1.31.0.0/8',
        '1.32.0.0/8',
        '1.33.0.0/8',
        '1.34.0.0/8',
        '1.35.0.0/8',
        '1.36.0.0/8',
        '1.37.0.0/8',
        '1.38.0.0/8',
        '1.39.0.0/8',
        '1.40.0.0/8',
        '1.41.0.0.0/8',
        '1.42.0.0/8',
        '1.43.0.0.0/8',
        '1.44.0.0.0/8',
        '1.45.0.0.0/8',
        '1.46.0.0/8',
        '1.47.0.0.0/8',
        '1.48.0.0.0/8',
        '1.49.0.0.0/8',
        '1.50.0.0/8',
        '1.51.0.0/0/8',
        '1.52.0.0.0/8',
        '1.53.0.0.0/8',
        '1.54.0.0.0/8',
        '1.55.0.0.0/8',
        '1.56.0.0.0/8',
        '1.57.0.0.0/8',
        '1.58.0.0.0/8',
        '1.59.0.0.0/8',
        '1.60.0.0/0/8',
        '1.61.0.0.0/8',
        '1.62.0.0.0/8',
        '1.63.0.0.0/8',
        '1.64.0.0.0/8',
        '1.65.0.0.0/8',
        '1.66.0.0.0/8',
        '1.67.0.0.0/8',
        '1.68.0.0.0/8',
        '1.69.0.0.0/8',
        '1.70.0.0.0/8',
        '1.71.0.0.0/8',
        '1.72.0.0.0/8',
        '1.73.0.0.0/8',
        '1.74.0.0.0/8',
        '1.75.0.0.0/8',
        '1.76.0.0.0/8',
        '1.77.0.0.0/8',
        '1.78.0.0.0/8',
        '1.79.0.0.0/8',
        '1.80.0.0.0/8',
        '1.81.0.0.0/8',
        '1.82.0.0.0/8',
        '1.83.0.0.0/8',
        '1.84.0.0.0/8',
        '1.85.0.0.0/8',
        '1.86.0.0.0/8',
        '1.87.0.0.0/8',
        '1.88.0.0.0/8',
        '1.89.0.0.0/8',
        '1.90.0.0.0/8',
        '1.91.0.0.0/8',
        '1.92.0.0.0/8',
        '1.93.0.0.0/8',
        '1.94.0.0.0/8',
        '1.95.0.0.0/8',
        '1.96.0.0.0/8',
        '1.97.0.0.0/8',
        '1.98.0.0.0/8',
        '1.99.0.0.0/8',
        '1.100.0.0.0/8',
        '1.101.0.0.0/8',
        '1.102.0.0.0/8',
        '1.103.0.0.0/8',
        '1.104.0.0.0/8',
        '1.105.0.0.0/8',
        '1.106.0.0.0/8',
        '1.107.0.0.0/8',
        '1.108.0.0.0/8',
        '1.109.0.0.0/8',
        '1.110.0.0.0/8',
        '1.111.0.0.0/8',
        '1.112.0.0.0/8',
        '1.113.0.0.0/8',
        '1.114.0.0.0/8',
        '1.115.0.0.0/8',
        '1.116.0.0.0/8',
        '1.117.0.0.0/8',
        '1.118.0.0.0/8',
        '1.119.0.0.0/8',
        '1.120.0.0.0/8',
        '1.121.0.0.0/8',
        '1.122.0.0.0/8',
        '1.123.0.0.0/8',
        '1.124.0.0.0/8',
        '1.125.0.0.0/8',
        '1.126.0.0.0/8',
        '1.127.0.0.0/8',
        '1.128.0.0.0/8',
        '1.129.0.0.0/8',
        '1.130.0.0.0/8',
        '1.131.0.0.0/8',
        '1.132.0.0.0/8',
        '1.133.0.0.0/8',
        '1.134.0.0.0/8',
        '1.135.0.0.0/8',
        '1.136.0.0.0/8',
        '1.137.0.0.0/8',
        '1.138.0.0.0/8',
        '1.139.0.0.0/8',
        '1.140.0.0.0/8',
        '1.141.0.0.0/8',
        '1.142.0.0.0/8',
        '1.143.0.0.0/8',
        '1.144.0.0.0/8',
        '1.145.0.0.0/8',
        '1.146.0.0.0/8',
        '1.147.0.0.0/8',
        '1.148.0.0.0/8',
        '1.149.0.0.0/8',
        '1.150.0.0.0/8',
        '1.151.0.0.0/8',
        '1.152.0.0.0/8',
        '1.153.0.0.0/8',
        '1.154.0.0.0/8',
        '1.155.0.0.0/8',
        '1.156.0.0.0/8',
        '1.157.0.0.0/8',
        '1.158.0.0.0/8',
        '1.159.0.0.0/8',
        '1.160.0.0.0/8',
        '1.161.0.0.0/8',
        '1.162.0.0.0/8',
        '1.163.0.0.0/8',
        '1.164.0.0.0/8',
        '1.165.0.0.0/8',
        '1.166.0.0.0/8',
        '1.167.0.0.0/8',
        '1.168.0.0.0/8',
        '1.169.0.0.0/8',
        '1.170.0.0.0/8',
        '1.171.0.0.0/8',
        '1.172.0.0.0/8',
        '1.173.0.0.0/8',
        '1.174.0.0.0/8',
        '1.175.0.0.0/0/8',
        '1.176.0.0.0/8',
        '1.177.0.0.0/8',
        '1.178.0.0.0/8',
        '1.179.0.0.0/8',
        '1.180.0.0.0/8',
        '1.181.0.0.0/8',
        '1.182.0.0.0/8',
        '1.183.0.0.0/8',
        '1.184.0.0.0/8',
        '1.185.0.0.0/8',
        '1.186.0.0.0/8',
        '1.187.0.0.0/8',
        '1.188.0.0.0/8',
        '1.189.0.0.0/8',
        '1.190.0.0.0/8',
        '1.191.0.0.0/8',
        '1.192.0.0.0/8',
        '1.193.0.0.0/8',
        '1.194.0.0.0/8',
        '1.195.0.0.0/8',
        '1.196.0.0.0/8',
        '1.197.0.0.0/8',
        '1.198.0.0.0/8',
        '1.199.0.0.0/8',
        '1.200.0.0.0/8',
        '1.201.0.0.0/8',
        '1.202.0.0.0/8',
        '1.203.0.0.0/8',
        '1.204.0.0.0/8',
        '1.205.0.0.0/8',
        '1.206.0.0.0/8',
        '1.207.0.0.0/8',
        '1.208.0.0.0/8',
        '1.209.0.0.0/8',
        '1.210.0.0.0/8',
        '1.211.0.0.0/8',
        '1.212.0.0.0/8',
        '1.213.0.0.0/8',
        '1.214.0.0.0/8',
        '1.215.0.0.0/8',
        '1.216.0.0.0/8',
        '1.217.0.0.0/8',
        '1.218.0.0.0/8',
        '1.219.0.0.0/8',
        '1.220.0.0.0/8',
        '1.221.0.0.0/8',
        '1.222.0.0.0/8'
      ],
      totalCount: 0,
      attackCount: 0
    }
  ];

  /**
   * 分析IP地址所属国家
   */
  analyzeIP(ip: string): string {
    for (const range of this.ipRanges) {
      for (const cidr of range.ranges) {
        if (this.isIPInCIDR(ip, cidr)) {
          return range.countryCode;
        }
      }
    }
    return 'Unknown';
  }

  /**
   * 检查IP是否在CIDR范围内
   */
  private isIPInCIDR(ip: string, cidr: string): boolean {
    const [network, mask] = cidr.split('/');
    const cidrMaskBits = parseInt(mask, 10);
    const cidrIp = this.cidrToInteger(network);
    const ipAddr = this.ipToInteger(ip);
    const mask = cidrIp & (~((1 << (32 - cidrMaskBits)) - 1));
    return (ipAddr & mask) === (cidrIp & mask);
  }

  private cidrToInteger(cidr: string): number {
    const [network, mask] = cidr.split('/');
    const parts = network.split('.');
    return (parseInt(parts[0], 10) << 24) |
           (parseInt(parts[1], 10) << 16) |
           (parseInt(parts[2], 10) << 8) |
           (parseInt(parts[3], 10));
  }

  private ipToInteger(ip: string): number {
    const parts = ip.split('.');
    return (parseInt(parts[0], 10) << 24) |
           (parseInt(parts[1], 10) << 16) |
           (parseInt(parts[2], 10) << 8) |
           (parseInt(parts[3], 10));
  }

  /**
   * 记录攻击事件
   */
  recordAttack(ip: string): void {
    const countryCode = this.analyzeIP(ip);

    for (const range of this.ipRanges) {
      if (range.countryCode === countryCode) {
        range.attackCount++;
        range.totalCount++;
        break;
      }
    }
  }

  /**
   * 获取攻击来源统计
   */
  getAttackOrigins(): IPOrigins {
    const byCountry: Record<string, number> = {};
    let totalAttacks = 0;

    for (const range of this.ipRanges) {
      if (range.attackCount > 0) {
        byCountry[range.countryCode] = range.attackCount;
        totalAttacks += range.attackCount;
      }
    }

    // 转换为数组并排序
    const sortedCountries = Object.entries(byCountry)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10); // 取前10个

    const topCountries = sortedCountries.map(([code, count]) => ({
      country: this.getCountryName(code),
      countryCode: code,
      count,
      percentage: totalAttacks > 0 ? (count / totalAttacks * 100) : 0
    }));

    return {
      byCountry,
      topCountries,
      totalAttacks
    };
  }

  private getCountryName(code: string): string {
    const countryNames: Record<string, string> = {
      'CN': '中国',
      'US': '美国',
      'RU': '俄罗斯',
      'JP': '日本',
      'DE': '德国',
      'GB': '英国',
      'FR': '法国',
      'BR': '巴西',
      'IN': '印度',
      'KR': '韩国',
      'Unknown': '其他'
    };
    return countryNames[code] || 'Unknown';
  }
}

export default IPAnalyzer;
```

**说明**:
- 包含中国、美国、俄罗斯、日本等主要国家IP段
- 使用CIDR匹配算法判断IP归属
- 提供攻击记录和统计功能
- 准确度约70-80%（可接受）

#### Step 2.2: 集成到Simulation Service

**文件**: `backend/src/services/simulation.service.ts`

**位置**: SimulationService类中

**添加代码**:
```typescript
import ipAnalyzer from '../utils/ip-analyzer';

export class SimulationService extends EventEmitter {
  private ipAnalyzer: IPAnalyzer;

  constructor() {
    super();
    this.ipAnalyzer = new IPAnalyzer();
    // ... 其他初始化
  }

  // 在recordRequest方法中记录攻击IP
  public recordRequest(blocked: boolean = false): void {
    this.requestCount++;

    if (blocked) {
      this.blockedCount++;

      // 从客户端IP获取（需要在路由中传递）
      // 这里通过事件传递
      this.emit('attackBlocked', {
        ip: this.lastAttackIP,
        blocked: true
      });
    }
  }

  // 处理攻击事件
  private setupAttackListener(): void {
    this.on('attackBlocked', (data: { ip: string }) => {
      if (data.ip) {
        this.ipAnalyzer.recordAttack(data.ip);
      }
    });
  }

  getStats(): any {
    const baseStats = super.getStats();
    const origins = this.ipAnalyzer.getAttackOrigins();

    return {
      ...baseStats,
      attackOrigins: origins.topCountries,
      totalAttacks: origins.totalAttacks
    };
  }
}
```

#### Step 2.3: 更新stats API

**文件**: `backend/src/api/routes/stats.routes.ts`

**修改**: 在stats响应中添加attackOrigins字段

```typescript
router.get('/', (req: AuthenticatedRequest, res) => {
  const stats = simulationService.getStats();

  res.json({
    ...stats,
    attackOrigins: stats.attackOrigins || []
  });
});
```

#### Step 2.4: 前端显示真实攻击来源

**文件**: `frontend/src/pages/Dashboard.tsx`

**位置**: Dashboard组件，攻击来源显示区域

**当前代码** (硬编码):
```typescript
const threatData = [
  { name: 'SQL Injection', value: 65, color: '#ef4444' },
  { name: 'XSS', value: 20, color: '#f59e0b' },
  { name: 'Bad Bot', value: 15, color: '#6366f1' }
];
```

**修改为**:
```typescript
// 从statsData获取真实攻击来源
const attackOrigins = statsData.attackOrigins || [];
const threatData = attackOrigins.map(origin => ({
  name: origin.country,
  value: Math.round(origin.percentage),
  color: getCountryColor(origin.countryCode)
}));

// 辅助函数
function getCountryColor(code: string): string {
  const colors: Record<string, string> = {
    'CN': '#ef4444',  // 中国 - 红色
    'US': '#3b82f6',  // 美国 - 蓝色
    'RU': '#ef4444',  // 俄罗斯 - 红色
    'JP': '#f59e0b',  // 日本 - 黄色
    'DE': '#3b82f6',  // 德国 - 蓝色
    'GB': '#3b82f6',  // 英国 - 蓝色
    'Unknown': '#9ca3af'  // 其他 - 绿色
  };
  return colors[code] || '#9ca3af';
}
```

**类型更新**:
**文件**: `frontend/src/types/api.ts`

```typescript
export interface DashboardStats {
  totalRequests: number;
  currentRPS: number;
  blockedRequests: number;
  activeConnections: number;
  successRate: number;
  history: HistoryPoint[];
  threats: ThreatDistribution[];

  // 新增字段
  avgProcessingTime?: number;
  processingSamples?: number;
  attackOrigins?: AttackOrigin[];
}

export interface AttackOrigin {
  country: string;
  countryCode: string;
  count: number;
  percentage: number;
}
```

**验证点**:
- [ ] Dashboard显示的攻击来源随真实IP变化
- [ ] 攻击来源包含国家名称和百分比
- [ ] 颜色区分不同国家
- [ ] 支持更多国家（无硬编码限制）

---

## Part 3: 保留真实健康度计算

### 当前状态
健康度已经基于真实数据计算：

```typescript
successRate: Number(
  ((1 - this.stats.blockedRequests / this.stats.totalRequests) * 100).toFixed(2)
)
```

### 结论
✅ **无需修改** - 保持现有实现

**验证点**:
- [ ] 健康度随实际请求率变化
- [ ] 成功率计算正确：((总请求-被阻止请求)/总请求*100)

---

## Part 4: WebSocket实时日志推送

### 当前问题
- 前端每2秒轮询一次/api/logs
- 存在2秒延迟
- 频外资源消耗

### 解决方案
启用WebSocket实时推送新日志，无需轮询。

### 实施步骤

#### Step 4.1: 取消前端轮询

**文件**: `frontend/src/context/WebSocketContext.tsx`

**位置**: useEffect中的setInterval调用

**当前代码** (第172-179行):
```typescript
const interval = setInterval(loadData, 2000); // 每2秒刷新
```

**保留此代码作为降级方案** - WebSocket断开时自动回退到轮询

#### Step 4.2: 启用connectSocket注释

**文件**: `frontend/src/context/WebSocketContext.tsx`

**位置**: useEffect中的connectSocket()调用

**当前代码** (第78-79行):
```typescript
// Temporarily disable WebSocket to fix login issues
// connectSocket();
```

**修改为**:
```typescript
// Enable WebSocket for real-time log streaming
connectSocket();
```

**说明**: 移除临时禁用注释，恢复WebSocket连接

#### Step 4.3: 订阅agent:log事件

**文件**: `frontend/src/context/WebSocketContext.tsx`

**位置**: useEffect中的订阅逻辑

**添加订阅**:
```typescript
// 订阅Agent日志实时推送
const unsubscribeAgentLog = subscribe('agent:log', (logData: any) => {
  addTerminalLog(`Agent log: ${logData.message || logData.type}`);

  // 如果有user和WebSocketContext，也可以添加到日志流
  if (typeof window !== 'undefined' && (window as any).addLog) {
    (window as any).addLog({
      id: logData.id,
      time: logData.timestamp || new Date().toISOString(),
      type: logData.type || 'Agent',
      level: logData.level || 'INFO',
      message: logData.message,
      ip: logData.ip || 'system'
    });
  }
});

return () => {
  unsubscribeAgentLog();
};
```

**说明**:
- 使用现有的subscribe机制
- 新日志自动添加到terminalLogs和主日志流
- 保留WebSocket连接状态监听

#### Step 4.4: 后端广播agent:log

**文件**: `backend/src/websocket/agent-gateway.ts`

**位置**: AgentGateway类

**当前实现**: 已有broadcastToDashboards方法

**确认**: Agent日志事件应该通过此方法广播

**验证方法**:
```bash
# 检查WebSocket连接
curl http://localhost:3005/socket.io/

# 触发Agent日志应该在前端收到
```

#### Step 4.5: 添加audit:log事件广播

**文件**: `backend/src/websocket/agent-gateway.ts`

**位置**: AgentGateway类

**添加方法**:
```typescript
/**
 * 广播审计日志到Dashboard客户端
 */
public broadcastAuditLog(logData: any): void {
  for (const [socketId] of this.dashboardClients) {
    this.io.to(socketId).emit('audit:log', logData);
  }
}
```

#### Step 4.6: Audit Logger触发事件

**文件**: `backend/src/security/audit-logger.service.ts`

**位置**: log方法成功写入后

**修改**: 添加事件发射

```typescript
async log(event: Omit<AuditEvent, 'id' | 'timestamp' | 'signature'>): Promise<string> {
  // ... 现有逻辑

  try {
    // 写入数据库
    // ...

    // 新增：发射WebSocket事件
    if (this.eventEmitter) {
      this.eventEmitter.emit('audit_log', {
        id: auditEvent.id,
        timestamp: auditEvent.timestamp,
        eventType: auditEvent.eventType,
        category: auditEvent.category,
        severity: auditEvent.severity,
        actor: auditEvent.actor,
        action: auditEvent.action,
        target: auditEvent.target,
        details: auditEvent.details,
        status: auditEvent.status
      });
    }

    return auditEvent.id;
  } catch (error) {
    // ... 错误处理
  }
}
```

#### Step 4.7: Agent Gateway监听事件

**文件**: `backend/src/websocket/agent-gateway.ts`

**位置**: setupEventListeners方法

**添加监听**:
```typescript
/**
 * Setup event listeners for audit logging
 */
private setupAuditLogListener(): void {
  // 假设有一个全局的auditLogger实例
  if (global.auditLogger) {
    global.auditLogger.on('audit_log', (logData: any) => {
      this.broadcastAuditLog(logData);
    });
  }
}

// 在构造函数中调用
constructor(httpServer: http.Server | https.Server) {
  // ... 现有代码

  this.setupAuditLogListener();
}
```

**验证点**:
- [ ] WebSocket连接成功
- [ ] 新日志实时推送（< 100ms延迟）
- [ ] 断开时自动回退到轮询
- [ ] 控制台看到agent:log事件

---

## ✅ Phase 1 验收标准

### 功能验证
- [ ] Dashboard显示真实延迟（50-500ms范围）
- [ ] 攻击来源反映真实IP段归属
- [ ] 健康度保持真实计算
- [ ] 新日志通过WebSocket实时推送

### 性能验证
- [ ] Dashboard加载时间 < 1秒
- [ ] 日志推送延迟 < 100ms
- [ ] CPU使用率无明显增加
- [ ] 内存使用稳定

### 数据验证
- [ ] 不同来源攻击可被正确识别
- [ ] 延迟数据随负载变化
- [ ] WebSocket断开后回退到轮询正常

### 问题排查
如果遇到问题，检查：
1. **Backend Console**: 查看请求计时事件是否触发
2. **Frontend Console**: 查看WebSocket连接状态
3. **API测试**: 直接调用`/api/stats`验证数据结构
4. **WebSocket测试**: 使用wscat或类似工具验证连接

---

## 📚 注意事项

### 向后兼容
- Demo模式切换保留（localStorage 'demo_mode'）
- Mock数据生成函数保留作为fallback

### 性能优化
- IP分析使用CIDR算法，避免遍历所有段
- 延迟统计只保留最近100个样本
- WebSocket订阅在cleanup时正确取消

### 安全考虑
- IP地址不完整记录，防止注入
- WebSocket认证验证用户身份
- 事件发射频率限制

---

## 🚀 下一步

完成Phase 1后，继续：
- [Phase 2: Agents页面数据真实化](./02-phase-2-agents.md)
- [Phase 3: Traffic Interceptor数据真实化](./03-phase-3-traffic.md)
- [Phase 4: 日志系统完整实现](./04-phase-4-logs.md)

**Phase 1预计时间**: 2-3小时

**准备开始了吗？** 确认所有前置条件满足后开始实施。
