# 依赖漏洞审计 - 2026-06-06

**Sprint**: 5 · R10 (依赖漏洞审计)
**审查员**: 白盒安全审计员 (只读)
**审查范围**: `backend/package-lock.json` (10 151 行) + `frontend/package-lock.json` (4 028 行)

## 摘要

| 项目 | 直接 deps | 传递 deps | 总 entries | 唯一 host |
|---|---|---|---|---|
| backend | 22 prod + 23 dev | 727 (含可选) | 772 | `https://registry.npmjs.org` (100%) |
| frontend | 13 prod + 13 dev | 308 (含可选) | 334 | `https://registry.npmjs.org` (100%) |

| 项目 | HIGH | MODERATE | LOW | TOTAL |
|---|---|---|---|---|
| **backend** (`--omit=dev` 受影响) | **2** (7 个 cluster 包含) | **7** | 0 | **9** |
| **backend** (含 dev) | **8** | **7** | 0 | **15** |
| **frontend** (`--omit=dev` 受影响) | **0** | **4** | 0 | **4** |
| **frontend** (含 dev) | **0** | **7** | 0 | **7** |

- 锁文件**没有**发现非 `registry.npmjs.org` 的 `resolved` URL。
- 772 / 334 条 entry 全部带 `integrity` (sha512) — 锁文件**没有**被替换 / 注入。
- 发现 **5** 个生产路径包执行 `postinstall` / `preinstall` 钩子 (见 § 3)。
- **15** 个 npm 直接声明的 `deprecated` 包, 其中 4 个落入生产路径 (`tar`, `glob`, `rimraf`, `inflight`, `prebuild-install`)。
- 1 个 prod 直接依赖 **没有 `license` 字段**: `ssh2@1.17.0` (npm registry 标为 `Proprietary`, 但 `licenses` 字段仍为 MIT — 见 § 4)。

---

## 1. `npm audit` 全部结果 (含 dev)

### 1.1 backend (15 条 = 8 high + 7 moderate)

#### HIGH (8)
| 名称 | 直接? | 当前版本 | 修复版本 | CVE / Advisory | 受影响范围 |
|---|---|---|---|---|---|
| `tar` | ❌ (transitive) | **6.2.1** (deprecation: "widely publicized security vulnerabilities") | 7.5.11+ | GHSA-34x7-hfp2-rc4v, GHSA-8qq5-rm4j-mr97, GHSA-83g3-92jg-28cx, GHSA-qffp-2rhf-9h96, GHSA-9ppj-qmqm-q256, GHSA-r6q2-hw4h-h46w | **生产** — 由 `@mapbox/node-pre-gyp` 带入 (→ `bcrypt` 5.1.1 + `better-sqlite3` 11.10.0) |
| `@mapbox/node-pre-gyp` | ❌ (transitive) | `<=1.0.11` | upgrade required | 上述 `tar` 依赖 | **生产** — 由 `bcrypt`, `better-sqlite3` 带入 |
| `minimatch` | ❌ (transitive) | **9.0.3** | 9.0.7+ (含 10.x) | GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74 (ReDoS) | **dev only** — 经由 `@typescript-eslint/typescript-estree` 6.x / `@eslint/eslintrc` / `glob` / `@humanwhocodes/config-array` 带入 |
| `@typescript-eslint/eslint-plugin` | ✅ (devDep) | **6.20.0** | 8.60.1 (semver-major) | minimatch ReDoS 链 | **dev only** — 直接 devDep |
| `@typescript-eslint/parser` | ✅ (devDep) | **6.20.0** | 8.60.1 (semver-major) | minimatch ReDoS 链 | **dev only** — 直接 devDep |
| `@typescript-eslint/type-utils` | ❌ (transitive dev) | 6.x | 8.60.1 (semver-major) | minimatch ReDoS 链 | **dev only** |
| `@typescript-eslint/typescript-estree` | ❌ (transitive dev) | 6.x | 8.60.1 (semver-major) | minimatch ReDoS 链 | **dev only** |
| `@typescript-eslint/utils` | ❌ (transitive dev) | 6.x | 8.60.1 (semver-major) | minimatch ReDoS 链 | **dev only** |

