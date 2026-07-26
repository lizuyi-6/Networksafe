# ADR: Rescue Release 策略 —— MVP 不提供 release，且为代码层禁止

- Date: 2026-07-08
- Status: Accepted（阻断级安全决策，按 PRD §15 单列）
- 关联：`2026-07-08-heterogeneous-rescue-control-plane.md`、PRD §8.3

## Context

PRD §8.3 给出两条路线：MVP 不提供 rescue release；或在业务确需时以更严格条件提供。release 恢复 SERVER↔LAN/WAN 业务桥，是整个平台唯一"风险增加类"的物理动作，其授权链（policyDigest + hardware grant 签名 + monotonic counter + expiry + interlock feedback）是产品"完全最后防线"声称的工程根基。救援控制面的威胁模型恰恰包含"主系统被 root 后攻击者寻找第二条恢复连接的路径"——若救援面具备任何形式的 release 能力，它本身就成为该路径。

## Decision

1. **MVP（Phase 0–4）救援控制面不提供 release。** 不是"配置默认关闭"，而是**二进制中不存在**能构造或发送 `interlock_release` / `released_ruleset` 帧的代码路径。
2. **源码层 guard 强制**：`scripts/guards/check-rescue-no-release.mjs` 扫描 `rescue/src/`，出现 `interlock_release` / `released_ruleset` 字符串（除显式拒绝注释/测试断言外）即非零退出，纳入 release guard 清单。
3. **语义变更零容忍**：任何给救援面加 release 的提案，必须新开 ADR 并满足 PRD §8.3 全部 5 项附加条件（业务论证、硬件 grant + 物理确认或双人签名、TTL ≤ 主路径、双审计、任一不确定即拒绝），按阻断级评审，不得以"运维便利"名义走普通 PR。
4. 救援面对不确定状态的唯一输出是 `unknown` + 保持 isolated 建议；它没有"判断现在可以恢复业务"的职权——该职权只属于 Gateway Appliance 硬件状态机。

## Consequences

- 主控制面不可用期间业务桥无法经软件恢复——这是设计意图，不是缺陷：恢复业务的路径是先用救援面恢复主控制面（restart-primary），再走完整 Final Defense 链。
- 攻击者攻陷救援面（认证密钥泄露等）最多能做的是隔离与重启主服务——风险降低类动作，符合"3.3 风险降低动作不需证明"的既有设计。
- guard 脚本是字符串级防线，防呆不防蓄意；蓄意绕过由 code review + 本 ADR 的阻断级评审要求兜底。
