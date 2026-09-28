# Phase 2A multi-tenant 覆盖专项（brief §25）

- multi_tenant accepted: 29（Phase 1: 0）
- 注册表内 multi_tenant 机制数: 13
- 已跑到的不同机制数: 13
- 不同 attack_family 数: 4

## brief §25 点名的十个机制

| mechanism | accepted |
| --- | --- |
| `stale_tenant_context` | 2 |
| `cross_tenant_cache` | 3 |
| `token_tenant_mismatch` | 1 |
| `service_account_tenant_crossover` | 1 |
| `delegated_tenant_access` | 2 |
| `resource_tenant_mismatch` | 2 |
| `tenant_switch_stale_session` | 1 |
| `cross_service_tenant_propagation_delay` | 3 |
| `tenant_identifier_collision` | 2 |
| `cached_authorization_cross_tenant_reuse` | 3 |

## 机制分布

{
 "cached_authorization_cross_tenant_reuse": 3,
 "cross_service_tenant_propagation_delay": 3,
 "cross_tenant_cache": 3,
 "delegated_tenant_access": 2,
 "horizontal_peer_access": 5,
 "resource_tenant_mismatch": 2,
 "service_account_tenant_crossover": 1,
 "session_principal_swap": 2,
 "stale_tenant_context": 2,
 "tenant_identifier_collision": 2,
 "tenant_switch_stale_session": 1,
 "token_tenant_mismatch": 1,
 "untrusted_source_establishes_decisive_fact": 2
}

## attack_family 分布

{
 "cross_account_session_misuse": 2,
 "horizontal_privesc": 5,
 "tenant_isolation_violation": 15,
 "tenant_mismatch": 7
}

## 多样性判据

- 不变量 category 分布: {"cache_consistency": 3, "ownership": 5, "session_binding": 3, "tenant_isolation": 16, "token_scope": 3, "trust_boundary": 2}
- 判据：multi_tenant 世界的不变量形态必须 ≥3 种（brief §25 禁止八个世界本质全是 `principal.tenant != resource.tenant`）。当前 6 种。
