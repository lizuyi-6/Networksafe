"""重验证脚本（深审 P0-9：版本偏斜的拒绝从未重跑；accepted 未过修好的门）。

把指定来源（raw / rejected / quarantine / accepted）里的 world spec 在**当前冻结的
代码与配置**下重跑 compile → expand → gates，给出重分类结果，写入新文件（不覆写
历史记录）。用途：

1. 旧配置/旧门禁下的假拒绝（如 v0.6 时期 `session.*.principal` 轴）重跑复活；
2. 引擎修复（allow 遮蔽、G12 词表、可达性、CI 预检）后重新裁定已 accepted 的世界；
3. 每次修复后的小批量验证（milestone 前的 go/no-go 证据）。

用法::

    py -3 scripts/revalidate.py --source rejected --run-id provider-run-001
    py -3 scripts/revalidate.py --source accepted --run-id provider-run-001
    py -3 scripts/revalidate.py --source raw --run-id provider-run-001

只读来源文件；输出 `worlds/revalidated/<source>-<run-id>-<UTC 时间戳>.jsonl` 与
`reports/revalidate-<source>-<run-id>.md`。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from analysis.pipeline import BindsIncompleteError, _family_key, expand_handcrafted_world  # noqa: E402
from security_world.expansion.config import ExpansionConfig  # noqa: E402
from security_world.model import WorldSpec  # noqa: E402
from security_world.model.compile import CompileError, compile_spec  # noqa: E402
from security_world.validation import run_dataset_gates  # noqa: E402
from worlds.registry import HandcraftedWorld  # noqa: E402

from provider_run import (  # noqa: E402
    FAMILY_CATEGORY,
    classify_complexity,
    observable_label_set,
    structural_signature,
    verify_frozen,
)

#: P1-8 与 provider_run 的接受标准保持一致：全部 base 变体皆为 insufficient_evidence
#: 的世界降级隔离（标签熵过低，只教 abstention）。
SINGLE_LABEL_QUARANTINE_LABELS = frozenset({"insufficient_evidence"})


def source_path(source: str, run_id: str) -> Path:
    if source == "raw":
        return ROOT / "worlds" / "raw" / f"{run_id}.jsonl"
    if source == "accepted":
        return ROOT / "worlds" / "accepted" / "milestone-1-100.jsonl"
    return ROOT / "worlds" / source / f"{run_id}.jsonl"


def evaluate(spec_document: Mapping[str, Any], index: int) -> dict[str, Any]:
    world_id = str(spec_document.get("world_id") or "?")
    outcome: dict[str, Any] = {"world_id": world_id, "stage": None, "verdict": None}
    try:
        spec = WorldSpec.from_document(dict(spec_document))
    except Exception as exc:
        outcome.update(stage="schema", verdict="rejected", reason=str(exc)[:300])
        return outcome
    try:
        instance = compile_spec(spec, seed=int(spec_document.get("seed") or 0))
    except CompileError as exc:
        outcome.update(stage="compile", verdict="rejected",
                       reason_code=getattr(exc, "reason_code", "compile_error"), reason=str(exc)[:300])
        return outcome
    handcrafted = HandcraftedWorld(
        directory=world_id, number=index, spec_path=ROOT / "worlds" / "raw" / f"{world_id}.json",
        expected_path=ROOT / "worlds" / "raw" / f"{world_id}.expected.md",
        spec_document=dict(spec_document), expectations={},
    )
    try:
        expansion = expand_handcrafted_world(
            handcrafted, config=ExpansionConfig.default(), renderers=("http_request",)
        )
    except BindsIncompleteError as exc:
        outcome.update(stage="expansion", verdict="quarantined",
                       reason=f"binds_missing_{exc.missing}", detail=str(exc)[:300])
        return outcome
    except Exception as exc:
        outcome.update(stage="expansion", verdict="quarantined", reason="expansion_error", detail=str(exc)[:300])
        return outcome

    episodes = list(expansion.episodes)
    report = run_dataset_gates(
        episodes, families={_family_key(view): view for view in expansion.families},
        worlds={expansion.world_id: expansion.instance},
        declared_attack_families={expansion.world_id: str(spec_document.get("attack_family") or "")},
    )
    outcome["stage"] = "gates"
    outcome["episode_count"] = len(episodes)
    if not report.passed:
        outcome["verdict"] = "quarantined"
        outcome["gates"] = sorted({item.gate for item in report.failures})
        outcome["detail"] = [f"{item.gate}:{item.detail}" for item in report.failures][:6]
        return outcome
    # P1-8：每世界标签约束（与 provider_run.process_world 同一标准）。
    base_labels = observable_label_set(episodes)
    if base_labels == SINGLE_LABEL_QUARANTINE_LABELS:
        outcome["verdict"] = "quarantined"
        outcome["reason"] = "single_label_world_all_insufficient"
        return outcome
    outcome["verdict"] = "accepted"
    outcome["structural_signature"] = structural_signature(spec_document)
    outcome["coverage_category"] = FAMILY_CATEGORY.get(str(spec_document.get("attack_family")), "uncategorized")
    outcome["complexity"] = classify_complexity(spec_document)
    outcome["instance_document"] = expansion.instance.to_document()
    return outcome


def main() -> int:
    parser = argparse.ArgumentParser(description="在当前冻结规则下重跑指定来源的 worlds")
    parser.add_argument("--source", choices=["raw", "rejected", "quarantine", "accepted"], required=True)
    parser.add_argument("--run-id", default="provider-run-001")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    verify_frozen()  # 与 provider run 同一套 fail-closed：代码/配置/prompt 必须与冻结值一致
    path = source_path(args.source, args.run_id)
    if not path.is_file():
        print(f"来源不存在: {path}")
        return 1
    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if args.limit:
        records = records[: args.limit]

    # spec 的唯一权威来源是 raw 文件；rejected/quarantine 记录只带结论不带 spec。
    raw_path = ROOT / "worlds" / "raw" / f"{args.run_id}.jsonl"
    spec_index: dict[str, Mapping[str, Any]] = {}
    if raw_path.is_file():
        for line in raw_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            world_id = record.get("world_id")
            if isinstance(world_id, str) and "spec_document" in record:
                spec_index[world_id] = record["spec_document"]

    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    out_dir = ROOT / "worlds" / "revalidated"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.source}-{args.run_id}-{stamp}.jsonl"
    results = []
    skipped = 0
    for index, record in enumerate(records, start=1):
        world_id = record.get("world_id")
        spec_document = record.get("spec_document") or (
            spec_index.get(str(world_id)) if isinstance(world_id, str) else None
        )
        if spec_document is None:
            # 元素级/帧级拒绝记录没有 spec 可重跑（它们的出路是重新生成，不是重裁）。
            skipped += 1
            continue
        outcome = evaluate(spec_document, index)
        outcome["previous_verdict"] = record.get("reason") or args.source
        results.append(outcome)
        print(f"  {outcome['world_id']}: {outcome.get('previous_verdict')} -> {outcome['verdict']}"
              + (f" ({','.join(outcome.get('gates') or [])})" if outcome.get("gates") else "")
              + (f" ({outcome['reason']})" if outcome.get("reason") else ""))
    if skipped:
        print(f"  跳过 {skipped} 条无 spec 的拒绝记录（元素级/帧级/provider 错误，不可重裁）")
    with out_path.open("w", encoding="utf-8") as handle:
        for outcome in results:
            handle.write(json.dumps(outcome, ensure_ascii=False, sort_keys=True) + "\n")

    tally: dict[str, int] = {}
    for outcome in results:
        key = f"{outcome.get('previous_verdict')} -> {outcome['verdict']}"
        tally[key] = tally.get(key, 0) + 1
    summary = {
        "source": args.source,
        "run_id": args.run_id,
        "revalidated_at": stamp,
        "count": len(results),
        "reclassification": tally,
        "output": str(out_path),
    }
    reports = ROOT / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    report_path = reports / f"revalidate-{args.source}-{args.run_id}.md"
    report_path.write_text(
        "# 重验证报告\n\n"
        f"- 来源: {args.source} / {args.run_id}（{len(results)} 个 worlds）\n"
        f"- 时间: {stamp}\n"
        f"- 重分类: {json.dumps(tally, ensure_ascii=False)}\n"
        f"- 输出: {out_path}\n\n"
        "## 逐 world\n\n"
        + "\n".join(
            f"- {o['world_id']}: {o.get('previous_verdict')} -> {o['verdict']}"
            + (f" gates={o.get('gates')}" if o.get("gates") else "")
            + (f" reason={o.get('reason')}" if o.get("reason") else "")
            for o in results
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
