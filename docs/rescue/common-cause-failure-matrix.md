# 共因故障矩阵（主控制面 vs 救援控制面）

- Date: 2026-07-08
- 关联：PRD §3/§6/§14.1，ADR `2026-07-08-heterogeneous-rescue-control-plane.md`
- 目的：逐维度证明两面故障域分离；标注仍然共享的残余共因，供演练与评审对照。

## 1. 维度矩阵

| 维度 | 主控制面依赖 | 救援控制面依赖 | 共因？ | 说明 |
| --- | --- | --- | --- | --- |
| 运行时 | Node.js V8 + npm 依赖树（数百包） | Rust 静态二进制，6 个直接 crate，无 async runtime | 否 | Node 漏洞/OOM/事件循环阻塞不影响救援面 |
| 前端入口 | React/Vite bundle + 浏览器 | CLI / 内嵌静态页（零外部引用） | 否 | bundle 加载失败、CDN、CSP 问题不波及 |
| 反向代理 | nginx/代理规则、CORS、Cookie | 不经代理，loopback 直连 | 否 | 代理误拦截（PRD §3 列举）不波及 |
| 认证 | JWT + httpOnly cookie + Redis 限流 | 离线 HMAC challenge，本地密钥文件 | 否 | JWT_SECRET 泄露/Redis 故障不影响救援认证 |
| 存储 | SQLite/Postgres + Redis | append-only 文件 + 原子快照 | 否 | schema 迁移失败、连接池耗尽、WAL 损坏不波及 |
| 网络监听 | 业务网段 + WebSocket | 127.0.0.1 / 显式 MGMT | 部分 | 同主机网络栈整体故障仍为共因（见 §2.3） |
| 部署单元 | docker compose / node service | 独立 systemd unit / Windows service + watchdog | 否 | compose 栈崩溃不带走救援 unit |
| 配置来源 | `.env` + runtime-env 校验 | 独立最小 JSON 配置，缺失即 LOCKED | 否 | `.env` 损坏不波及 |
| 日志/审计 | 主审计归档（DB） | 本地 hash-chain 文件 | 否 | DB 写失败期间救援审计仍可追加 |
| AI 管线 | 检测管线可阻塞主流程 | 完全不接触 | 否 | |
| 代码缺陷 | TypeScript 代码库 | 独立 Rust 代码库 | 否 | 同一逻辑 bug 不会同时存在（不同实现） |
| 硬件授权权威 | Gateway Appliance M1–M4 | 同一 Appliance | **是（设计意图）** | 唯一安全权威必须唯一，见 §2.1 |

## 2. 残余共因（显式承认，不遮掩）

### 2.1 Gateway Appliance 本身
两面共享同一硬件权威——这是 PRD §2.2 的设计意图（"共享的唯一安全权威必须落在硬件状态机"），不是缺陷。Appliance 故障的语义是 fail-closed 断桥，不是失控。

### 2.2 宿主机与操作系统
若救援面与主控制面部署在同一台宿主机，内核 panic、磁盘满、电源故障为共因。缓解：救援面支持部署到独立管理机（仅需网络可达 appliance MGMT）；磁盘满属演练项（审计不可写→动作全拒，fail-closed 而非 fail-open）。**部署形态决策（同机 vs 独立管理机）交由 SRE 组，独立管理机为推荐项。**

### 2.3 主机网络栈 / MGMT 物理链路
loopback 几乎不故障，但 MGMT 口监听依赖同一 NIC 驱动/交换机。缓解路径是串口/本机 console 模式（PRD AG-RESCUE-007，transport trait 已预留，未实现，列为缺口）。

### 2.4 供应链
Rust crate 供应链与 npm 树分离，但 serde/sha2 本身仍是第三方代码。缓解：依赖锁定 Cargo.lock、依赖数刻意压到个位数。

### 2.5 人因与密钥管理
provision 流程、runbook、密钥轮换由同一运维团队执行——流程性共因无法用技术消除，靠 runbook 双人复核缓解。

## 3. 与 PRD §12 演练的映射

| 残余共因/分离声明 | 对应演练 |
| --- | --- |
| Node 崩溃不波及 | DRILL-001 |
| Redis 分离 | DRILL-002 |
| 主 DB 分离 | DRILL-003 |
| 代理分离 | DRILL-004 |
| 前端分离 | DRILL-005 |
| AI 管线分离 | DRILL-006 |
| WebSocket 分离 | DRILL-007 |
| 审计防篡改 | SEC-007 |
| 磁盘满/审计不可写 | 新增 DRILL-008（本矩阵引入）：审计目录只读时动作命令必须拒绝 |
