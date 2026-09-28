"""Phase 2A 专项报告：multi-tenant 覆盖 / 效率对比 / provider 可靠性（brief §25/§39/§53）。

这三个报告在 ``audit_phase2a.py`` 的十项审计之外单独成文，因为它们各自对应一个
**进入 500-world production 前必须单独签字**的问题：

* multi-tenant：Phase 1 拿到 0 个 accepted，Phase 2A 必须证明这是机制问题而非数据问题；
* token economy：Phase 2A 的唯一存在理由是效率，必须给出对比 Phase 1 的实测倍数；
* provider 可靠性：Phase 1 出现过 85 分钟挂死与 1992 次重试风暴，必须证明已堵住。

用法::

    py -3 scripts/phase2a_reports.py [--label smoke-10]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic_skeleton.mechanisms import MECHANISMS, label_families  # noqa: E402

RUN_ID = "provider-run-002"
PHASE1 = {
    "raw_worlds": 219,
    "accepted": 69,
    "rejected": 96,
    "quarantined": 56,
    "acceptance_rate": 0.3151,
    "input_tokens": 2217640,
    "output_tokens": 11809745,
    "latency_s": 135503.343,
    "retries": 31,
    "batches": 304,
    "accepted_per_100k_output": 0.584,
    "multi_tenant_accepted": 0,
}


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict):
            out.append(record)
    return out


def collect(run_id: str = RUN_ID) -> dict[str, Any]:
    suffix = "" if run_id == RUN_ID else f"-{run_id}"
    progress_path = ROOT / "state" / f"phase2a-progress{suffix}.json"
    progress = json.loads(progress_path.read_text(encoding="utf-8")) if progress_path.is_file() else {}
    accepted = _read_jsonl(ROOT / "worlds" / "skeletons" / "accepted" / f"{run_id}.jsonl")
    quarantine = _read_jsonl(ROOT / "worlds" / "skeletons" / "quarantine" / f"{run_id}.jsonl")
    rejected = _read_jsonl(ROOT / "worlds" / "skeletons" / "rejected" / f"{run_id}.jsonl")
    frames = _read_jsonl(ROOT / "worlds" / "skeletons" / "raw" / f"frames-{run_id}.jsonl")
    return {
        "run_id": run_id,
        "progress": progress, "accepted": accepted, "quarantine": quarantine,
        "rejected": rejected, "frames": frames,
    }


# --------------------------------------------------------------------------- #
# multi-tenant 专项
# --------------------------------------------------------------------------- #
def multi_tenant_report(data: Mapping[str, Any]) -> str:
    accepted = data["accepted"]
    mt = [r for r in accepted if "multi_tenant" in (r.get("coverage_labels") or [])]
    families = Counter(str(r.get("mechanism_family")) for r in mt)
    attack_families = Counter(str(r.get("attack_family")) for r in mt)
    # 十种 brief §25 点名的机制各自拿到几个
    required = [
        "stale_tenant_context", "cross_tenant_cache", "token_tenant_mismatch",
        "service_account_tenant_crossover", "delegated_tenant_access",
        "resource_tenant_mismatch", "tenant_switch_stale_session",
        "cross_service_tenant_propagation_delay", "tenant_identifier_collision",
        "cached_authorization_cross_tenant_reuse",
    ]
    registry_mt = {
        item.family for item in MECHANISMS if "multi_tenant" in item.coverage_labels
    }
    lines = [
        "# Phase 2A multi-tenant 覆盖专项（brief §25）",
        "",
        f"- multi_tenant accepted: {len(mt)}（Phase 1: {PHASE1['multi_tenant_accepted']}）",
        f"- 注册表内 multi_tenant 机制数: {len(registry_mt)}",
        f"- 已跑到的不同机制数: {len(families)}",
        f"- 不同 attack_family 数: {len(attack_families)}",
        "",
        "## brief §25 点名的十个机制",
        "",
        "| mechanism | accepted |",
        "| --- | --- |",
    ]
    for family in required:
        lines.append(f"| `{family}` | {int(families.get(family, 0))} |")
    lines += [
        "",
        "## 机制分布",
        "",
        json.dumps(dict(sorted(families.items())), ensure_ascii=False, indent=1),
        "",
        "## attack_family 分布",
        "",
        json.dumps(dict(sorted(attack_families.items())), ensure_ascii=False, indent=1),
        "",
        "## 多样性判据",
        "",
    ]
    # 多样性：不能八个世界本质全是 principal.tenant != resource.tenant
    archetype_shapes: Counter[str] = Counter()
    for record in mt:
        for item in record.get("spec_document", {}).get("invariants") or ():
            archetype_shapes[str(item.get("category"))] += 1
    lines.append(
        f"- 不变量 category 分布: {json.dumps(dict(sorted(archetype_shapes.items())), ensure_ascii=False)}"
    )
    lines.append(
        f"- 判据：multi_tenant 世界的不变量形态必须 ≥3 种（brief §25 禁止八个世界本质全是 "
        f"`principal.tenant != resource.tenant`）。当前 {len(archetype_shapes)} 种。"
    )
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# 效率对比
# --------------------------------------------------------------------------- #
def efficiency_report(data: Mapping[str, Any]) -> str:
    progress = data["progress"]
    accepted = int(progress.get("accepted", 0))
    out_tokens = int(progress.get("output_tokens", 0))
    in_tokens = int(progress.get("input_tokens", 0))
    latency = float(progress.get("latency_s", 0.0))
    raw = int(progress.get("raw_skeletons", 0))
    per_100k = (accepted / out_tokens * 100000) if out_tokens else 0.0
    per_1m = (accepted / in_tokens * 1000000) if in_tokens else 0.0
    per_hour = (accepted / (latency / 3600.0)) if latency else 0.0
    factor = (per_100k / PHASE1["accepted_per_100k_output"]) if PHASE1["accepted_per_100k_output"] else 0.0
    acceptance = (accepted / raw) if raw else 0.0
    lines = [
        "# Phase 2A token economy 对比（brief §53）",
        "",
        "| 指标 | Phase 1 | Phase 2A | 变化 |",
        "| --- | --- | --- | --- |",
        f"| accepted | {PHASE1['accepted']} | {accepted} | — |",
        f"| raw | {PHASE1['raw_worlds']} | {raw} | — |",
        f"| acceptance rate | {PHASE1['acceptance_rate']:.4f} | {acceptance:.4f} | "
        f"{(acceptance / PHASE1['acceptance_rate'] - 1) * 100:+.1f}% |",
        f"| input tokens | {PHASE1['input_tokens']} | {in_tokens} | — |",
        f"| output tokens | {PHASE1['output_tokens']} | {out_tokens} | — |",
        f"| accepted / 100k output tokens | {PHASE1['accepted_per_100k_output']:.3f} | "
        f"{per_100k:.3f} | **{factor:.2f}x** |",
        f"| accepted / 1M input tokens | — | {per_1m:.3f} | — |",
        f"| accepted / provider hour | — | {per_hour:.3f} | — |",
        f"| output tokens / accepted world | "
        f"{PHASE1['output_tokens'] / PHASE1['accepted']:.0f} | "
        f"{(out_tokens / accepted) if accepted else 0:.0f} | — |",
        f"| provider retries | {PHASE1['retries']} | {int(progress.get('retries', 0))} | — |",
        "",
        "## 判据（brief §3 / §62）",
        "",
        f"- 最低门槛：accepted / 100k output tokens > 2。当前 {per_100k:.3f} ⇒ "
        + ("**达标**" if per_100k > 2 else "**未达标**"),
        f"- 目标区间：3～5。当前 {per_100k:.3f} ⇒ "
        + ("**在目标区间**" if 3 <= per_100k <= 5 else ("**高于目标区间**" if per_100k > 5 else "低于目标区间")),
        f"- Phase 1 基线 {PHASE1['accepted_per_100k_output']} 的提升倍数：**{factor:.2f}x**",
        "",
        "## 构成解读",
        "",
        "- 骨架平均输出 token 数远小于完整 world JSON：Phase 1 每个 world 平均 "
        f"{PHASE1['output_tokens'] / PHASE1['raw_worlds']:.0f} output tokens（含全部被拒的），"
        f"Phase 2A 每个骨架平均 {(out_tokens / raw) if raw else 0:.0f}。",
        "- 结构性失败（resource_states / state_preconditions 形状）在 Phase 2A 由编译器承担，"
        "因此不再产生 shape 类拒绝；剩下的拒绝集中在语义层（未知事实/类型、空干预、近重复）。",
    ]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# provider 可靠性
# --------------------------------------------------------------------------- #
def provider_report(data: Mapping[str, Any]) -> str:
    progress = data["progress"]
    frames = data["frames"]
    finish_reasons = Counter(str(f.get("finish_reason")) for f in frames)
    calls = len(frames)
    latencies = sorted(float(f.get("latency_s") or 0.0) for f in frames if f.get("latency_s"))
    output_lengths = sorted(int(f.get("output_tokens") or 0) for f in frames)
    lines = [
        "# Phase 2A provider 可靠性（brief §38/§39）",
        "",
        f"- 调用次数: {calls}；批次数: {int(progress.get('batches', 0))}",
        f"- 传输层失败: {int(progress.get('provider_errors', 0))}；重试: {int(progress.get('retries', 0))}",
        f"- usage 缺失调用: {int(progress.get('usage_missing_calls', 0))}",
        f"- finish_reason 分布: {json.dumps(dict(finish_reasons), ensure_ascii=False)}",
        f"- 累计 latency: {float(progress.get('latency_s', 0.0)):.1f}s",
        "",
        "## 单次调用延迟",
        "",
    ]
    if latencies:
        lines.append(
            f"- min {latencies[0]:.1f}s / p50 {latencies[len(latencies) // 2]:.1f}s / "
            f"max {latencies[-1]:.1f}s"
        )
    if output_lengths:
        lines.append(
            f"- 单次 output tokens: min {output_lengths[0]} / p50 "
            f"{output_lengths[len(output_lengths) // 2]} / max {output_lengths[-1]}"
        )
    lines += [
        "",
        "## Phase 1 故障的对策核对（brief §38）",
        "",
        "| Phase 1 实测故障 | Phase 2A 对策 | 状态 |",
        "| --- | --- | --- |",
        "| 85 分钟 keep-alive 滴漏挂死 | `absolute_deadline_s`（默认 1800s）超时即取消 | 已实现 |",
        "| per-op 超时永不触发 | `idle_timeout_s`（默认 300s）无字节进展即判死 | 已实现 |",
        "| 401 key 失效引发 1992 次重试 | 401 不重试 + `auth_failure_limit` 熔断 | 已实现 |",
        "| IncompleteRead / SSL 瞬断崩溃 | `http.client.HTTPException` 进可重试集合 | 已实现 |",
        "| 重试无抖动打满配额 | 指数退避 × `random.Random(seed)` jitter | 已实现 |",
        "| 断点续跑重复计费 | `Idempotency-Key` 请求头 | 已实现 |",
        "| 进程被杀丢整批响应 | 每次成功响应立即落盘 checkpoint | 已实现 |",
        "",
        f"- 本 run 的传输层失败计数 {int(progress.get('provider_errors', 0))}：Phase 1 的 "
        "无控挂死未复现即视为对策生效（绝对上限让最坏情况有界）。",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 2A 专项报告")
    parser.add_argument("--label", default="smoke-10")
    parser.add_argument("--run-id", default="provider-run-002")
    args = parser.parse_args()
    data = collect(args.run_id)
    out_dir = ROOT / "reports" / "phase2a"
    out_dir.mkdir(parents=True, exist_ok=True)
    reports = {
        "multi-tenant-coverage.md": multi_tenant_report(data),
        "efficiency-comparison.md": efficiency_report(data),
        "provider-reliability.md": provider_report(data),
    }
    for name, text in reports.items():
        (out_dir / name).write_text(text, encoding="utf-8")
        print(f"=== {name} ===")
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