#### MODERATE (7)
| 名称 | 直接? | 当前版本 | 修复版本 | Advisory | 受影响范围 |
|---|---|---|---|---|---|
| `qs` | ❌ (transitive) | **6.14.2 / 6.15.1** | 6.15.2+ | GHSA-q8mj-m7cp-5q26 (DoS) | **生产** — 由 `express@4.22.1` + `body-parser` 带入 |
| `ws` | ✅ (直接 prodDep) | **8.20.0** | 8.18.3+ 没有补丁, 必须升级到 8.18.4+ (但 8.18.3 也被锁), 推荐直接 `npm i ws@latest` | GHSA-58qx-3vcg-4xpx (memory disclosure) | **生产** — 还出现在 `engine.io-client`, `engine.io`, `socket.io-adapter` |
| `engine.io` | ❌ (transitive) | 6.6.7 | needs upgrade | ws 链 | **生产** — `socket.io` 带入 |
| `engine.io-client` | ❌ (transitive) | 6.6.4 | needs upgrade | ws 链 | **生产** — `socket.io-client` 带入 |
| `socket.io-adapter` | ❌ (transitive) | < latest | upgrade | ws 链 | **生产** |
| `express` | ✅ (直接 prodDep) | 4.22.1 | 4.22.2+ | qs 链 | **生产** |
| `uuid` | ✅ (直接 prodDep) | 9.0.1 (且 deprecation: "uuid@10 and below is no longer supported") | 11.1.1+ (semver-major) | GHSA-w5hq-g745-h8pq | **生产** |

> 注: 当 `--omit=dev` 时, minimatch 6 个 dev chain 全部消失, backend `npm audit` 简化为 9 条 (2 high + 7 moderate)。两个高 = `tar` + `@mapbox/node-pre-gyp` 同一 chain。

### 1.2 frontend (7 条 = 0 high + 7 moderate, 全部 dev/可选)

#### MODERATE (7)
| 名称 | 直接? | 当前版本 | 修复版本 | Advisory | 受影响范围 |
|---|---|---|---|---|---|
| `ws` | ❌ (transitive) | **8.18.3** | 8.18.4+ | GHSA-58qx-3vcg-4xpx | **生产** — `engine.io-client` 带入 (前端的 `socket.io-client`) |
| `engine.io-client` | ❌ (transitive) | 6.6.4 | upgrade | ws 链 | **生产** |
| `react-router` | ❌ (transitive) | 6.30.3 | 7.x (semver-major) | GHSA-2j2x-hqr9-3h42 (open redirect) | **生产** — `react-router-dom` 带入 |
| `react-router-dom` | ✅ (直接 prodDep) | **6.30.3** | 7.x (semver-major) | 链上 | **生产** |
| `vite` | ✅ (devDep) | 5.4.21 | 6.4.2+ (semver-major) | esbuild 链 | **dev only** |
| `esbuild` | ❌ (devDep transitive) | 0.21.5 | 0.25.x (semver-major) | GHSA-67mh-4wv8-2f99 | **dev only** — vite 带入 |
| `brace-expansion` | ❌ (transitive) | 5.0.5 | 5.0.6+ | GHSA-jxxr-4gwj-5jf2 (DoS) | **dev only** — `minimatch@10` 带入 |

> 当 `--omit=dev` 时, frontend 仅剩 4 条 moderate (ws/engine.io-client/react-router/react-router-dom) — **0 high**。

---

## 2. 重点 CVE (按风险排序)

