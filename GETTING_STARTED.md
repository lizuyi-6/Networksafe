# 🚀 项目启动指南

## 欢迎使用 API Security Middleware！

这是一个全新的独立项目，提供完整的网络安全防护中间件套件。

---

## 📋 前置要求

- **Node.js** >= 16.0.0
- **Redis** 服务（用于分布式功能）
- **npm** 或 **yarn**

---

## ⚡ 快速开始

### 1️⃣ 安装依赖

```bash
# 进入项目目录
cd C:\Users\Abraham\Desktop\api-security-middleware

# 安装依赖
npm install
```

### 2️⃣ 构建项目

```bash
# 编译TypeScript代码
npm run build

# 或使用开发模式（监听文件变化）
npm run dev
```

### 3️⃣ 在您的项目中使用

#### 方式A：本地导入

```typescript
// 在您的Express项目中
import { antiBotMiddleware, rateLimitMiddleware } from '../api-security-middleware/src';

const app = express();
app.use(antiBotMiddleware.protect);
app.use(rateLimitMiddleware);
```

#### 方式B：链接到本地（开发推荐）

```bash
# 在api-security-middleware目录中
npm link

# 在您的目标项目中
npm link api-security-middleware

# 然后使用
import { antiBotMiddleware } from 'api-security-middleware';
```

#### 方式C：发布到npm（生产推荐）

```bash
# 构建并发布
npm run build
npm publish

# 在其他项目中安装
npm install api-security-middleware
```

---

## 📚 学习资源

### 📖 必读文档

1. **README.md** - 完整的使用文档
   - 功能介绍
   - 安装指南
   - API文档
   - 配置说明

2. **QUICK_START.md** - 快速参考指南
   - 5分钟上手
   - 常用示例
   - 故障排除

3. **CHANGELOG.md** - 版本更新日志
   - 功能历史
   - 版本变更

### 💡 示例代码

查看 `examples/` 目录：

```bash
# 查看示例
cat examples/basic-usage.ts
```

---

## 🧪 测试设置

### 环境变量配置

创建 `.env` 文件：

```bash
# Redis连接（必需）
REDIS_URL=redis://localhost:6379

# 运行环境
NODE_ENV=development
```

### 启动Redis

```bash
# Windows (如果使用Docker)
docker run -d -p 6379:6379 redis:7-alpine

# 或使用本地Redis
redis-server
```

---

## 🎯 核心功能速查

### 1. 反机器人保护

```typescript
import { antiBotMiddleware } from 'api-security-middleware';

app.use(antiBotMiddleware.protect);
```

**功能：**
- ✅ 检测和阻止恶意机器人
- ✅ 速率限制
- ✅ IP封禁
- ✅ 蜜罐字段支持

### 2. 速率限制

```typescript
import { rateLimitMiddleware } from 'api-security-middleware';

app.use(rateLimitMiddleware);
```

**功能：**
- ✅ 分布式速率限制
- ✅ 每用户独立限制
- ✅ Redis支持

### 3. 并发控制

```typescript
import { concurrencyLimit } from 'api-security-middleware';

app.use(concurrencyLimit);
```

**功能：**
- ✅ 防止资源耗尽
- ✅ 请求队列管理
- ✅ 自动清理

### 4. 认证安全

```typescript
import { authSecurityService } from 'api-security-middleware';

// 密码验证
const check = authSecurityService.validatePassword(password);

// 登录保护
await authSecurityService.recordLoginAttempt(email, ip, success);

// 账户锁定
const isLocked = await authSecurityService.isAccountLocked(email);
```

**功能：**
- ✅ 密码强度验证
- ✅ 登录尝试追踪
- ✅ 账户自动锁定
- ✅ 暴力破解防护

---

## 🛠️ 开发命令

```bash
# 构建项目
npm run build

# 监听模式
npm run dev

# 代码检查
npm run lint

# 代码格式化
npm run format

# 清理构建文件
npm run clean
```

---

## 📝 项目结构

```
api-security-middleware/
├── src/                    # 源代码
│   ├── middleware/         # 中间件
│   │   ├── anti-bot.middleware.ts
│   │   ├── concurrency.middleware.ts
│   │   └── ratelimit.middleware.ts
│   ├── services/           # 服务
│   │   ├── auth-security.service.ts
│   │   └── redis.service.ts
│   ├── utils/              # 工具
│   │   └── logger.ts
│   ├── config.ts           # 配置
│   ├── types.ts            # 类型
│   └── index.ts            # 入口
├── examples/               # 示例
├── dist/                   # 构建输出（自动生成）
├── node_modules/           # 依赖（自动生成）
├── README.md              # 主文档
├── QUICK_START.md         # 快速指南
├── CHANGELOG.md           # 更新日志
├── package.json
├── tsconfig.json
└── LICENSE
```

---

## 🎨 下一步

### 1. 自定义配置

编辑 `src/config.ts` 来调整默认值：

```typescript
export const defaultConfig: SecurityConfig = {
  rateLimit: {
    requestsPerMinute: 120,  // 修改速率限制
  },
  // ... 其他配置
};
```

### 2. 添加新功能

在 `src/middleware/` 或 `src/services/` 中创建新文件，然后在 `src/index.ts` 中导出。

### 3. 编写测试

创建 `tests/` 目录并添加测试用例。

### 4. 发布到GitHub

```bash
# 初始化Git仓库（已完成）
git init

# 添加所有文件
git add .

# 创建第一次提交
git commit -m "Initial commit: API Security Middleware Suite"

# 添加远程仓库
git remote add origin https://github.com/yourusername/api-security-middleware.git

# 推送到GitHub
git push -u origin main
```

### 5. 发布到npm

```bash
# 登录npm
npm login

# 发布
npm publish
```

---

## 🐛 常见问题

### Q: 编译出错 "Cannot find module"

**A:** 运行 `npm install` 安装所有依赖。

### Q: Redis连接失败

**A:** 确保Redis服务正在运行：
```bash
docker ps | grep redis
# 或
redis-cli ping
```

### Q: 类型错误

**A:** 确保 `tsconfig.json` 配置正确，运行 `npm run build` 重新编译。

---

## 📞 获取帮助

- 📖 查看 [README.md](./README.md) 获取完整文档
- 📝 查看 [QUICK_START.md](./QUICK_START.md) 快速参考
- 💬 提交 [Issue](https://github.com/yourusername/api-security-middleware/issues)

---

## ✨ 开始构建吧！

现在您已经有了一个完整的项目基础。祝您开发顺利！🎉

---

**提示:** 别忘了先运行 `npm install` 安装依赖！
