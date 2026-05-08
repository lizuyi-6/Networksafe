# AetherGuard CLI

AetherGuard - 智能服务器安全防御平台的一键安装 CLI 工具。

## 安装

```bash
npm install -g aetherguard-cli
```

## 使用

### 安装 AetherGuard

```bash
# 交互式安装（推荐）
aetherguard install

# 指定参数安装
aetherguard install --dir /opt/aetherguard --port 80 --backend-port 3005
```

### 服务管理

```bash
aetherguard start       # 启动服务
aetherguard stop        # 停止服务
aetherguard restart     # 重启服务
aetherguard status      # 查看运行状态
aetherguard logs -f     # 实时查看日志
```

### 更新与卸载

```bash
aetherguard update      # 更新到最新版本
aetherguard uninstall   # 卸载（会删除所有数据）
```

### Agent 管理

```bash
# 注册 Agent
aetherguard agent -s http://控制面板:3005 -c 注册码

# 查看 Agent 状态
aetherguard agent
```

## 命令列表

| 命令 | 说明 |
|------|------|
| `install` | 一键原生部署（Linux + Nginx + PM2） |
| `start` | 启动后端（PM2）和 Nginx |
| `stop` | 停止所有服务 |
| `restart` | 重启所有服务 |
| `status` | 健康检查和服务状态 |
| `logs` | 查看日志（支持 `--follow`） |
| `update` | 拉取最新代码并重启 |
| `uninstall` | 卸载并清理（双重确认） |
| `agent` | Agent 安装/注册/管理 |

## 系统要求

- Linux (Ubuntu/CentOS/Debian)
- Node.js >= 18
- root 权限

## 开发

```bash
cd installer
npm install
npm run build
npm run dev -- install
```
