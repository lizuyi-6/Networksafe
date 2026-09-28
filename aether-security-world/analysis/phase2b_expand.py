"""Phase 2B 的正式 episode 展开驱动（brief §32-§41）。

与 Phase 1/2A 的 ``analysis/pipeline.py`` 的差别只有两点，都由 brief 驱动：

1. **每个逻辑变体都铺满全部 renderer**（brief §41："同一 world 允许多个 surface forms"）。
   同一个 (world, action, evidence_view) 用 8 种 surface 呈现，真值由 Oracle 逐次重算，
   模型必须学会在 HTTP 请求 / 反代日志 / 审计日志 / API gateway 记录里认出同一个安全态势。
   这是把 500 个世界变成 40k–60k episode 的**确定性**乘数——不再多调一次 LLM（brief §35）。
2. **新增 ``trust_provenance_variant`` 家族**（brief §33/§40）：同一条断言值改挂到更弱的
   来源/时效上，由 Oracle 重新判定充分性。实现见 ``security_world/expansion/families.py``。

每个 episode 至少带 brief §36 要求的字段：``world_truth`` 与 ``observable_decision``
**分开**、satisfied/violated/skipped invariants、consulted/required/missing evidence、
evidence provenance、counterfactual family、derivation trace。

真值全部由 Oracle 在 (world, action, evidence_view) 上重算；本驱动不写任何一个标签。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from security_world.expansion import (  # noqa: E402
    ExpansionConfig,
    assemble_episode,
    expand_family,
    instantiate,
    render,
)
from security_world.expansion.counterfactual import (  # noqa: E402
    Intervention,
    with_actual_effect,
)
from security_world.expansion.episode import (  # noqa: E402
    _action_from_spec,
    _decision_event,
    _timeline_from_spec,
)
from security_world.expansion.families import (  # noqa: E402
    apply_variant,
    candidate_variants,
    observable_effect,
    variant_key,
)
from security_world.expansion.counterfactual import Intervention  # noqa: E402
from security_world.model import WorldSpec  # noqa: E402
from security_world.oracle import run_oracle  # noqa: E402
from security_world.oracle.evidence_view import EvidenceView  # noqa: E402

#: Phase 2B 的 episode 生产计划（会被 production contract freeze 哈希）。
#:
#: **surface 多样性**是 brief §41 认可的乘数（"同一 world 允许多个 surface forms"）：
#: 同一个 (world, action, evidence_view) 用多种 transport / API style 呈现，真值由
#: Oracle 逐次重算。分配原则——**承载判决的家族给满 surface，承载证据可见性的家族只给
#: transport**：
#:
#: * ``base`` / ``critical_intervention``：8 renderer × 3 style。判决就在这些 episode 里，
#:   让模型在 HTTP / GraphQL / RPC 上都认出同一个安全态势，正是要训的泛化。
#: * ``irrelevant_perturbation`` / ``evidence_masked``：8 renderer × 1 style。它们的信号是
#:   "证据可见性/表面噪声"，把 style 再乘三倍只是同一种信号重复三遍，稀释而非增富。
#: * ``trust_provenance_variant``：1 renderer。它的信号是"这条断言换了出处"。
DEFAULT_PLAN: dict[str, Any] = {
    "renderers": [
        "http_request", "structured_state", "reverse_proxy_log", "application_log",
        "audit_log", "api_gateway_record", "multi_event_trace", "mixed_evidence_bundle",
    ],
    "styles": ["rest", "graphql", "rpc"],
    #: 铺满 (renderer × style) 的家族；其余家族只铺 renderer（style = "rest"）。
    "full_surface_families": ["base", "critical_intervention"],
    #: ``trust_provenance_variant`` 每世界的上限（候选通常 6–12 个，取排序后前 N 个，
    #: 确定性可复算；其余记进 skipped，不静默丢弃）。
    "trust_provenance_variants_per_world": 3,
    #: 只在一个 renderer 上生产的家族（避免同一种证据属性变化被 8 个 surface 重复 8 遍，
    #: 那只会稀释而不是增富）。
    "trust_provenance_renderer": "http_request",
}


def _plan(path: Path | None) -> dict[str, Any]:
    if path is None:
        return dict(DEFAULT_PLAN)
    loaded = json.loads(path.read_text(encoding="utf-8"))
    plan = dict(DEFAULT_PLAN)
    plan.update(loaded)
    return plan


def release_episode_id(document: Mapping[str, Any], *, renderer: str, style: str) -> str:
    """release 层的 episode id：engine id + surface（可逐字重算）。"""
    from security_world.model import stable_hash

    digest = stable_hash({
        "engine_episode_id": str(document.get("episode_id") or ""),
        "renderer": renderer,
        "style": style,
    })
    return f"EP-{digest[:16]}"


def expand_world(
    spec_document: Mapping[str, Any],
    *,
    config_document: Mapping[str, Any],
    plan: Mapping[str, Any],
) -> dict[str, Any]:
    """把一个 world spec 展开成它的全部 episode（确定性，无 LLM）。"""
    cfg = ExpansionConfig.from_config(config_document)
    spec = WorldSpec.from_document(spec_document)
    renderers: Sequence[str] = tuple(plan["renderers"])
    styles: Sequence[str] = tuple(plan["styles"])
    full_surface: frozenset[str] = frozenset(plan["full_surface_families"])
    trust_renderer = str(plan["trust_provenance_renderer"])
    trust_limit = int(plan["trust_provenance_variants_per_world"])

    episodes: list[Mapping[str, Any]] = []
    skipped: list[Mapping[str, Any]] = []
    per_surface: dict[str, int] = {}
    per_family: dict[str, int] = {}
    family_id: str | None = None
    seen_ids: dict[str, str] = {}

    def emit(document: Mapping[str, Any], *, renderer: str, style: str) -> None:
        #: surface 进 episode_id：engine 的 ``_derive_episode_id`` 只哈希
        #: (world, family, variant_type, action, intervention, variant_key)，**不含
        #: renderer/style**——Phase 1/2A 每族只用一个 renderer 所以从没撞过；一旦铺满
        #: surface，同一个 base 变体就会拿到 8 个一模一样的 episode_id（实测 304 条
        #: episode 只有 49 个不同 id）。release 的 id 因此在驱动层补上 surface，
        #: 第三方拿着 episode 文档 + surface 就能逐字重算。
        document = dict(document)
        document["episode_id"] = release_episode_id(document, renderer=renderer, style=style)
        previous = seen_ids.get(document["episode_id"])
        if previous is not None:
            raise SystemExit(
                f"episode_id 碰撞: {document['episode_id']} 同时属于 {previous} 与 "
                f"{document['world_id']}/{document['variant_type']}"
            )
        seen_ids[document["episode_id"]] = (
            f"{document['world_id']}/{document['variant_type']}"
        )
        episodes.append(document)
        per_family[document["variant_type"]] = per_family.get(document["variant_type"], 0) + 1
        per_surface[f"{renderer}/{style}"] = per_surface.get(f"{renderer}/{style}", 0) + 1

    for renderer_name in renderers:
        for style in styles:
            result = expand_family(
                spec, config=cfg, compile_config=config_document,
                renderer=renderer_name, style=style,
            )
            family_id = result.family_id
            for episode in result.variants:
                if style != "rest" and episode.variant_type not in full_surface:
                    continue
                emit(episode.to_document(), renderer=renderer_name, style=style)
            for item in result.skipped:
                skipped.append({
                    "renderer": renderer_name, "style": style, **dict(item),
                })

            if renderer_name == trust_renderer and style == "rest":
                added, dropped = _trust_provenance_episodes(
                    spec, result=result, config=cfg, config_document=config_document,
                    renderer=renderer_name, limit=trust_limit,
                )
                for episode in added:
                    emit(episode.to_document(), renderer=renderer_name, style="rest")
                skipped.extend(dropped)

    return {
        "world_id": spec.world_id,
        "counterfactual_family_id": family_id,
        "episodes": episodes,
        "episode_count": len(episodes),
        "per_surface": per_surface,
        "per_family": per_family,
        "skipped": skipped,
    }


def _trust_provenance_episodes(
    spec: WorldSpec,
    *,
    result: Any,
    config: ExpansionConfig,
    config_document: Mapping[str, Any],
    renderer: str,
    limit: int,
) -> tuple[list[Any], list[Mapping[str, Any]]]:
    """在同一批 (world, action) 上追加 ``trust_provenance_variant`` episodes。"""
    from security_world.expansion.masking import consulted_facts_from_output

    world = result.world
    base_episode = result.variants[0]
    action = _action_from_spec(spec, world)
    timeline = _timeline_from_spec(spec, world, action)
    current_event = _decision_event(timeline, spec)
    base_view = EvidenceView.from_world(world)
    base_output = run_oracle(world, action, base_view)
    consulted = consulted_facts_from_output(base_output)

    added: list[Any] = []
    dropped: list[Mapping[str, Any]] = []
    candidates = candidate_variants(base_view, consulted)
    for candidate in candidates[:limit]:
        variant_view = apply_variant(base_view, candidate)
        variant_output = run_oracle(world, action, variant_view)
        effect = observable_effect(base_output, variant_output)
        observation = render(
            world,
            action,
            renderer=renderer,
            seed=world.seed,
            allowlist=config.projection_allowlist,
            style="rest",
            timeline=timeline,
            evidence_view=variant_view,
        )
        intervention = with_actual_effect(
            Intervention(
                intervention_variable=candidate.intervention_variable,
                before={
                    "source": candidate.from_source,
                    "provenance": candidate.from_provenance,
                    "trust_level": candidate.from_trust,
                    "freshness": candidate.from_freshness,
                },
                after={
                    "source": candidate.to_source,
                    "provenance": candidate.to_provenance,
                    "trust_level": candidate.to_trust,
                    "freshness": candidate.to_freshness,
                },
                expected_effect="observable_downgrade",
            ),
            effect,
        )
        try:
            episode = assemble_episode(
                world=world,
                spec=spec,
                family_id=result.family_id,
                variant_type="trust_provenance_variant",
                action=action,
                timeline=timeline,
                observation=observation,
                oracle_output=variant_output,
                evidence_view=variant_view,
                intervention=intervention,
                current_event=current_event,
                variant_key=variant_key(candidate),
            )
        except Exception as exc:  # noqa: BLE001 - reason code 原样记录，不静默丢弃
            dropped.append({
                "variant": "trust_provenance_variant",
                "variant_key": variant_key(candidate),
                "reason": getattr(exc, "reason_code", type(exc).__name__),
                "detail": str(exc)[:200],
            })
            continue
        added.append(episode)
    for candidate in candidates[limit:]:
        dropped.append({
            "variant": "trust_provenance_variant",
            "variant_key": variant_key(candidate),
            "reason": "per_world_limit",
        })
    return added, dropped


def _read_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                yield json.loads(line)


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 2B 正式 episode 展开")
    parser.add_argument("--worlds", required=True, help="accepted worlds JSONL（含 spec_document）")
    parser.add_argument("--config", default="configs/phase2a.json")
    parser.add_argument("--plan", default="configs/phase2b-episodes.json",
                        help="episode 生产计划 JSON（会被 production contract freeze 哈希）")
    parser.add_argument("--out", required=True, help="输出 episodes JSONL")
    parser.add_argument("--report", default=None, help="每世界展开报告 JSONL")
    parser.add_argument("--limit", type=int, default=None, help="只处理前 N 个世界（试跑用）")
    args = parser.parse_args()

    config_document = json.loads((ROOT / args.config).read_text(encoding="utf-8"))
    plan = _plan(Path(args.plan) if args.plan else None)
    out_path = ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    report_path = ROOT / args.report if args.report else None
    if report_path is not None:
        report_path.parent.mkdir(parents=True, exist_ok=True)

    total = 0
    worlds = 0
    per_family: dict[str, int] = {}
    with out_path.open("w", encoding="utf-8", newline="\n") as out_handle:
        for index, record in enumerate(_read_jsonl(ROOT / args.worlds), start=1):
            if args.limit is not None and index > args.limit:
                break
            spec_document = record.get("spec_document") or record.get("spec")
            if not isinstance(spec_document, Mapping):
                raise SystemExit(f"第 {index} 条记录没有 spec_document")
            summary = expand_world(
                spec_document, config_document=config_document, plan=plan
            )
            for episode in summary["episodes"]:
                out_handle.write(json.dumps(episode, ensure_ascii=False, sort_keys=True) + "\n")
            total += summary["episode_count"]
            worlds += 1
            for family, count in summary["per_family"].items():
                per_family[family] = per_family.get(family, 0) + count
            if report_path is not None:
                with report_path.open("a", encoding="utf-8", newline="\n") as report_handle:
                    report_handle.write(json.dumps({
                        "world_id": summary["world_id"],
                        "counterfactual_family_id": summary["counterfactual_family_id"],
                        "episode_count": summary["episode_count"],
                        "per_surface": summary["per_surface"],
                        "per_family": summary["per_family"],
                        "skipped": summary["skipped"],
                    }, ensure_ascii=False, sort_keys=True) + "\n")
            print(
                f"world {index}: {summary['world_id']} episodes={summary['episode_count']} "
                f"families={summary['per_family']}"
            )

    print(json.dumps({
        "worlds": worlds,
        "episodes": total,
        "episodes_per_world": round(total / worlds, 2) if worlds else 0,
        "per_family": dict(sorted(per_family.items())),
        "renderers": plan["renderers"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
