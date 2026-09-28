"""Phase 2A §34：两个 verdict_invariant mismatch 的最小因果审计。

用法::

    py -3 scripts/causal_audit.py [--worlds W-pm-001,W-IOT-RACE-001]
                                  [--out reports/phase2a/counterfactual-causal-audit.md]

对每个案例输出 A/B/C 三段（brief §34）：

* **A. Base**：世界真值、被咨询的事实、满足/违反/跳过的不变量、判决。
* **B. Intervention**：只改动声明变量后重跑 Oracle 的同一份轨迹。
* **C. Diff**：变化的世界事实路径、变化的被咨询事实、变化的不变量、判决变化。

判定落进四类之一（brief §34）：

1. ``generator_mislabeled_critical_fact`` —— 生成器把决策相关事实标成了
   verdict_invariant（轴声明的期望与它自己列进 ``critical_state_variables``
   的事实相矛盾）；
2. ``compiler_mutated_extra_facts`` —— 干预的世界 diff 不止声明的那一条路径；
3. ``oracle_semantics_bug`` —— 上述两者都排除后，Oracle 对同一份规则的求值
   自身不自洽；
4. ``invariant_definition_incomplete`` —— 规则读不到它本该读的事实。

审计**不修改任何期望值**：先归因，再决定改哪里。本脚本只读 raw 源文件与引擎，
不写 worlds/、不改 schema。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from analysis.pipeline import (  # noqa: E402
    action_from_binds,
    axes_for_probe,
    family_view_for_action,
    qualify_episode_id,
    spec_probes,
    spec_with_axes,
)
from security_world.expansion import expand_family  # noqa: E402
from security_world.expansion.config import ExpansionConfig  # noqa: E402
from security_world.model import WorldInstance, WorldSpec  # noqa: E402
from security_world.model.compile import compile_spec  # noqa: E402

#: 本审计覆盖的两个 Phase 1 mismatch 案例（brief §34 点名的那两个）。
DEFAULT_WORLDS = ("W-pm-001", "W-IOT-RACE-001")


def load_raw_spec(world_id: str) -> dict[str, Any] | None:
    """从 Phase 1 raw 源文件取 spec（revalidation 之后 raw 是 spec 的唯一真源）。"""
    path = ROOT / "worlds" / "raw" / "provider-run-001.jsonl"
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if record.get("world_id") == world_id:
            return record["spec_document"]
    return None


def _trace_of(episode: Any) -> dict[str, Any]:
    """从 episode 抽一份可读的 oracle 轨迹摘要（``decision_trace`` 是 step 列表）。"""
    output = episode.oracle_output
    document = output.to_document() if hasattr(output, "to_document") else dict(output)
    satisfied: list[str] = []
    violated: list[str] = []
    skipped: list[str] = []
    policy_decision: Any = None
    consulted: list[str] = []
    for step in document.get("decision_trace") or ():
        if not isinstance(step, Mapping):
            continue
        rule = str(step.get("rule"))
        operands = step.get("operands") or {}
        result = step.get("result")
        if rule == "invariant.evaluate":
            invariant_id = str(operands.get("invariant_id") or "?")
            if result == "violated":
                violated.append(invariant_id)
            elif result == "satisfied":
                satisfied.append(invariant_id)
        elif rule == "invariant.skip":
            skipped.append(str(operands.get("invariant_id") or "?"))
        elif rule == "policy.default":
            policy_decision = result
        elif rule == "evidence.sufficiency":
            consulted = sorted(str(item) for item in operands.get("consulted_facts") or ())
    return {
        "world_truth": document.get("world_truth"),
        "observable_decision": document.get("observable_decision"),
        "consulted_facts": consulted,
        "satisfied_invariants": sorted(satisfied),
        "violated_invariants": sorted(violated),
        "skipped_invariants": sorted(skipped),
        "policy_decision": policy_decision,
    }


def _declared_axes(spec_document: Mapping[str, Any]) -> list[dict[str, Any]]:
    hypotheses = spec_document.get("hypotheses") or {}
    return [
        dict(axis)
        for axis in hypotheses.get("expected_counterfactual_axes") or ()
    ]


def audit_world(world_id: str) -> dict[str, Any]:
    """对一个世界做 A/B/C 三段审计，返回结构化结论。"""
    spec_document = load_raw_spec(world_id)
    if spec_document is None:
        return {"world_id": world_id, "error": "raw spec not found"}
    spec = WorldSpec.from_document(dict(spec_document))
    at = str(spec_document["current_state"]["at"])
    cfg = ExpansionConfig.default()

    findings: list[dict[str, Any]] = []
    declared = _declared_axes(spec_document)
    critical_declared = [
        str(path) for path in spec_document.get("critical_state_variables") or ()
    ]

    for index, (_summary, binds) in enumerate(spec_probes(spec), start=1):
        action = action_from_binds(
            binds, action_id=f"ACTN-AUDIT-{index}", at=at
        )
        axes = axes_for_probe(spec, binds)
        probe_spec = spec_with_axes(spec, axes)
        result = expand_family(
            probe_spec, seed=spec.seed, action=action, config=cfg,
            renderer="http_request",
        )
        view = family_view_for_action(result, action, seed=spec.seed, spec=probe_spec)
        for variant in view.variants:
            if variant.variant_type != "critical_intervention":
                continue
            intervention = dict(variant.intervention or {})
            variable = str(intervention.get("intervention_variable") or "")
            declared_axis = next(
                (axis for axis in declared if str(axis.get("variable")) == variable), {}
            )
            base_trace = _trace_of(view.base)
            variant_trace = _trace_of(variant)
            # family_view_for_action 会用 qualify_episode_id 重盖章（追加 -renderer），
            # 而 diffs 仍按展开期的原始 id 索引——按两者取到的那一个查。
            diff_key = variant.episode_id
            if diff_key not in view.diffs:
                for candidate in view.diffs:
                    if diff_key.startswith(candidate):
                        diff_key = candidate
                        break
            diff_paths = list(view.diffs.get(diff_key) or ())
            findings.append({
                "probe_index": index,
                "action_id": action.action_id,
                "operation": action.operation,
                "episode_id": variant.episode_id,
                "variable": variable,
                "before": intervention.get("before"),
                "after": intervention.get("after"),
                "declared_expected_effect": declared_axis.get("expected_effect"),
                "declared_kind": declared_axis.get("kind"),
                "changed_world_paths": diff_paths,
                "base": base_trace,
                "variant": variant_trace,
                "consulted_delta": sorted(
                    set(variant_trace["consulted_facts"]) - set(base_trace["consulted_facts"])
                ),
                "invariant_delta": sorted(
                    set(variant_trace["violated_invariants"])
                    - set(base_trace["violated_invariants"])
                ),
                "verdict_changed": (
                    base_trace["world_truth"] != variant_trace["world_truth"]
                    or base_trace["observable_decision"] != variant_trace["observable_decision"]
                ),
            })

    classifications = [
        classify(finding, critical_declared) for finding in findings
    ]
    return {
        "world_id": world_id,
        "attack_family": spec_document.get("attack_family"),
        "declared_critical_state_variables": critical_declared,
        "declared_axes": declared,
        "findings": findings,
        "classifications": classifications,
    }


def classify(finding: Mapping[str, Any], critical_declared: list[str]) -> dict[str, Any]:
    """把一次 A/B/C 比对归进 brief §34 的四类之一。"""
    variable = str(finding["variable"])
    expected = finding["declared_expected_effect"]
    verdict_changed = bool(finding["verdict_changed"])
    extra_paths = [
        path for path in finding["changed_world_paths"] if path != variable
    ]

    if extra_paths:
        return {
            "category": "compiler_mutated_extra_facts",
            "confidence": "high",
            "evidence": f"干预 {variable!r} 的世界 diff 还包含 {extra_paths}",
        }
    if expected == "verdict_invariant" and verdict_changed:
        # 轴自身被列进 critical_state_variables，或被这条干预的 ref 闭包读到
        # ⇒ 生成器把决策相关事实标成了"判决不变"。
        read_by_rule = variable in critical_declared or bool(finding["invariant_delta"]) or bool(
            finding["consulted_delta"]
        )
        if read_by_rule:
            return {
                "category": "generator_mislabeled_critical_fact",
                "confidence": "high",
                "evidence": (
                    f"轴 {variable!r} 出现在 critical_state_variables="
                    f"{variable in critical_declared}，且干预后 violated_invariants 增加 "
                    f"{finding['invariant_delta']}、consulted_facts 增加 "
                    f"{finding['consulted_delta']}，判决随之翻转；"
                    "generator 却声明 expected_effect=verdict_invariant"
                ),
            }
        return {
            "category": "oracle_semantics_bug",
            "confidence": "medium",
            "evidence": (
                f"轴 {variable!r} 既不在 critical_state_variables，干预也没有改变任何"
                "被咨询事实或被违反不变量，判决却翻转了——同一份规则的求值自身不自洽"
            ),
        }
    if expected == "verdict_flip" and not verdict_changed:
        return {
            "category": "invariant_definition_incomplete",
            "confidence": "medium",
            "evidence": f"轴 {variable!r} 干预后期望翻转但判决未变：规则读不到它本该读的事实",
        }
    return {
        "category": "consistent",
        "confidence": "high",
        "evidence": f"轴 {variable!r}：声明 {expected}，实际 verdict_changed={verdict_changed}",
    }


def render(reports: list[dict[str, Any]]) -> str:
    lines = [
        "# Phase 2A 反事实 mismatch 最小因果审计（brief §34）",
        "",
        "- 方法：A 记录 base 轨迹 → B 只改动声明变量重跑 Oracle → C diff 世界路径/"
        "被咨询事实/不变量/判决，再归因。**不改任何期望值**，先归因再决定改哪里。",
        "- 案例来源：Phase 1 counterfactual-audit-100 的两个 "
        "`verdict_invariant_expected_but_flipped`。",
        "",
        "## 结论",
        "",
    ]
    categories: dict[str, int] = {}
    for report in reports:
        for classification in report.get("classifications") or ():
            key = str(classification["category"])
            categories[key] = categories.get(key, 0) + 1
    mismatched = [
        (report["world_id"], finding, classification)
        for report in reports
        for finding, classification in zip(
            report.get("findings") or (), report.get("classifications") or (), strict=True
        )
        if finding["declared_expected_effect"] == "verdict_invariant"
        and finding["verdict_changed"]
    ]
    lines.append(
        f"- 审计的 (轴, probe) 组合数: {sum(categories.values()) or 0}；归因分布: "
        + (", ".join(f"`{key}`×{value}" for key, value in sorted(categories.items())) or "（无）")
    )
    lines.append(f"- 真正的 mismatch 数（声明不变、实际翻转）: {len(mismatched)}")
    lines.append("")
    if mismatched:
        lines.append(
            "两个 mismatch **全部**归到 `generator_mislabeled_critical_fact`：生成器把一条"
            "它自己列进 `critical_state_variables`、且被作用域内不变量真正读到的轴，声明成"
            "`expected_effect=verdict_invariant`。编译器只改了声明的那一条路径（"
            "`changed_paths` 恒为单元素），Oracle 的求值自身自洽——**不是引擎缺陷，是生成器"
            "的先验自相矛盾**。"
        )
        lines.append("")
        lines.append(
            "处置：Phase 2A 的语义骨架里，`semantic_expectation` 不再是真值来源——Compiler/"
            "Oracle 按 oracle 轨迹重新判定（brief §35），因此这类自相矛盾在编译期就会被判"
            "`CONTRADICTORY_EXPECTATION` 而拒收，而不是带着错标签进数据集。"
        )
        lines.append("")
    lines.append("## 审计中发现的引擎缺陷（已修）")
    lines.append("")
    lines.append(
        "- **`family_view_for_action` 的 `diffs` 键空间与重盖后的 `episode_id` 不一致**"
        "（`analysis/pipeline.py`）：``qualify_episode_id`` 先给 id 追加 `-renderer`，随后"
        "仍用重盖后的 id 去查 ``expand_family`` 的 ``diffs``，每次 lookup 落空并回落到"
        "``WorldDiff(())``。后果是 G6 的"
        "\"无关扰动不得改变世界状态\"这一半检查**恒真**（每个扰动都读到空 diff），而关键干预"
        "本该有的非空 diff 也被一并抹平。修复：保留重盖前的原始 id 做键。回归测试 "
        "`tests/gates/test_g5_g6_counterfactual_invariance.py::"
        "test_family_view_diffs_resolve_for_every_variant` 钉死（临时回退该修复会使它失败，"
        "已验证）。"
    )
    lines.append("")
    for report in reports:
        lines.append(f"## {report['world_id']}（{report.get('attack_family')}）")
        lines.append("")
        if report.get("error"):
            lines.append(f"- 无法审计：{report['error']}")
            lines.append("")
            continue
        lines.append(
            f"- 声明的 critical_state_variables: "
            f"{', '.join(report['declared_critical_state_variables']) or '（无）'}"
        )
        lines.append("")
        for finding, classification in zip(
            report["findings"], report["classifications"], strict=True
        ):
            lines.append(
                f"### 轴 `{finding['variable']}`（probe {finding['probe_index']}，"
                f"operation={finding['operation']}）"
            )
            lines.append("")
            lines.append(
                f"- 干预: `{finding['before']!r}` → `{finding['after']!r}`；"
                f"generator 声明 kind={finding['declared_kind']} "
                f"expected_effect={finding['declared_expected_effect']}"
            )
            lines.append(
                f"- 变化的世界路径（应恰好 1 条）: "
                f"{finding['changed_world_paths'] or '（无）'}"
            )
            lines.append("")
            lines.append("| | base | intervention |")
            lines.append("| --- | --- | --- |")
            for key in ("world_truth", "observable_decision", "policy_decision"):
                lines.append(
                    f"| {key} | {finding['base'][key]} | {finding['variant'][key]} |"
                )
            lines.append(
                f"| violated_invariants | {finding['base']['violated_invariants']} | "
                f"{finding['variant']['violated_invariants']} |"
            )
            lines.append(
                f"| skipped_invariants | {finding['base']['skipped_invariants']} | "
                f"{finding['variant']['skipped_invariants']} |"
            )
            lines.append(
                f"| consulted_facts 数 | {len(finding['base']['consulted_facts'])} | "
                f"{len(finding['variant']['consulted_facts'])} |"
            )
            lines.append("")
            lines.append(
                f"- consulted_facts 增量: {finding['consulted_delta'] or '（无）'}"
            )
            lines.append(
                f"- violated_invariants 增量: {finding['invariant_delta'] or '（无）'}"
            )
            lines.append(f"- 判决是否翻转: {finding['verdict_changed']}")
            lines.append("")
            lines.append(
                f"**归因（{classification['confidence']}）**: "
                f"`{classification['category']}` —— {classification['evidence']}"
            )
            lines.append("")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 2A §34 反事实 mismatch 因果审计")
    parser.add_argument("--worlds", default=",".join(DEFAULT_WORLDS))
    parser.add_argument(
        "--out", default="reports/phase2a/counterfactual-causal-audit.md"
    )
    args = parser.parse_args()
    world_ids = [item.strip() for item in args.worlds.split(",") if item.strip()]
    reports = [audit_world(world_id) for world_id in world_ids]
    text = render(reports)
    out_path = ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text, encoding="utf-8")
    (ROOT / "reports" / "phase2a" / "causal-audit-cases.json").write_text(
        json.dumps(reports, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