| 排名 | 包 | 当前 | 风险等级 | 触发条件 | 修复 |
|---|---|---|---|---|---|
| **#1** | `tar@6.2.1` (prod path via `bcrypt`, `better-sqlite3`) | 6.2.1 | **HIGH** + 维护者明确 deprecation 消息 | 任何 install 时刻; 受 `npm ci` 攻击面影响, 同时**链**是 `bcrypt` / `better-sqlite3` postinstall → `@mapbox/node-pre-gyp` → `tar` 解包 native binary | 把 `bcrypt` 升到 5.1.1+ 后的下一个 breaking 版本 (社区建议换 `bcryptjs` 或 `@node-rs/bcrypt`), `better-sqlite3` 同样需升级到最新 patched series |
| **#2** | `ws@8.20.0` (direct prodDep + 3 transitive copies) | 8.20.0 | MODERATE (实质 uninitialized memory disclosure, CVSS 7.5) | 长连接握手时 server 发送特定大小响应 | 升到 `ws@8.18.4+` (注意: 8.18.3 仍被 `engine.io-client` 锁, 需在 socket.io 仓库等上游修) |
| **#3** | `qs@6.14.2` + `qs@6.15.1` (transitive via `express`, `body-parser`) | 6.15.1 | MODERATE (DoS via `qs.stringify` 在特定 `encodeValuesOnly` + null/undefined 数组下崩溃) | 当前 backend 用 `qs.parse` 而非 `qs.stringify`, **实际触发面较窄**, 但 express 内部 middleware 链仍会调用 stringify (e.g. `res.redirect` querystring 构造) | 升 `express` 到 4.22.2+ 或 5.x |
| **#4** | `uuid@9.0.1` (direct prodDep) | 9.0.1 | MODERATE + 维护者明确 deprecation | 当调用者传入 `buf` 数组 + `v3/v5/v6` 时可能缺边界检查 | 升到 `uuid@11.1.1+` (breaking) |
| **#5** | `react-router-dom@6.30.3` (direct prodDep, frontend) | 6.30.3 | MODERATE (open redirect via `//` 协议相对重写) | 当应用自身调用 `<Navigate to="//evil.com">` 或 `useNavigate()("//evil.com")` | 升 `react-router-dom` 到 7.x (semver-major) |

---

## 3. 锁文件问题 (Supply chain surface)

### 3.1 ✅ `resolved` URL 检查
- backend 772 条 + frontend 334 条, 唯一 host = `https://registry.npmjs.org`。**无篡改注入**。

### 3.2 ✅ `integrity` 检查
- 100% 覆盖 sha512。**无篡改注入**。

### 3.3 ⚠️ `hasInstallScript: true` (install 钩子 — 攻击者重点目标)
| 位置 | 包 | 在 prod 路径? | 风险 |
|---|---|---|---|
| `backend/package-lock.json:3996` | `bcrypt@5.1.1` | ✅ **PROD** | 编译 native code, 拉 `@mapbox/node-pre-gyp@1.0.11` 拉 `tar@6.2.1` |
| `backend/package-lock.json:4019` | `better-sqlite3@11.10.0` | ✅ **PROD** | 同上 |
| `backend/package-lock.json:4651` | `cpu-features@0.0.10` (ssh2 可选依赖) | ✅ PROD (opt) | 编译 native code |
| `backend/package-lock.json:5854` | `fsevents@2.3.3` | ❌ dev + darwin only | macOS 监视 |
| `backend/package-lock.json:9142` | `ssh2@1.17.0` | ✅ **PROD** | 编译 native code (optional) |
| `frontend/package-lock.json:2146` | `esbuild@0.21.5` | ❌ dev | 编译 binary 下载 |
| `frontend/package-lock.json:2514` | `@parcel/watcher` | ❌ dev optional | native watcher |
| `frontend/package-lock.json:3082` | `playwright` (chromium 安装) | ❌ dev | **拉 Chromium 二进制**, 攻击面最大 |

> backend 中 5 个 prod-path 钩子 = `bcrypt`, `better-sqlite3`, `ssh2`, `cpu-features` (含 deprecation chain tar 6.2.1)。

### 3.4 ⚠️ `deprecated` 字段 (npm 维护者主动放弃)
backend 共 15 个, 其中 **生产路径** 命中 5 个:
| 包 | 版本 | deprecation 消息 |
|---|---|---|
| `tar` | 6.2.1 | "Old versions of tar are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update." |
| `glob` | 7.2.3 | "Old versions of glob are not supported, and contain widely publicized security vulnerabilities." |
| `inflight` | 1.0.6 | "This module is not supported, and leaks memory. Do not use it." |
| `rimraf` | 3.0.2 | "Rimraf versions prior to v4 are no longer supported" |
| `prebuild-install` | 7.1.3 | "No longer maintained. Please contact the author of the relevant native addon" |
| `uuid` | 9.0.1 | "uuid@10 and below is no longer supported." (直接 prodDep!) |
| `@humanwhocodes/config-array` | 0.13.0 | "Use @eslint/config-array instead" (dev) |
| `@humanwhocodes/object-schema` | 2.0.3 | dev |
| `eslint` | 8.57.1 | "This version is no longer supported." (dev) |
| `superagent` | 8.1.2 | "Please upgrade to superagent v10.2.2+" (dev via supertest) |
| `supertest` | 6.3.4 | "Please upgrade to supertest v7.1.3+" (dev) |
| 其他 dev-only deprecation 略 |

