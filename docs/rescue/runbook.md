# Rescue Control Plane 运维 Runbook（MVP）

- 关联：PRD §11/§12/§14.6，ADR `docs/adr/2026-07-08-*.md`
- 交付物：`rescue/` 源码 → `ag-rescue` 单二进制；`deployment/rescue/` 模板

## 1. 构建与安装

```bash
cd rescue
cargo build --release          # 产物 rescue/target/release/ag-rescue(.exe)
```

Linux 部署（推荐独立管理机，见共因故障矩阵 §2.2）：

```bash
sudo install -m 0755 target/release/ag-rescue /usr/local/bin/
sudo mkdir -p /etc/aetherguard-rescue /var/lib/aetherguard-rescue
sudo cp deployment/rescue/rescue.json.example /etc/aetherguard-rescue/rescue.json  # 按现场编辑
sudo cp deployment/rescue/aetherguard-rescue.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now aetherguard-rescue
```

## 2. Provision（首次，双人复核）

```bash
ag-rescue provision --config /etc/aetherguard-rescue/rescue.json
# 或 bootstrap：ag-rescue provision --data-dir /var/lib/aetherguard-rescue
```

- 密钥落在 `<data_dir>/rescue-keyring/rescue-auth.key`（Unix 0600；Windows 由安装方收紧 ACL——目录不得 world-readable）。
- **拒绝覆盖已有密钥**；轮换见 §5。
- 密钥不打印到任何输出；分发走既有 secret 通道（拷贝文件）。

## 3. 日常操作

```bash
ag-rescue doctor --json     # 自检：exit 0 = ready；exit 5 = restricted/locked
ag-rescue status --json     # 主服务/appliance/interlock/审计链一览
ag-rescue isolate --reason "<why>" --json          # 安全侧隔离（exit 0=硬件帧确认 isolated）
ag-rescue restart-primary --service <name> --json  # 仅 allowlist 内服务
ag-rescue audit verify --json
ag-rescue audit export --out /tmp/rescue-audit.json
ag-rescue resync --json     # 当前仅链校验+载荷生成（主审计 ingest 端点未落地，见缺口）
ag-rescue serve             # 本地 HTTP + 只读状态页（默认 127.0.0.1:7801）
```

exit 码约定：0 成功 / 2 用法错误 / 3 拒绝 / 4 执行未确认或失败 / 5 locked-restricted。

**isolate 语义**：exit 0 仅当 appliance 回帧确认 `interlockState=isolated`；帧超时/不一致时 exit 4 且 `reason=interlock_assert_sent_not_confirmed`——命令可能已生效但未确认，按未确认处置（复查 status，必要时物理确认）。

## 4. 故障演练

```bash
node scripts/rescue/run-drills.mjs   # DRILL-001/008、SEC-001/005/007 实跑断言；exit 0=全过
```

留证：把输出与 `git rev-parse HEAD` 一起归档到演练记录。物理链路演练（拔 MGMT、串口、真机 appliance）不在脚本内，需现场执行并按 PRD §12.3 留证。

## 5. 密钥轮换

1. `mv rescue-auth.key rescue-auth.key.retired-$(date +%F)`（此刻起动作全拒，只读仍可用——预期行为）
2. `ag-rescue provision ...` 生成新钥并分发给持有者
3. `ag-rescue doctor` 确认 `auth: ready`；audit log 中会留下轮换期间的 denied 事件
4. 双人复核后销毁 retired 密钥

## 6. 卸载

```bash
sudo systemctl disable --now aetherguard-rescue
sudo rm /usr/local/bin/ag-rescue /etc/systemd/system/aetherguard-rescue.service
# data_dir（审计链）按留存策略归档后再删除——先 audit export，不要直接 rm
```

## 7. 已知缺口（阻断/非阻断）

| 缺口 | 级别 | 说明 |
| --- | --- | --- |
| 主审计 ingest 端点未实现 | 非阻断（MVP resync 只校验+导出） | 后端组任务，落地前 `resync` 的 delivery 恒为 not_implemented |
| 串口/console transport 未实现 | 非阻断（trait 已预留） | MGMT 断链场景暂无软件路径，见矩阵 §2.3 |
| Windows 密钥 ACL 自动收紧 | 非阻断 | 安装方手动收紧；Unix 已自动 0600 |
| systemd watchdog（WatchdogSec/sd_notify） | 非阻断 | unit 用 Restart=always 兜底；sd_notify 集成待做 |
| 真机 appliance 演练 | 发布前必做 | 软件 mock 不替代硬件 interlock 实测 |
