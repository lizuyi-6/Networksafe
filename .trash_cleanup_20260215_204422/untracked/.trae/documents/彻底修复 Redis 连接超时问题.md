## 问题根源分析

### 1. Redis 服务状态
- 本地开发环境没有安装/运行 Redis 服务
- Docker Compose 配置中有 Redis，但本地开发模式 (`npm run dev`) 不使用 Docker

### 2. 代码问题

#### 问题 A: `redis.service.ts` 连接超时
- `ioredis` 在连接失败时会不断重试（`retryStrategy`）
- 每次 Redis 操作都会等待连接，导致请求超时
- `get()`, `set()`, `incr()` 等方法没有检查连接状态就尝试操作

#### 问题 B: `enhanced-rate-limiter.service.ts` 
- `checkDimension()` 调用 `redisService.get()` 时会等待 Redis 连接
- `detectIPSpoofing()` 直接调用 `redisService.getClient()` 而没有检查 `isAvailable()`
- 当 Redis 不可用时，这些调用都会阻塞

---

## 修复方案

### 步骤 1: 修改 `redis.service.ts`
添加连接状态跟踪，在 Redis 不可用时立即返回而不等待：
- 添加 `private connectionReady: boolean = false` 状态标志
- 在 `connect` 事件中设置 `connectionReady = true`
- 在 `error`/`close` 事件中设置 `connectionReady = false`
- 修改 `get()`, `set()`, `incr()`, `exists()` 方法，先检查 `connectionReady`

### 步骤 2: 修改 `enhanced-rate-limiter.service.ts`
在调用 Redis 前检查可用性：
- `checkDimension()` 方法先检查 `redisService.isAvailable()`
- `detectIPSpoofing()` 方法先检查 Redis 可用性，不可用时直接返回 `{ suspicious: false }`

### 步骤 3: 撤销临时方案
- 删除 `.env` 中的 `DISABLE_REDIS=true`

### 步骤 4: 验证
- 重启后端服务
- 测试登录功能
- 确认速率限制器在无 Redis 时正常使用内存回退