frontend 共 0 个 `deprecated` 字段 (说明前端包的健康度反而更好)。

---

## 4. License 合规

### 4.1 backend lockfile 中的 license 字段
唯一 license 值: `MIT`, `ISC`, `0BSD`, `MIT-0`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `CC-BY-4.0`, `Python-2.0`, `Unlicense`, `(MIT OR CC0-1.0)`, `(MIT OR WTFPL)`, `(BSD-2-Clause OR MIT OR Apache-2.0)`, `BlueOak-1.0.0` (仅 frontend)。

**无 GPL / AGPL / LGPL**。
**无 UNKNOWN / UNLICENSED** (lockfile 中以 `license: ""` 出现 5 次, 单独列出)。

### 4.2 缺失 `license` 字段的 prod 路径包 (5 个)
| 包 | 版本 | 实际 license (npm registry 查询) | 风险 |
|---|---|---|---|
| `ssh2` | 1.17.0 | `Proprietary` (lockfile 看不到), `licenses: [{type: MIT}]` (legacy 字段) | **高 — npm 仪表板已改成 Proprietary, 长期法律风险**, 但 MIT 仍然有效 |
| `buildcheck` | 0.0.7 | Apache-2.0 | 中 — cpu-features 间接 |
| `cpu-features` | 0.0.10 | MIT | 中 — ssh2 可选 |
| `exit` | 0.1.2 | MIT | 低 — jest 创建脚本间接 |
| `xmlhttprequest-ssl` | 2.1.2 | MIT | 低 — engine.io-client 间接 |

frontend 缺失 license: `xmlhttprequest-ssl@2.1.2` (同上)。

### 4.3 法律风险结论
- **没有 GPL/AGPL 污染商业代码**。
- **建议立刻咨询法务**: `ssh2@1.17.0` 在 npm registry `license` 字段已被改为 `Proprietary` (虽然 legacy `licenses` 仍为 MIT)。**该包是 AetherGuard 远程 SSH 管控能力的关键依赖** (`ssh2` 是 final-defense / deployment 路径)。
- 其余缺失 license 字段的包都是 mirror-style 旧 metadata, 实际 license 在 npm 仓库中可查, 不构成实际法律风险。

---

## 5. Dev vs Production 依赖错位

### 5.1 误装到 `dependencies` 的 dev-only 包
| 包 | 当前位置 | 应在 | 理由 |
|---|---|---|---|
| **`@types/nodemailer` ^7.0.11** | `backend/dependencies` | `devDependencies` | 类型声明, 编译后不需要, 也不应在生产 install 时被 fetch |

### 5.2 应移到 dev 的 prod 包
无。所有当前 `dependencies` 都是 runtime 必需。

### 5.3 数量对比
- backend: 22 prod + 23 dev (合理, 接近 1:1; dev 多是因为大量 `@types/*` + 多个 eslint 插件)。
- frontend: 13 prod + 13 dev (合理, 1:1)。

---

## 6. 优化建议 (按优先级)

### 6.1 🔴 P0 — 立即修
1. **`bcrypt` + `better-sqlite3` 升级或替换**: 解决 `tar@6.2.1` 链。这两个都是 native addon, 升级涉及 ABI 兼容, 需在 Linux x86_64 / aarch64 / Windows 三个目标验证。
2. **`uuid@9.0.1` → 11.1.1+** (breaking, 直接 prodDep)。**同时**是 deprecated 状态, 升级顺带解决 deprecation 警告。
3. **`ws@8.20.0` → 最新 8.x (或 socket.io 升级到 4.8.x 后的下游同步修复)**。前端的 `engine.io-client@6.6.4` 同样受影响, 需 socket.io-client 升级驱动。

