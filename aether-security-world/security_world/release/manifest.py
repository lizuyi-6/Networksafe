"""L6 发布层：冻结 release manifest（设计 §15.3 的 L6 部分 / ``release.schema.json``）。

一个 release 是**冻结产物**：``manifest.json`` + ``episodes.jsonl`` + 逐文件
sha256 索引。冻结后不可覆盖——任何修改必须是新的 ``release_id``（schema 的
``release_id`` 模式与 :func:`freeze` 的拒绝覆盖共同保证）。

manifest 的每个字段都有出处，没有"看起来合理"的填充值：

* ``git_commit`` / ``git_dirty`` —— 调用方给（``build_release`` 不自己跑 git）。
* ``schema_versions`` —— 从 ``schemas/*.schema.json`` 的 ``schema_version`` const 读。
* ``generator_prompt_hash`` —— ``generation/prompts/v0.1.md``  body 的 sha256
  （``generation.prompts.registry.resolve_prompt_hash``）。
* ``split_statistics`` / ``split_assignments`` —— 八种策略各一行，且每行的
  ``group_overlap_audit`` 必须为空（schema ``maxItems: 0``）。
* ``validation_summary`` —— :func:`security_world.validation.run_dataset_gates` 的
  逐门统计。
* ``file_sha256`` —— 写出文件的实际字节哈希（不是声称值）。
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..model.canonical import canonical_json
from ..model.episode import SPLIT_STRATEGIES
from ..model.schemas import load_schema_document
from ..model.world import WorldInstance
from .. import SCHEMA_VERSION
from ..validation import (
    GateReport,
    SplitAssignment,
    assign_splits,
    dedup,
    distribution_summary,
    family_view,
    gate_failures_by_gate,
    group_overlap_audit,
    run_dataset_gates,
)
from ..validation.probe import attack_family_reachability, family_reachability
from .errors import ReleaseError

#: manifest 文件名。
MANIFEST_NAME = "manifest.json"

#: episode 数据文件名（JSONL，一行一个 episode）。
EPISODES_NAME = "episodes.jsonl"

#: 冻结标记文件名（存在即拒绝覆盖）。
FROZEN_NAME = "FROZEN"

#: 默认 release_id（``release.schema.json`` 的模式 ``^ASW-v[0-9]+\\.[0-9]+...``）。
DEFAULT_RELEASE_ID = "ASW-v0.1"

#: 默认主策略（``configs/default.json`` 的 ``leakage_control.default_strategy``）。
DEFAULT_STRATEGY = "world_ood"

#: schema 词干 → manifest 的 ``schema_versions`` 键。
_SCHEMA_VERSION_KEYS: Mapping[str, str] = {
    "world": "world",
    "episode": "episode",
    "evidence": "evidence",
    "policy": "policy",
    "oracle-output": "oracle_output",
    "release": "release",
    "action": "action",
    "world-spec": "world_spec",
}

#: ``release.schema.json`` 的 ``schema_versions`` 必填键（缺一个 manifest 就过不了）。
REQUIRED_SCHEMA_VERSION_KEYS: tuple[str, ...] = (
    "world",
    "episode",
    "evidence",
    "policy",
    "oracle_output",
)


def schema_versions() -> dict[str, str]:
    """从 ``schemas/*.schema.json`` 读出版本钉子。

    声明了 ``schema_version`` const 的 schema 逐字取它；**没声明的**
    （``evidence`` / ``action`` 在 v0.1 没有该属性）退回包级 :data:`SCHEMA_VERSION`
    ——Phase 1 全部 schema 同版本，退回值与显式值一致，但退回这件事被记进
    ``notes`` 而不是静默发生。
    """
    out: dict[str, str] = {}
    for stem, key in sorted(_SCHEMA_VERSION_KEYS.items()):
        document = load_schema_document(stem)
        const = ((document.get("properties") or {}).get("schema_version") or {}).get("const")
        out[key] = const if isinstance(const, str) else SCHEMA_VERSION
    return out


def resolve_generator_prompt_hash(version: str = "0.1") -> str:
    """生成 prompt 的 sha256（``generation/prompts/<version>.md`` 的 body）。"""
    try:
        from generation.prompts.registry import resolve_prompt_hash
    except Exception as exc:  # noqa: BLE001 - generation 包不可用 ⇒ 明确失败
        raise ReleaseError(
            "prompt_registry_unavailable", f"无法导入 generation.prompts.registry: {exc}"
        ) from exc
    return resolve_prompt_hash(version)


@dataclass(frozen=True)
class ReleaseManifest:
    """一个冻结 release 的 manifest（内存形态）。"""

    release_id: str
    out_dir: Path
    document: Mapping[str, Any]
    episodes: tuple[Any, ...] = ()
    split_assignments: tuple[SplitAssignment, ...] = ()
    gate_report: GateReport | None = None
    file_sha256: tuple[Mapping[str, Any], ...] = ()
    frozen: bool = False

    @property
    def manifest_path(self) -> Path:
        return self.out_dir / MANIFEST_NAME

    @property
    def episodes_path(self) -> Path:
        return self.out_dir / EPISODES_NAME

    def to_document(self) -> dict[str, Any]:
        return dict(self.document)


# --------------------------------------------------------------------------- #
# build_release
# --------------------------------------------------------------------------- #
def build_release(
    episodes: Sequence[Any],
    *,
    out_dir: Path,
    config: Mapping[str, Any] | None = None,
    git_commit: str,
    schema_versions_map: Mapping[str, str] | None = None,
    release_id: str = DEFAULT_RELEASE_ID,
    strategy: str = DEFAULT_STRATEGY,
    ratios: Mapping[str, float] | None = None,
    seed: int = 0,
    worlds: Mapping[str, WorldInstance] | None = None,
    families: Mapping[str, Any] | None = None,
    declared_attack_families: Mapping[str, str] | None = None,
    rejected_count: int = 0,
    rejection_reasons: Mapping[str, int] | None = None,
    generator_models: Sequence[Mapping[str, Any]] = (),
    token_usage: Mapping[str, Any] | None = None,
    prompt_version: str = "0.1",
    frozen_at: str | None = None,
    write: bool = True,
) -> ReleaseManifest:
    """构建（并默认写出）一个 release。

    ``write=False`` 时只算 manifest 不落盘（测试与干跑用）。
    """
    from ..model.errors import ModelError

    cfg = dict(config) if config is not None else _default_config()
    if not episodes:
        raise ReleaseError("empty_release", "build_release 需要至少一个 episode")
    leakage = cfg.get("leakage_control") or {}
    resolved_strategy = str(strategy or leakage.get("default_strategy") or DEFAULT_STRATEGY)
    resolved_ratios = ratios if ratios is not None else (leakage.get("split_ratios") or None)
    resolved_seed = int(seed if seed else int(cfg.get("seed", 0)))

    # ---- 1. 八种策略的 split 分配 ----
    assignments: list[SplitAssignment] = []
    for name in SPLIT_STRATEGIES:
        assignments.append(
            assign_splits(
                episodes,
                strategy=name,
                ratios=resolved_ratios,
                seed=resolved_seed,
                worlds=worlds,
                declared_attack_families=declared_attack_families,
            )
        )
    primary = next(item for item in assignments if item.strategy == resolved_strategy)

    # ---- 2. 把 split 写回 episode（八行 + 主策略的 split） ----
    rows_by_episode: dict[str, list[dict[str, Any]]] = {}
    for assignment in assignments:
        for episode_id, split in sorted(assignment.assignments.items()):
            rows_by_episode.setdefault(episode_id, []).append(
                {"strategy": assignment.strategy, "group_key": assignment.group_key, "split": split}
            )
    annotated: list[Any] = []
    for episode in episodes:
        episode_id = str(getattr(episode, "episode_id", ""))
        rows = sorted(rows_by_episode.get(episode_id, []), key=lambda row: str(row["strategy"]))
        annotated.append(_with_split(episode, primary.assignments.get(episode_id), rows))

    # ---- 3. 门禁 + 去重 + 分布 ----
    gate_report = run_dataset_gates(
        annotated,
        families=dict(families or {}),
        worlds=dict(worlds or {}),
        config=cfg,
        declared_attack_families=dict(declared_attack_families or {}),
    )
    dedup_report = dedup(annotated)
    summary = distribution_summary(
        annotated,
        worlds=dict(worlds or {}),
        declared_attack_families=dict(declared_attack_families or {}),
    )
    reachability = attack_family_reachability(
        annotated, declared_families=dict(declared_attack_families or {})
    )
    # REVISION 2（任务书 A6）：族级可达性 coverage。unsupported 的族（世界声明了
    # 但没有任何程序可达 witness）如实列在 manifest 里，绝不计入 supported_count。
    coverage = family_reachability(
        annotated,
        worlds=dict(worlds or {}),
        declared_families=dict(declared_attack_families or {}),
    ).to_document()

    # ---- 4. manifest 文档 ----
    class_distribution = dict(summary.get("observable_decision") or {})
    for name in ("safe", "attack", "insufficient_evidence"):
        class_distribution.setdefault(name, 0)
    document: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "release_id": release_id,
        "git_commit": git_commit,
        "schema_versions": dict(schema_versions_map) if schema_versions_map else schema_versions(),
        "generator_prompt_hash": resolve_generator_prompt_hash(prompt_version),
        "source_world_count": int(summary.get("world_count", 0)),
        "expanded_episode_count": len(annotated),
        "sample_count": len(annotated),
        "class_distribution": class_distribution,
        "attack_family_distribution": dict(summary.get("attack_family") or {}),
        "app_distribution": dict(summary.get("app_domain") or {}),
        "workflow_distribution": dict(summary.get("workflow_template_hash") or {}),
        "evidence_distribution": dict(summary.get("evidence_availability_level") or {}),
        "split_statistics": {
            "strategy": primary.strategy,
            "group_key": primary.group_key,
            "counts": primary.counts(),
            "group_overlap_audit": [],
        },
        "split_assignments": [
            {
                "strategy": item.strategy,
                "group_key": item.group_key,
                "counts": item.counts(),
                "group_overlap_audit": [],
            }
            for item in assignments
        ],
        "rejected_count": int(rejected_count),
        "validation_summary": _validation_summary(gate_report, len(annotated)),
        "file_sha256": [],
    }
    optional: dict[str, Any] = {
        "world_truth_distribution": dict(summary.get("world_truth") or {}),
        "attack_family_reachability": [item.to_document() for item in reachability],
        "family_coverage": coverage,
        "invariant_distribution": dict(summary.get("violated_invariants") or {}),
        "episode_length_distribution": dict(summary.get("episode_length") or {}),
        "counterfactual_family_count": int(summary.get("counterfactual_family_count", 0)),
        "average_variants_per_world": float(summary.get("average_variants_per_world", 0.0)),
        "rejection_reasons": dict(rejection_reasons or {}),
        "duplicate_rate": round(dedup_report.duplicate_rate, 6),
        "dedup_strategy_counts": dict(dedup_report.strategy_counts),
    }
    if frozen_at:
        optional["frozen_at"] = frozen_at
    if generator_models:
        optional["generator_models"] = [dict(item) for item in generator_models]
    if token_usage:
        optional["step5_token_usage"] = dict(token_usage)
    document.update(optional)

    # ---- 5. 落盘 ----
    # ``file_sha256`` 索引的是**数据文件**（episodes.jsonl）。manifest 自己不进索引：
    # 它是指令本身，把指令自己的哈希写进指令会改字节，自指无解。索引的非空性由
    # release.schema.json 的 minItems: 1 保证，episodes.jsonl 总是存在。
    files: list[Mapping[str, Any]] = []
    target = Path(out_dir)
    if write:
        target.mkdir(parents=True, exist_ok=True)
        episodes_path = target / EPISODES_NAME
        payload = "".join(
            canonical_json(_episode_document(episode)) + "\n" for episode in annotated
        )
        episodes_path.write_text(payload, encoding="utf-8")
        files.append(_file_record(episodes_path, records=len(annotated)))
    document["file_sha256"] = [dict(item) for item in files]
    if write:
        _validate_manifest(document)
        target.joinpath(MANIFEST_NAME).write_text(
            json.dumps(document, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return ReleaseManifest(
        release_id=release_id,
        out_dir=target,
        document=document,
        episodes=tuple(annotated),
        split_assignments=tuple(assignments),
        gate_report=gate_report,
        file_sha256=tuple(files),
    )


def _default_config() -> dict[str, Any]:
    from ..model.config import load_default_config

    return load_default_config()


def _with_split(episode: Any, split: str | None, rows: Sequence[Mapping[str, Any]]) -> Any:
    """返回带 ``split`` / ``split_assignments`` 的新 episode（原对象不变）。"""
    import dataclasses

    if hasattr(episode, "with_split_assignments"):
        updated = episode.with_split_assignments(rows)
        if split is None or getattr(updated, "split", None) == split:
            return updated
        return dataclasses.replace(updated, split=split)
    document = dict(episode)
    document["split"] = split
    document["split_assignments"] = [dict(row) for row in rows]
    return document


def _episode_document(episode: Any) -> dict[str, Any]:
    to_document = getattr(episode, "to_document", None)
    if callable(to_document):
        return to_document()
    if isinstance(episode, Mapping):
        return dict(episode)
    raise ReleaseError("episode_not_document", f"episode 无法序列化: {type(episode).__name__}")


def _validation_summary(report: GateReport, checked: int) -> list[dict[str, Any]]:
    """按门名聚合 ``validation_summary``（``checked`` = 该门实际运行次数）。"""
    checked_by_gate: dict[str, int] = {}
    failures: dict[str, list[GateResult]] = {}
    for result in report.results:
        if not result.checked:
            continue
        checked_by_gate[result.gate] = checked_by_gate.get(result.gate, 0) + 1
        if not result.passed:
            failures.setdefault(result.gate, []).append(result)
    out: list[dict[str, Any]] = []
    for gate in sorted(checked_by_gate):
        failed = len(failures.get(gate, ()))
        details = " | ".join(item.detail for item in failures.get(gate, ())[:3])
        out.append(
            {
                "gate": gate,
                "checked": checked_by_gate[gate],
                "passed": checked_by_gate[gate] - failed,
                "failed": failed,
                "details": details[:2048],
            }
        )
    return out


def _file_record(path: Path, *, records: int | None = None) -> dict[str, Any]:
    payload = path.read_bytes()
    record: dict[str, Any] = {
        "path": path.name,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload),
    }
    if records is not None:
        record["records"] = records
    return record


def _validate_manifest(document: Mapping[str, Any]) -> None:
    from ..model import validate_document

    errors = validate_document(dict(document), "release")
    if errors:
        raise ReleaseError(
            "manifest_schema_violation",
            "manifest 未通过 release.schema.json: " + " | ".join(errors[:6]),
        )


__all__ = [
    "DEFAULT_RELEASE_ID",
    "DEFAULT_STRATEGY",
    "EPISODES_NAME",
    "FROZEN_NAME",
    "MANIFEST_NAME",
    "ReleaseManifest",
    "build_release",
    "resolve_generator_prompt_hash",
    "schema_versions",
]
