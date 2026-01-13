# 🛡️ NewSecurity

**一键部署的安全网关 - 为您的服务器提供企业级安全防护和自动优化**

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Docker](https://img.shields.io/badge/docker-supported-blue.svg)

[功能特性](#功能特性) • [快速开始](#快速开始) • [文档](#文档) • [贡献](#贡献)

</div>

---

## 📖 项目简介

NewSecurity 是一个可一键部署在您服务器上的安全网关，提供：

- ✅ **反向代理** - 自动HTTPS，负载均衡
- ✅ **安全防护** - 反机器人、速率限制、DDoS防护
- ✅ **服务器扫描** - 自动检测安全漏洞和性能问题
- ✅ **智能优化** - 一键应用安全加固和性能优化
- ✅ **实时监控** - 流量、威胁、性能可视化

### 🎯 适用场景

- Web应用安全防护
- API网关
- 反向代理 + SSL终结
- 服务器安全加固
- 性能优化建议

---

## ✨ 功能特性

### 1. 反向代理

```
用户流量 → NewSecurity (80/443) → 您的应用
```

- 自动HTTPS（Let's Encrypt）
- WebSocket支持
- 负载均衡
- HTTP/2支持

### 2. 安全防护

从 `api-security-middleware` 提取的企业级安全功能：

#### 🔒 反机器人保护
- 已知机器人白名单（Google、Bing等）
- 可疑User-Agent检测
- 请求速率分析
- IP自动封禁
- 蜜罐字段支持

#### ⏱️ 速率限制
- 基于Redis的分布式限制
- 滑动时间窗口
- 原子操作防止竞态条件
- 每用户独立限制

#### 🚦 并发控制
- 每用户并发请求数限制
- 请求队列管理
- 自动清理过期请求
- 内存泄漏防护

### 3. 服务器扫描

全方面的服务器安全扫描：

- **端口扫描** - 检测开放端口和服务
- **系统扫描** - 检测系统更新、资源使用
- **Web服务器扫描** - 检测Nginx/Apache配置问题

### 4. 智能优化

自动生成优化建议：

- 🔧 系统参数优化
- 🔐 安全加固
- ⚡ 性能提升
- 📊 资源管理

每个建议都有：
- 优先级（critical/high/medium/low）
- 详细说明
- 自动应用选项
- 风险评估

---

## 🚀 快速开始

### 前置要求

- Docker 20.10+
- Docker Compose 2.0+
- Linux服务器（推荐Ubuntu 20.04+）

### 一键安装（推荐）

```bash
# 下载安装脚本
curl -fsSL https://raw.githubusercontent.com/your-org/NewSecurity/main/scripts/install.sh -o install.sh

# 运行安装
chmod +x install.sh
sudo ./install.sh
```

### 手动安装

```bash
# 1. 克隆项目
git clone https://github.com/your-org/NewSecurity.git
cd NewSecurity

# 2. 配置环境变量
cp .env.example .env
nano .env

# 3. 启动
docker-compose up -d

# 4. 查看日志
docker-compose logs -f
```

### 验证安装

```bash
# 检查健康状态
curl http://localhost/api/health

# 预期输出：
# {"status":"healthy","timestamp":"...","version":"1.0.0"}
```

---

## 📚 使用指南

### 添加网站

```bash
curl -X POST http://localhost/api/sites \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "example.com",
    "target": "http://localhost:3000",
    "sslEnabled": true,
    "security": {
      "antiBot": true,
      "rateLimit": {
        "enabled": true,
        "requestsPerMinute": 60
      },
      "concurrency": {
        "enabled": true,
        "maxConcurrent": 5
      }
    }
  }'
```

### 运行服务器扫描

```bash
curl -X POST http://localhost/api/scanner/run

# 响应示例：
{
  "success": true,
  "data": {
    "systemInfo": {
      "platform": "linux",
      "cpus": 4,
      "totalMemory": "16GB"
    },
    "recommendations": [
      {
        "category": "security",
        "priority": "high",
        "title": "Firewall is Inactive",
        "description": "...",
        "action": "sudo ufw enable",
        "autoApplicable": true,
        "risk": "Server exposed to attacks"
      }
    ],
    "summary": {
      "critical": 1,
      "high": 3,
      "medium": 5,
      "low": 2
    }
  }
}
```

### 应用优化

```bash
curl -X POST http://localhost/api/scanner/apply \
  -H "Content-Type: application/json" \
  -d '{
    "recommendation": {
      "title": "Firewall is Inactive",
      "action": "sudo ufw enable",
      "autoApplicable": true
    }
  }'
```

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────┐
│           NewSecurity Gateway               │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────────┐    ┌─────────────────┐  │
│  │ HTTP/HTTPS   │───>│  Security Layer  │  │
│  │    Server    │    │                 │  │
│  └──────────────┘    │ - Anti-Bot      │  │
│                      │ - Rate Limit    │  │
│  ┌──────────────┐    │ - Concurrency   │  │
│  │ Proxy Engine │───>│                 │  │
│  └──────────────┘    └─────────────────┘  │
│           │                                │
│           v                                │
│  ┌──────────────┐                         │
│  │ Your Backend │                         │
│  └──────────────┘                         │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│          Scanner & Optimizer               │
├─────────────────────────────────────────────┤
│  - Port Scanner                             │
│  - System Scanner                           │
│  - Web Server Scanner                       │
│  - Optimization Engine                      │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│            Data Layer                       │
├─────────────────────────────────────────────┤
│  - SQLite (Config)                          │
│  - Redis (Session & Rate Limit)            │
└─────────────────────────────────────────────┘
```

---

## 📊 API 文档

### 网站管理

- `GET /api/sites` - 获取所有网站
- `POST /api/sites` - 添加新网站
- `PUT /api/sites/:id` - 更新网站配置
- `DELETE /api/sites/:id` - 删除网站

### 扫描和优化

- `POST /api/scanner/run` - 运行服务器扫描
- `GET /api/scanner/results/:id` - 获取扫描结果
- `POST /api/scanner/apply` - 应用优化建议
- `GET /api/scanner/report/:id` - 生成扫描报告

### 监控

- `GET /api/monitoring/metrics` - 获取监控指标
- `GET /api/monitoring/logs` - 获取安全日志

完整API文档：[API.md](docs/API.md)

---

## 🔧 配置

### 环境变量

```bash
# 服务器配置
NODE_ENV=production
HTTP_PORT=80
HTTPS_PORT=443

# Redis配置
REDIS_URL=redis://redis:6379

# SSL配置
SSL_EMAIL=admin@example.com

# 数据目录
DATA_DIR=/app/data
CERTS_DIR=/app/certs
```

### 安全规则

每个网站可以独立配置：

```json
{
  "security": {
    "antiBot": true,
    "rateLimit": {
      "enabled": true,
      "requestsPerMinute": 60
    },
    "concurrency": {
      "enabled": true,
      "maxConcurrent": 5
    }
  }
}
```

---

## 🐳 Docker 部署

### 基础部署

```bash
docker-compose up -d
```

### 自定义端口

```yaml
# docker-compose.yml
services:
  newsecurity:
    ports:
      - "8080:80"    # HTTP
      - "8443:443"   # HTTPS
```

### 持久化数据

```yaml
volumes:
  - ./data:/app/data
  - ./certs:/app/certs
  - ./logs:/app/logs
```

---

## 📈 监控和日志

### 查看日志

```bash
# 所有日志
docker-compose logs -f

# 只看NewSecurity
docker-compose logs -f newsecurity

# 查看最近100行
docker-compose logs --tail=100 newsecurity
```

### 日志位置

- 应用日志：`./logs/newsecurity.log`
- 访问日志：`./logs/access.log`
- 错误日志：`./logs/error.log`

---

## 🛠️ 开发

### 本地开发

```bash
# 后端
cd backend
npm install
npm run dev

# 前端
cd frontend
npm install
npm start
```

### 构建生产镜像

```bash
docker build -t newsecurity:latest -f docker/Dockerfile .
```

### 运行测试

```bash
npm test
```

---

## 🤝 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md)

---

## 📝 更新日志

### v1.0.0 (2026-01-13)

- ✨ 初始版本发布
- ✅ 反向代理功能
- ✅ 安全中间件集成
- ✅ 服务器扫描
- ✅ 优化建议引擎
- ✅ Docker一键部署

---

## ❓ 常见问题

### Q: 如何添加HTTPS？

A: NewSecurity会自动为您的域名申请Let's Encrypt证书。只需确保域名DNS指向您的服务器。

### Q: 扫描会影响服务器性能吗？

A: 扫描是轻量级的，但建议在低峰期运行完整扫描。

### Q: 可以自动应用所有优化吗？

A: 只会自动应用标记为 `autoApplicable: true` 的优化。其他优化需要手动操作。

### Q: 支持哪些Linux发行版？

A: 支持所有主流发行版：Ubuntu、Debian、CentOS、RHEL等。

---

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)

---

## 🙏 致谢

本项目基于以下优秀项目：

- [api-security-middleware](https://github.com/your-org/api-security-middleware) - 安全中间件
- [http-proxy-middleware](http://github.com/chimurai/http-proxy-middleware) - HTTP代理
- [greenlock-express](https://github.com/mozilla-greenlock/greenlock-express) - Let's Encrypt集成

---

## 📞 支持

- 📖 文档：[docs/](docs/)
- 🐛 问题反馈：[GitHub Issues](https://github.com/your-org/NewSecurity/issues)
- 💬 讨论：[GitHub Discussions](https://github.com/your-org/NewSecurity/discussions)

---

<div align="center">

**Made with ❤️ for secure and optimized servers**

[⭐ Star](../../stargazers) | [🍴 Fork](../../network/members) | [📖 Documentation](docs/)

</div>