### 6.2 🟡 P1 — 本周修
4. **`@types/nodemailer` 移回 devDependencies**, 重新 `npm install --omit=dev` 验证。
5. **`@typescript-eslint/*` 6.20.0 → 8.60.1+** (semver-major). 该项目 backend dev 工具链整体升级, 配套 `eslint@^8.56.0` 升 9.x 或保留兼容模式。
6. **`express@4.22.1` → 4.22.2+** (或迁移到 5.x). 解决 `qs` 6.15.1 DoS。
7. **`react-router-dom@6.30.3` → 7.x** (semver-major, frontend). 解决 open redirect。
8. **移除 `inflight@1.0.6` 链**: 跟随 `glob@7.2.3` 升级或 `rimraf@3.0.2` 升级, 让 glob 自然 evict。

### 6.3 🟢 P2 — 长期
9. **考虑用 `bcryptjs` 或 `@node-rs/bcrypt` 替代 `bcrypt`**, 消除 native build 钩子, 减少 supply chain 攻击面。
10. **CI 阶段加 `npm audit --omit=dev --audit-level=high` 阻断门禁**, 防止新漏洞悄悄引入。
11. **Lockfile 锁源**: 在 `.npmrc` 加 `registry=https://registry.npmjs.org/` 强制 (当前 .env.example 中无 registry 锁定配置, 需确认 CI 不走 mirror)。
12. **考虑 npm `provenance` 验证**: backend `package-lock.json` 中已可看到 `resolved` 指向 tarball 路径, 但缺少 npm 8.2+ 的 `signatures` 字段; 升级到 npm 9+ 可获得内嵌签名, 防止 tarball 替换攻击。

---

## 7. 结论

| 指标 | 结论 |
|---|---|
| **生产路径高危** | **2 个 cluster (实际 2 个独立 CVE chain)**: `tar@6.2.1` (HIGH, deprecated) + `ws@8.20.0` (MODERATE) |
| **生产路径中危** | 7 条 (qs, ws 链, uuid) |
| **dev-only 高危** | 6 条 (minimatch 链) |
| **锁文件篡改** | **未发现** — 100% 走 `registry.npmjs.org`, 100% 带 sha512 integrity |
| **install 钩子** | backend 5 个 prod-path 包 (bcrypt / better-sqlite3 / ssh2 / cpu-features) |
| **deprecated 包** | backend 15 个 (5 个落入 prod 路径) |
| **License** | **无 GPL/AGPL 污染**; 1 个 prod 直接依赖 (`ssh2`) 缺 license 字段, 需法务确认 |
| **dev/prod 错位** | 1 个 (`@types/nodemailer` 误装 prod) |
| **总评** | **backend 有 1 个 P0 chain 必须立即修 (bcrypt+tar)**, 其余可在下个 sprint 处理。**frontend 干净** (0 high), 只需升级 `react-router-dom` 和 `socket.io-client`。 |

---

## 8. 审计方法学

- `npm audit --omit=dev --audit-level=high` (只读) — backend + frontend 各跑一次。
- `npm audit --json` 解析 — 列出所有 CVE chain、严重度、修复版本。
- `node -e` + 解析 `package-lock.json` 列出:
  - 总 entry 数 / 唯一 host / integrity 覆盖率
  - `hasInstallScript: true` 列表
  - `deprecated` 字段列表
  - `license` 字段缺失列表
  - 直接 deps 数量 (prod / dev)
- `npm view <pkg>` 现场查询 npm registry, 确认缺失 license 字段的实际 license。
- **未执行**: `npm install`, `npm update`, `npm audit fix`, 任何写入操作。

## 9. 关键文件 (Read 列表)

- `X:\repos\Networksafe\backend\package.json`
- `X:\repos\Networksafe\backend\package-lock.json` (10 151 行, 取 3990-4025, 4640-4670, 5845-5870, 9130-9155 行片段)
- `X:\repos\Networksafe\frontend\package.json`
- `X:\repos\Networksafe\frontend\package-lock.json`
- `X:\repos\Networksafe\docs\security-audit\2026-06-05-websocket.md` (格式参考)
