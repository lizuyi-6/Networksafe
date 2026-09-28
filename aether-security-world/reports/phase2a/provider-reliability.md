# Phase 2A provider 可靠性（brief §38/§39）

- 调用次数: 25；批次数: 25
- 传输层失败: 0；重试: 1
- usage 缺失调用: 0
- finish_reason 分布: {"stop": 25}
- 累计 latency: 1577.3s

## 单次调用延迟

- 单次 output tokens: min 2734 / p50 9317 / max 14894

## Phase 1 故障的对策核对（brief §38）

| Phase 1 实测故障 | Phase 2A 对策 | 状态 |
| --- | --- | --- |
| 85 分钟 keep-alive 滴漏挂死 | `absolute_deadline_s`（默认 1800s）超时即取消 | 已实现 |
| per-op 超时永不触发 | `idle_timeout_s`（默认 300s）无字节进展即判死 | 已实现 |
| 401 key 失效引发 1992 次重试 | 401 不重试 + `auth_failure_limit` 熔断 | 已实现 |
| IncompleteRead / SSL 瞬断崩溃 | `http.client.HTTPException` 进可重试集合 | 已实现 |
| 重试无抖动打满配额 | 指数退避 × `random.Random(seed)` jitter | 已实现 |
| 断点续跑重复计费 | `Idempotency-Key` 请求头 | 已实现 |
| 进程被杀丢整批响应 | 每次成功响应立即落盘 checkpoint | 已实现 |

- 本 run 的传输层失败计数 0：Phase 1 的 无控挂死未复现即视为对策生效（绝对上限让最坏情况有界）。
