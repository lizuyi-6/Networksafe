# AetherGuard 离线(air-gapped)分发与安装

面向**无外网、甚至无 Docker/Node 依赖**的客户环境:在一台有网的构建机上产出自包含分发包,拷贝(U 盘/内网共享)到客户机后零网络安装。

```
构建机(在线,一次)                      客户机(离线,每台)
─────────────────────                  ─────────────────────
node scripts/release/                  tar -xzf aetherguard-offline-*.tar.gz
     build-offline-bundle.mjs    ──►   sudo bash install.sh
     [--include-docker]                (校验 → 装 Docker(如捆绑) → load 镜像
                                        → 生成密钥 .env → up --no-build → 健康等待)
```

## 分发包内容

| 文件 | 作用 |
| --- | --- |
| `images/images.tar` | `docker save` 的全部 7 个镜像(backend/frontend/fastpath + redis/postgres/minio/mc),客户机 `docker load` 即可,不访问任何 registry |
| `docker-compose.yml` + `docker-compose.offline.yml` | 原栈定义 + 固定镜像标签 override(`aetherguard/*:<版本>`),客户机侧 `up -d --no-build` 永不构建、永不拉取 |
| `.env.example` | 配置模板;安装器离线生成全部密钥 |
| `install.sh` | 客户机安装器(见下) |
| `manifest.json` | 版本、镜像清单、构建机架构、是否含 Docker 载荷 |
| `SHA256SUMS` | 逐文件完整性清单,安装器强制校验(`--skip-verify` 可跳过但会显式警告) |
| `docker/`(可选) | `--include-docker` 时:Docker 静态引擎 tgz + Compose v2 插件二进制,供无 Docker 客户机现场安装 |

## 构建机要求与命令

- 在线;Docker Engine + Compose v2.24+;Node.js 20+;git;磁盘 ≳10 GB(镜像 + tar)
- **镜像架构 = 构建机 Docker 架构**(x86_64 构建机产 x86_64 包;跨架构需 buildx,v1 不支持——给 ARM 客户机需在 ARM 构建机上打包)

```bash
# 标准包(客户机需预装 Docker + Compose v2.24+)
node scripts/release/build-offline-bundle.mjs

# 全自包含包(客户机连 Docker 都没有)
node scripts/release/build-offline-bundle.mjs --include-docker

# 常用旗标
#   --version v1.2.3          镜像标签/包名(默认 <日期>-<git describe>)
#   --docker-version 29.4.3   捆绑的 Docker 静态引擎版本
#   --compose-version 5.1.3   捆绑的 Compose 插件版本
#   --arch x86_64|aarch64     仅决定下载哪个架构的 Docker 静态二进制
#   --skip-pull               跳过第三方基础镜像 pull(用本地缓存)
#   --keep-staging            保留 staging 目录便于检查
```

产物:`dist/offline/aetherguard-offline-<版本>-<架构>.tar.gz`(+ 同名 `.sha256`)。`dist/` 已被 .gitignore 排除,产物不入库。

## 客户机要求(两档)

| | 客户机已有 Docker | 客户机零依赖 |
| --- | --- | --- |
| 分发包 | 标准包即可 | 必须 `--include-docker` |
| 硬性要求 | Docker Engine 任意近代版本 + **Compose v2.24+**(compose 文件用 env_file long syntax,v1 二进制/旧 v2 解析不了) | Linux x86_64(或与包一致的架构)、内核支持容器(≥3.10,cgroups)、root、systemd(无 systemd 时安装器以 nohup 起 dockerd 并警告不随机自启) |
| 其他 | bash + coreutils(sha256sum/od/sed);openssl 可选(无则回退 `/dev/urandom` 生成密钥) | 同左 |

## 客户机安装

```bash
mkdir -p /opt/aetherguard
tar -xzf aetherguard-offline-<版本>-<架构>.tar.gz -C /opt/aetherguard
cd /opt/aetherguard
sha256sum -c aetherguard-offline-<版本>-<架构>.tar.gz.sha256   # 可选:先验整包
sudo bash install.sh                                           # 内部还会逐文件验 SHA256SUMS

# 运维台在另一台机器上访问控制台时,预先放行其来源:
sudo bash install.sh --origin http://<运维台IP>:8080
```

安装器输出一次性生成的 `ADMIN_PASSWORD`(也写入 `.env`,首登后修改)。幂等:重复执行不覆盖已有 `.env`,`up -d` 只做调和。

日常运维(均在 bundle 目录执行):

```bash
docker compose -f docker-compose.yml -f docker-compose.offline.yml logs -f     # 日志
docker compose -f docker-compose.yml -f docker-compose.offline.yml down        # 停止(数据保留在命名卷)
docker compose -f docker-compose.yml -f docker-compose.offline.yml down -v     # 停止并清空全部数据(危险)
```

## 升级(同样离线)

1. 构建机打新包(新 `--version`),校验后传输;
2. 客户机解包到新目录(或覆盖 bundle 目录的 `images/` 与 compose 文件),`docker load -i images/images.tar`;
3. 改 `.env` 里的 `AETHERGUARD_VERSION=<新版本>`;
4. `docker compose -f docker-compose.yml -f docker-compose.offline.yml up -d --no-build`。
   命名卷(postgres/redis/minio/backend 数据)跨版本保留;回滚 = 把 `AETHERGUARD_VERSION` 改回旧标签再 `up -d`(旧镜像仍在本地)。

## 离线环境的已知限制(如实告知客户)

- **云 AI 升级链路降级**:`PLATFORM_API_KEY` 无法出网,后端以降级态启动(启动日志有对应 warning);规则/启发式检测管线不受影响。若客户内网有 OpenAI 兼容推理服务,可在 `.env` 配 `PLATFORM_API_BASE_URL` 指向内网端点。
- **时钟**:无 NTP 时审计时间戳依赖主机时钟;grant 过期校验(`expires_at`)同样依赖时钟,部署前校准。
- **TLS**:包内前端为 HTTP(LAN 假设);需要 HTTPS 时由客户现有反向代理/网关终结。
- **主机 Agent 与 Gateway Appliance 固件**不在本包内:本包只覆盖控制面(backend/frontend/fastpath + 基础设施)。Agent 离线分发与 M2 固件烧录是独立流程(见 `deployment/production/agent.env.example` 与 `firmware/controller-stm32h5/`)。

## 安全说明

- `SHA256SUMS` 只防**传输损坏与无意篡改**;防蓄意替换需在可信信道核对外层 `.tar.gz.sha256`(或后续引入签名,当前未实现)。
- 密钥全部在客户机现场随机生成,不在分发包内预置;`.env` 权限 600。
- 三处密钥生成器(`scripts/setup.mjs`、`deployment/production/setup-env.sh`、本包 `install.sh`)的键列表必须同步演进;任一模板新增 `change_me` 键而生成器未跟上时,安装器会在"占位符残留"检查处硬失败而不是带弱密钥上线。
