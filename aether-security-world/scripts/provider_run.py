"""Phase 1.5 真实 provider 批处理 runner（brief D/E/F/G/J/N）。

用法（全部在 aether-security-world/ 下）：::

    py -3 scripts/provider_run.py smoke      --live   # 第一批 5 个 raw worlds
    py -3 scripts/provider_run.py extend     --live   # 累计到 20 raw
    py -3 scripts/provider_run.py milestone  --live   # 到 100 accepted 或 raw>250

链路（每个批次）：coverage plan → Step-5-pre 生成 → parse → normalize → compile →
gate validation → structural dedup → accept/quarantine/reject → coverage 更新 →
checkpoint。产物路径全部落盘（brief N），随时可中断续跑。

诚实性规则：
* ``--live`` 是显式 opt-in；缺它一律拒绝发网络请求（凭据只从环境读）。
* 每批前重算 prompt/schema 哈希，与 ``state/frozen-versions.json`` 不一致即中止
  （brief C：不一边生成一边无版本地改 prompt）。
* token 数只用 provider usage；失败分类逐字记录；不修 JSON、不猜语义。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any, Mapping, Sequence

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from analysis.pipeline import BindsIncompleteError, _family_key, expand_handcrafted_world  # noqa: E402
from generation.parser import parse_world_specs  # noqa: E402
from generation.prompts import load_prompt  # noqa: E402
from generation.step5.live import LiveProviderError, LiveStep5Client  # noqa: E402
from security_world.expansion.config import ExpansionConfig  # noqa: E402
from security_world.model import WorldSpec  # noqa: E402
from security_world.model.compile import CompileError, compile_spec  # noqa: E402
from security_world.model.config import load_default_config  # noqa: E402
from security_world.validation import run_dataset_gates, unsupported_families  # noqa: E402
from worlds.registry import HandcraftedWorld  # noqa: E402

#: brief H 的覆盖配额（允许交叉计数，达不到如实记录）。
CATEGORY_QUOTAS = {
    "authorization": (10, 15),
    "session": (8, 12),
    "token": (10, 15),
    "workflow": (12, 18),
    "cache_distributed": (8, 12),
    "multi_tenant": (6, 10),
    "trust_boundary": (8, 12),
    "temporal_history": (8, 12),
    "cross_flow_reuse": (8, 12),
}
#: brief I 的复杂度配额。
COMPLEXITY_QUOTAS = {"simple": (15, 20), "medium": (40, 45), "complex": (30, 35), "very_complex": (5, 10)}
#: attack_family 枚举 -> 覆盖类别（一个 family 只属一个主类别；交叉计数在审计脚本里做）。
FAMILY_CATEGORY = {
    "idor_bola": "authorization", "horizontal_privesc": "authorization", "vertical_privesc": "authorization",
    "stale_authorization": "authorization", "owner_mismatch": "authorization",
    "revoked_session_reuse": "session", "stale_session_privilege": "session",
    "cross_account_session_misuse": "session", "session_after_password_reset": "session",
    "session_after_account_disable": "session",
    "token_replay": "token", "one_time_token_reuse": "token", "scope_mismatch": "token",
    "audience_mismatch": "token", "privilege_version_mismatch": "token", "token_lineage_confusion": "token",
    "cross_workflow_token_reuse": "cross_flow_reuse", "cross_resource_token_reuse": "cross_flow_reuse",
    "workflow_bypass": "workflow", "invalid_state_transition": "workflow", "repeated_operation": "workflow",
    "skipping_required_step": "workflow", "irreversible_state_reversal": "workflow",
    "state_machine_confusion": "workflow",
    "stale_permission_cache": "cache_distributed", "inconsistent_revocation_state": "cache_distributed",
    "stale_ownership_cache": "cache_distributed", "cache_invalidation_failure": "cache_distributed",
    "inconsistent_replicas": "cache_distributed",
    "tenant_isolation_violation": "multi_tenant", "tenant_mismatch": "multi_tenant",
    "ssrf": "trust_boundary", "prompt_injection": "trust_boundary", "unsafe_deserialization": "trust_boundary",
    "race_sensitive_state": "temporal_history", "stale_object_reference": "temporal_history",
    "sql_injection": "traditional_payload", "command_injection": "traditional_payload",
    "path_traversal": "traditional_payload", "xss": "traditional_payload", "benign": "benign",
}
DOMAINS = [
    "e-commerce", "cloud_storage", "saas", "school_system", "finance_workflow", "ticketing",
    "logistics", "healthcare_workflow", "hr_system", "devops_platform", "code_hosting", "crm",
    "iam_system", "iot_management", "industrial_management", "api_marketplace", "content_platform",
    "messaging", "project_management", "subscription_system",
]
#: 每个类别的代表 attack_family（覆盖指令用）。
CATEGORY_FAMILIES: dict[str, list[str]] = {}
for _family, _category in FAMILY_CATEGORY.items():
    CATEGORY_FAMILIES.setdefault(_category, []).append(_family)


def _canonical(document: Mapping[str, Any]) -> str:
    return json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def classify_complexity(spec: Mapping[str, Any]) -> str:
    """确定性的复杂度分桶（brief I）：按结构特征计数，不靠模型自报。"""
    score = 0
    score += 2 * len(spec.get("actors") or [])
    score += 2 * len(spec.get("sessions") or [])
    score += 2 * len(spec.get("tokens") or [])
    score += len(spec.get("resources") or [])
    score += len(spec.get("policies") or [])
    score += 2 * len(spec.get("invariants") or [])
    score += len(spec.get("evidence") or [])
    score += 2 * len(spec.get("caches") or [])
    score += 2 * len(spec.get("trust_boundaries") or [])
    score += len(spec.get("state_history") or [])
    template = (spec.get("episode_templates") or [{}])[0]
    score += len(template.get("events") or [])
    if score <= 20:
        return "simple"
    if score <= 40:
        return "medium"
    if score <= 70:
        return "complex"
    return "very_complex"


def structural_signature(spec: Mapping[str, Any]) -> str:
    """canonical 结构签名（brief K）：剥掉行业名/实体名/endpoint 名后的骨架。"""
    invariant_categories = sorted(
        str(item.get("category") or item.get("invariant_id") or "?") for item in spec.get("invariants") or []
    )
    critical_fields = sorted(
        ".".join(str(path).split(".")[2:]) or str(path) for path in spec.get("critical_state_variables") or []
    )
    topology = sorted(
        (
            len((workflow.get("states") or [])),
            len((workflow.get("transitions") or [])),
        )
        for workflow in spec.get("workflows") or []
    )
    shape = (
        len(spec.get("actors") or []), len(spec.get("resources") or []),
        len(spec.get("sessions") or []), len(spec.get("tokens") or []),
        len(spec.get("evidence") or []), len(spec.get("state_history") or []),
        len(spec.get("policies") or []), len(spec.get("trust_boundaries") or []),
    )
    signature = {
        "invariant_categories": invariant_categories,
        "critical_fields": critical_fields,
        "workflow_topology": topology,
        "entity_shape": shape,
        "attack_family": spec.get("attack_family"),
    }
    return _sha256_text(_canonical(signature))


class RunState:
    """断点续跑的全部累积状态（每批后重写 checkpoint）。"""

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        #: 正式 run（provider-run-001）用 brief N 规定的规范文件名；其它 run-id 加后缀隔离。
        suffix = "" if run_id == "provider-run-001" else f"-{run_id}"
        self.progress_path = ROOT / "state" / f"provider-progress{suffix}.json"
        self.coverage_path = ROOT / "state" / f"provider-coverage{suffix}.json"
        self.raw_path = ROOT / "worlds" / "raw" / f"{run_id}.jsonl"
        self.frames_path = ROOT / "worlds" / "raw" / f"frames-{run_id}.jsonl"
        self.accepted_path = ROOT / "worlds" / "accepted" / f"milestone-1-100{suffix}.jsonl"
        self.rejected_path = ROOT / "worlds" / "rejected" / f"{run_id}.jsonl"
        self.quarantine_path = ROOT / "worlds" / "quarantine" / f"{run_id}.jsonl"
        self.provenance_path = ROOT / "provenance" / f"{run_id}.json"
        for path in (self.raw_path, self.accepted_path, self.rejected_path, self.quarantine_path):
            path.parent.mkdir(parents=True, exist_ok=True)
        self.progress = self._load(self.progress_path, {
            "run_id": run_id, "batches": 0, "raw_worlds": 0, "accepted": 0, "rejected": 0,
            "quarantined": 0, "parse_failures": 0, "schema_failures": 0, "compile_failures": 0,
            "oracle_failures": 0, "duplicates": 0, "structural_duplicates": 0,
            "input_tokens": 0, "output_tokens": 0, "latency_s": 0.0, "retries": 0,
            "usage_missing_calls": 0, "provider_errors": 0,
            "world_ids": [], "structural_signatures": [], "rejection_reasons": {},
        })
        self.coverage = self._load(self.coverage_path, {
            "categories": {}, "complexity": {}, "domains": {}, "families": {},
            "unsupported_families": [],
        })

    @staticmethod
    def _load(path: Path, default: dict[str, Any]) -> dict[str, Any]:
        if path.is_file():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return default
        return default

    def append_jsonl(self, path: Path, record: Mapping[str, Any]) -> None:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")

    def save(self) -> None:
        self.progress_path.write_text(
            json.dumps(self.progress, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        self.coverage_path.write_text(
            json.dumps(self.coverage, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    def bump_reason(self, reason: str) -> None:
        reasons = self.progress["rejection_reasons"]
        reasons[reason] = int(reasons.get(reason, 0)) + 1


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    """读一个 JSONL 文件为记录列表；不存在返回空表。"""
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


def coverage_directive(coverage: Mapping[str, Any], batch_size: int,
                       used_world_ids: Sequence[str] = ()) -> str:
    """本批的覆盖指令：缺口最大的类别优先，领域轮换，复杂度均衡。"""
    categories = coverage.get("categories") or {}
    deficits = []
    for category, (low, _high) in CATEGORY_QUOTAS.items():
        have = int(categories.get(category, 0))
        if have < low:
            deficits.append((low - have, category))
    deficits.sort(reverse=True)
    chosen = [category for _gap, category in deficits[:3]] or ["workflow", "authorization", "session"]
    families: list[str] = []
    for category in chosen:
        families.extend(CATEGORY_FAMILIES.get(category, [])[:3])
    domains = coverage.get("domains") or {}
    least_used = sorted(DOMAINS, key=lambda name: int(domains.get(name, 0)))[:4]
    complexity = coverage.get("complexity") or {}
    complexity_targets = sorted(COMPLEXITY_QUOTAS, key=lambda level: int(complexity.get(level, 0)))[:2]
    return (
        "## Coverage directive (this batch only; the contract above is unchanged)\n"
        f"- Produce {batch_size} world seeds.\n"
        f"- Prioritise these attack_family values: {', '.join(sorted(set(families)))}.\n"
        f"- Use application domains not yet over-represented, e.g.: {', '.join(least_used)}.\n"
        f"- Target complexity mix: {', '.join(complexity_targets)} "
        "(simple = one actor, one resource, one policy, few invariants; "
        "very_complex = multiple actors/sessions/tokens/caches/trust boundaries and long history).\n"
        "- Include sessions/tokens/caches/trust_boundaries ONLY when the security story needs them; "
        "an empty optional collection is better than a decorative one.\n"
        "- Every world must be independently formalisable: canonical ID-view critical_state_variables, "
        "at least one invariant with a machine-checkable condition, and episode_templates events with binds."
        # 已用 ID 黑名单：没有它，模型对同一领域稳定复用自己过去的 world_id
        # （实测 W-CRM-001 被重复生成 3 次；大小写变体绕过唯一性检查后撞结构签名），
        # 每批都在为重复 ID 烧 output token。
        + ("\n- These world_ids are ALREADY TAKEN (earlier batches). Reusing any of them — or a "
           "case/plural/separator variant of one — rejects the element. Pick fresh ids: "
           + ", ".join(sorted(set(used_world_ids))[:400])
           if used_world_ids else "")
        # 已覆盖的 (domain, family) 组合：要求真新场景而非改名重填。
        + ("\n- These application_domain/attack_family combinations already exist. Do NOT re-issue a "
           "renamed version of a covered combination; find a genuinely different scenario (different "
           "resource lifecycle, different trust relation, different failure mechanism): "
           + ", ".join(sorted(coverage.get("domain_family_pairs") or {})) [:60]
           if coverage.get("domain_family_pairs") else "")
    )


def verify_frozen() -> dict[str, Any]:
    """brief C：run 中途 prompt/schema 不许无版本地变。"""
    frozen_path = ROOT / "state" / "frozen-versions.json"
    if not frozen_path.is_file():
        raise SystemExit("state/frozen-versions.json 不存在：先跑 py -3 scripts/freeze_versions.py")
    frozen = json.loads(frozen_path.read_text(encoding="utf-8"))
    prompt = load_prompt(frozen["prompt_version"])
    prompt_path = ROOT / "generation" / "prompts" / f"v{frozen['prompt_version']}.md"
    prompt_sha = _sha256_file(prompt_path)
    if prompt_sha != frozen["prompt_sha256"] or prompt.prompt_hash != frozen["prompt_hash"]:
        raise SystemExit(
            "RUN INVALID：prompt 与冻结值不一致。按 brief C：停止本 run、升级 prompt_version、"
            "重新 freeze 后再来；不得一边生成一边改 prompt。"
        )
    schemas_dir = ROOT / "schemas"
    entries = [
        {"file": p.name, "sha256": _sha256_file(p)} for p in sorted(schemas_dir.glob("*.schema.json"))
    ]
    bundle = _sha256_text(json.dumps(entries, ensure_ascii=False, sort_keys=True))
    if bundle != frozen["schema_bundle_sha256"]:
        raise SystemExit(
            "RUN INVALID：schema bundle 与冻结值不一致。停止本 run，修 schema 后重新 freeze；"
            "已产出的批次标记为 mixed-version，不得并入同一 release。"
        )
    config_sha = _sha256_file(ROOT / "configs" / "default.json")
    if config_sha != frozen.get("config_sha256"):
        raise SystemExit(
            "RUN INVALID：configs/default.json 与冻结值不一致（配置与 prompt/schema 一样是 run 级契约）。"
            "停止本 run，改配置后重新 freeze。"
        )
    return frozen


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


#: VirtualClock 基准时刻（逻辑时钟，非墙钟；只进 provenance）。
_VIRTUAL_EPOCH = None  # 惰性构造，见 _logical_instant


def _logical_instant(batch_index: int) -> str:
    """按批次索引推进的逻辑时钟（每批 +1 分钟），确定性、可复现。"""
    import datetime as _dt

    global _VIRTUAL_EPOCH
    if _VIRTUAL_EPOCH is None:
        _VIRTUAL_EPOCH = _dt.datetime(2026, 9, 21, tzinfo=_dt.timezone.utc)
    return (_VIRTUAL_EPOCH + _dt.timedelta(minutes=max(batch_index, 0))).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_client(args: argparse.Namespace, frozen: Mapping[str, Any], *, start_index: int):
    """按显式 opt-in 选择客户端：--live 走真实 provider，--replay-fixtures 走录播（零网络）。"""
    if args.live and args.replay_fixtures:
        raise SystemExit("--live 与 --replay-fixtures 互斥：一次 run 只能有一个 provider。")
    if args.replay_fixtures:
        from generation.step5.replay import ReplayClient

        return ReplayClient(Path(args.replay_fixtures))
    if not args.live:
        raise SystemExit(
            "未传 --live（或 --replay-fixtures）：真实 provider 调用需要显式 opt-in（brief D）。"
            "录播回放用 --replay-fixtures generation/fixtures/synthetic。"
        )
    return LiveStep5Client(
        opt_in=True,
        run_id=args.run_id,
        prompt_version=str(frozen["prompt_version"]),
        prompt_hash=str(frozen["prompt_hash"]),
        temperature=args.temperature,
        top_p=args.top_p,
        reasoning_effort=args.reasoning_effort,
        max_retries=args.max_retries,
        start_index=start_index,
    )


#: REVISION 3（P1-8）：observable_decision 的降级标签集合。世界里**每个** base 变体
#: 的 observable_decision 都只有这个标签（标签熵过低：只有 1 种且为 insufficient）时，
#: 世界降级为 quarantine（reason ``single_label_world_all_insufficient``）——一个所有
#: 观测都弃权的世界对训练没有信号，也不该占用 accepted 配额。
SINGLE_LABEL_QUARANTINE_LABELS: frozenset[str] = frozenset({"insufficient_evidence"})


def observable_label_set(episodes: Sequence[Any]) -> frozenset[str]:
    """世界全部 **base** 变体出现的 observable_decision 集合（纯函数）。

    只看 base 变体：干预/扰动/掩蔽变体的标签按构造会变，用它们算"标签多样性"度量
    的是变体结构而不是世界能表达多少判决。集合是 ``{"insufficient_evidence"}`` 的
    单元素集 ⇒ 这个世界每个可观测决策都是弃权。
    """
    labels: set[str] = set()
    for episode in episodes:
        variant_type = getattr(episode, "variant_type", None)
        if variant_type is None and isinstance(episode, Mapping):
            variant_type = episode.get("variant_type")
        if variant_type != "base":
            continue
        output = getattr(episode, "oracle_output", None)
        if output is None and isinstance(episode, Mapping):
            output = episode.get("oracle_output")
        if isinstance(output, Mapping):
            labels.add(str(output.get("observable_decision")))
        elif output is not None:
            labels.add(str(getattr(output, "observable_decision", "")))
    return frozenset(labels)


def merge_unsupported_families(
    coverage: dict[str, Any], results: Sequence[Any]
) -> list[dict[str, Any]]:
    """把本世界的 unsupported 族并进 coverage（幂等，按 (kind, family, world_id) 去重）。

    REVISION 3（P0-3）：``coverage["unsupported_families"]`` 此前是静态 ``[]``——
    "没算过"被显示成"没有"。现在按世界实算 witness 级可达性（
    :func:`security_world.validation.unsupported_families`）并如实累积。unsupported
    族**不拒收**（语料可合法携带故意越界的不变量来训练 skipped 路径），只报告。
    """
    existing = {
        (str(row.get("kind")), str(row.get("family")), str(row.get("world_id")))
        for row in coverage.get("unsupported_families") or ()
        if isinstance(row, dict)
    }
    merged = list(coverage.get("unsupported_families") or ())
    for result in results:
        document = result.to_document() if hasattr(result, "to_document") else dict(result)
        key = (str(document.get("kind")), str(document.get("family")), str(document.get("world_id")))
        if key in existing:
            continue
        existing.add(key)
        merged.append(document)
    coverage["unsupported_families"] = merged
    return merged


def process_world(
    spec_document: Mapping[str, Any],
    *,
    state: RunState,
    batch_meta: Mapping[str, Any],
    world_number: int,
    renderer: str,
) -> str:
    """单个 world 的 normalize→compile→expand→gates→dedup。返回 accepted/quarantined/rejected。"""
    world_id = str(spec_document.get("world_id") or "?")
    if world_id in state.progress["world_ids"]:
        state.progress["rejected"] += 1
        state.bump_reason("duplicate_world_id")
        state.append_jsonl(state.rejected_path, {
            "world_id": world_id, "reason": "duplicate_world_id", "batch": batch_meta["raw_generation_id"],
        })
        return "rejected"

    signature = structural_signature(spec_document)
    if signature in state.progress["structural_signatures"]:
        state.progress["quarantined"] += 1
        state.bump_reason("structural_duplicate")
        state.append_jsonl(state.quarantine_path, {
            "world_id": world_id, "reason": "structural_duplicate", "structural_signature": signature,
            "batch": batch_meta["raw_generation_id"],
        })
        return "quarantined"

    try:
        spec = WorldSpec.from_document(dict(spec_document))
    except Exception as exc:  # ModelError 及其子类
        state.progress["rejected"] += 1
        state.progress["schema_failures"] += 1
        state.bump_reason("schema_invalid")
        state.append_jsonl(state.rejected_path, {
            "world_id": world_id, "reason": "schema_invalid", "detail": str(exc)[:500],
            "batch": batch_meta["raw_generation_id"],
        })
        return "rejected"

    try:
        instance = compile_spec(spec, seed=int(spec_document.get("seed") or 0))
    except CompileError as exc:
        state.progress["rejected"] += 1
        state.progress["compile_failures"] += 1
        state.bump_reason(exc.reason_code if hasattr(exc, "reason_code") else "compile_error")
        state.append_jsonl(state.rejected_path, {
            "world_id": world_id, "reason": "compile_error",
            "reason_code": getattr(exc, "reason_code", "compile_error"), "detail": str(exc)[:500],
            "batch": batch_meta["raw_generation_id"],
        })
        return "rejected"

    handcrafted = HandcraftedWorld(
        directory=world_id, number=world_number,
        spec_path=ROOT / "worlds" / "raw" / f"{world_id}.json",
        expected_path=ROOT / "worlds" / "raw" / f"{world_id}.expected.md",
        spec_document=dict(spec_document), expectations={},
    )
    try:
        expansion = expand_handcrafted_world(
            handcrafted, config=ExpansionConfig.default(), renderers=(renderer,)
        )
    except BindsIncompleteError as exc:
        state.progress["quarantined"] += 1
        state.bump_reason("binds_missing_" + str(exc.missing))
        state.append_jsonl(state.quarantine_path, {
            "world_id": world_id, "reason": "binds_incomplete", "missing": str(exc.missing),
            "detail": str(exc)[:500], "batch": batch_meta["raw_generation_id"],
        })
        return "quarantined"
    except Exception as exc:
        state.progress["quarantined"] += 1
        state.bump_reason("expansion_error")
        state.append_jsonl(state.quarantine_path, {
            "world_id": world_id, "reason": "expansion_error", "detail": str(exc)[:500],
            "batch": batch_meta["raw_generation_id"],
        })
        return "quarantined"

    episodes = list(expansion.episodes)
    families = {_family_key(view): view for view in expansion.families}
    report = run_dataset_gates(
        episodes, families=families, worlds={expansion.world_id: expansion.instance},
        declared_attack_families={expansion.world_id: str(spec_document.get("attack_family") or "")},
    )
    if not report.passed:
        codes = sorted({item.gate for item in report.failures})
        if "G4_oracle_determinism" in codes:
            state.progress["oracle_failures"] += 1
        state.progress["quarantined"] += 1
        for gate in codes:
            state.bump_reason("gate_" + gate)
        state.append_jsonl(state.quarantine_path, {
            "world_id": world_id, "reason": "gate_failure", "gates": codes,
            "detail": [f"{item.gate}:{item.detail}" for item in report.failures][:6],
            "episode_count": len(episodes), "batch": batch_meta["raw_generation_id"],
        })
        return "quarantined"

    # REVISION 3（P1-8）：每世界标签约束。全部 base 变体的 observable_decision 都是
    # insufficient_evidence（标签熵过低：只有 1 种且为弃权）⇒ 降级 quarantine。
    # 门禁全过也拦：这类世界不是"质量不合格"，是"没有任何可观测判决"——数据集收了
    # 它只会稀释 abstention 类的信号。
    labels = observable_label_set(episodes)
    if labels and labels <= SINGLE_LABEL_QUARANTINE_LABELS:
        state.progress["quarantined"] += 1
        state.bump_reason("single_label_world_all_insufficient")
        state.append_jsonl(state.quarantine_path, {
            "world_id": world_id, "reason": "single_label_world_all_insufficient",
            "labels": sorted(labels), "episode_count": len(episodes),
            "base_variant_count": sum(1 for episode in episodes if episode.variant_type == "base"),
            "batch": batch_meta["raw_generation_id"],
        })
        return "quarantined"

    category = FAMILY_CATEGORY.get(str(spec_document.get("attack_family")), "uncategorized")
    complexity = classify_complexity(spec_document)
    state.progress["accepted"] += 1
    state.progress["world_ids"].append(world_id)
    state.progress["structural_signatures"].append(signature)
    categories = state.coverage["categories"]
    categories[category] = int(categories.get(category, 0)) + 1
    complexity_counts = state.coverage["complexity"]
    complexity_counts[complexity] = int(complexity_counts.get(complexity, 0)) + 1
    domains = state.coverage["domains"]
    domain = str(spec_document.get("application_domain"))
    domains[domain] = int(domains.get(domain, 0)) + 1
    families_count = state.coverage["families"]
    family = str(spec_document.get("attack_family"))
    families_count[family] = int(families_count.get(family, 0)) + 1
    # 已覆盖的 (domain, family) 组合：coverage directive 用它要求“真新场景”，
    # 阻止模型对同领域反复改名重产（多样性瓶颈的实测对策）。
    pairs = state.coverage.setdefault("domain_family_pairs", {})
    pairs[f"{domain}/{family}"] = int(pairs.get(f"{domain}/{family}", 0)) + 1
    # REVISION 3（P0-3）：witness 级族可达性实算进 coverage。无 witness 的族（如
    # W-L4-001 形态：唯一 trust_boundary 不变量 100% skipped_unbound_subject）如实
    # 列出，不拒收、绝不计入"已支持"——只改这一处调用。
    world_unsupported = unsupported_families(
        episodes,
        worlds={expansion.world_id: expansion.instance},
        declared_families={expansion.world_id: family},
    )
    merge_unsupported_families(state.coverage, world_unsupported)
    state.append_jsonl(state.accepted_path, {
        "world_id": world_id,
        "structural_signature": signature,
        "attack_family": family,
        "coverage_category": category,
        "complexity": complexity,
        "application_domain": domain,
        "episode_count": len(episodes),
        "variant_counts": {
            variant: sum(1 for episode in episodes if episode.variant_type == variant)
            for variant in ("base", "critical_intervention", "irrelevant_perturbation", "evidence_masked")
        },
        "world_family_id": expansion.instance.world_family_id,
        "batch": batch_meta["raw_generation_id"],
        "raw_generation_id": batch_meta["raw_generation_id"],
        "spec_document": dict(spec_document),
        "instance_document": expansion.instance.to_document(),
    })
    return "accepted"


def run_batches(args: argparse.Namespace) -> int:
    frozen = verify_frozen()
    state = RunState(args.run_id)
    config = load_default_config()
    generation_cfg = config.get("generation") or {}
    client = build_client(args, frozen, start_index=int(state.progress.get("batches", 0)))
    prompt = load_prompt(str(frozen["prompt_version"]))
    provenance_path = state.provenance_path
    provenance = json.loads(provenance_path.read_text(encoding="utf-8")) if provenance_path.is_file() else {}

    target_raw = args.target_raw
    target_accepted = args.target_accepted
    max_raw = args.max_raw
    started = time.time()
    world_number = int(state.progress["raw_worlds"])
    consecutive_provider_errors = 0
    consecutive_frame_failures = 0

    while True:
        raw_count = int(state.progress["raw_worlds"])
        accepted = int(state.progress["accepted"])
        if target_accepted is not None and accepted >= target_accepted:
            print(f"停止：accepted={accepted} 达到目标 {target_accepted}")
            break
        if target_accepted is None and target_raw is not None and raw_count >= target_raw:
            print(f"停止：raw={raw_count} 达到目标 {target_raw}")
            break
        if raw_count >= max_raw:
            print(f"停止：raw={raw_count} 超过上限 {max_raw}（accepted={accepted}）——"
                  "按 brief F 这说明 generator/validator 存在系统性问题，必须停下来修，"
                  "不允许继续堆 raw。")
            break

        used_ids = [
            str(record.get("world_id"))
            for record in _read_jsonl(state.raw_path)
            if record.get("world_id")
        ]
        directive = coverage_directive(state.coverage, args.batch_size, used_ids)
        if args.replay_fixtures and args.replay_bare_prompt:
            # 录播 fixture 按裸 prompt 录制（ReplayClient 校验 prompt_sha256）；
            # 自检模式下不追加覆盖指令，指令本身仍进 provenance 供审计。
            full_prompt = prompt.text
        else:
            full_prompt = prompt.text + "\n\n" + directive
        batch_started = time.time()
        try:
            raw = client.generate(
                full_prompt, batch_size=args.batch_size, max_output_tokens=args.max_tokens
            )
        except LiveProviderError as exc:
            state.progress["provider_errors"] += 1
            state.bump_reason("provider_transport_error")
            state.append_jsonl(state.rejected_path, {
                "world_id": "?batch", "reason": "provider_transport_error", "detail": str(exc)[:500],
                "batch": "failed-batch",
            })
            state.save()
            consecutive_provider_errors += 1
            backoff = min(5.0 * (2 ** min(consecutive_provider_errors - 1, 5)), 120.0)
            print(f"provider 传输失败（连续第 {consecutive_provider_errors} 次，退避 {backoff:.0f}s）：{exc}")
            if consecutive_provider_errors >= args.max_consecutive_provider_errors:
                print(
                    f"连续 {consecutive_provider_errors} 次 provider 失败，停止本 run。"
                    "凭据/配额问题只能由运行方解决；状态已 checkpoint，恢复后可直接续跑。"
                )
                return 3
            if args.stop_on_provider_error:
                return 2
            time.sleep(backoff)
            continue
        consecutive_provider_errors = 0

        # 调用元数据：live 客户端有 calls 日志；录播客户端没有，从 RawGeneration 取。
        client_calls = getattr(client, "calls", None)
        call = client_calls[-1] if client_calls else {}
        # 原始帧立即落盘（成功帧也要）：帧解析失败时唯一的诊断材料就是这段文本；
        # 录播 fixture 也由它转化（generation/fixtures/recorded/ 的原料）。
        state.append_jsonl(state.frames_path, {
            "raw_generation_id": raw.raw_generation_id,
            "model": raw.model,
            "prompt_version": raw.prompt_version,
            "prompt_hash": raw.prompt_hash,
            "decoding_parameters": dict(raw.decoding_parameters),
            "input_tokens": raw.input_tokens,
            "output_tokens": raw.output_tokens,
            "output_text": raw.output_text,
            "finish_reason": getattr(client, "last_finish_reason", None),
            "coverage_directive_sha256": _sha256_text(directive),
        })
        state.progress["batches"] += 1
        state.progress["input_tokens"] += int(call.get("input_tokens", raw.input_tokens))
        state.progress["output_tokens"] += int(call.get("output_tokens", raw.output_tokens))
        state.progress["latency_s"] = round(
            float(state.progress["latency_s"]) + float(call.get("latency_s", 0.0)), 3)
        state.progress["retries"] += int(call.get("retries", 0))
        state.progress["usage_missing_calls"] += 1 if call.get("usage_missing") else 0

        # VirtualClock：逻辑时间按批次确定性地推进（ provenance 用，不进安全语义）。
        virtual_now = _logical_instant(int(state.progress["batches"]))
        result = parse_world_specs(raw, generation_timestamp=virtual_now)
        batch_meta = {
            "raw_generation_id": raw.raw_generation_id,
            "model": raw.model,
            "input_tokens": call.get("input_tokens", raw.input_tokens),
            "output_tokens": call.get("output_tokens", raw.output_tokens),
            "latency_s": call.get("latency_s", 0.0),
            "retries": call.get("retries", 0),
        }
        # 帧级失败与"全部元素被拒"是两回事：后者帧是好的，只是这个 batch 没有幸存者。
        # 用 batch_rejected 判定帧命运，不用 specs 是否为空——否则会把 5/5 元素拒绝
        # 误记成 frame_decode_failed，接受率统计随之失真。
        if result.batch_rejected:
            state.progress["parse_failures"] += 1
            state.bump_reason("frame_decode_failed")
            state.append_jsonl(state.rejected_path, {
                "world_id": "?batch", "reason": "frame_decode_failed",
                "rejections": [r.to_document() for r in result.rejections][:4],
                "batch": raw.raw_generation_id,
                "output_text_length": len(raw.output_text),
                "finish_reason": getattr(client, "last_finish_reason", None),
            })
            consecutive_frame_failures += 1
            # 截断自适应：finish_reason=length 说明这批 world 数量超出了输出上限，
            # 缩批量（而不是加 token 预算去撞 provider 硬顶）——v0.7 的真实 batch
            # 7/8 帧撞在 32768 上限，减半后每帧成本也同步下降。
            if getattr(client, "last_finish_reason", None) == "length" and args.batch_size > 2:
                args.batch_size = max(2, args.batch_size // 2)
                print(f"帧被输出上限截断（finish_reason=length）：批量自适应降为 {args.batch_size}")
            if consecutive_frame_failures >= args.max_consecutive_frame_failures:
                print(
                    f"连续 {consecutive_frame_failures} 帧解码失败，停止本 run。"
                    "这是 generator 合同/批量配置问题，不是数据问题；状态已 checkpoint。"
                )
                return 4
        else:
            consecutive_frame_failures = 0
            if not result.specs:
                state.bump_reason("batch_all_elements_rejected")
        for rejection in result.rejections:
            state.bump_reason("element_" + str(getattr(rejection, "reason_code", "rejected")))
            state.append_jsonl(state.rejected_path, {
                "world_id": getattr(rejection, "world_id", None),
                "reason": "element_" + str(getattr(rejection, "reason_code", "rejected")),
                "detail": str(getattr(rejection, "detail", ""))[:400],
                "error_paths": list(getattr(rejection, "error_paths", ()) or ())[:20],
                "batch": raw.raw_generation_id,
            })

        for spec_document in result.specs:
            world_number += 1
            state.progress["raw_worlds"] += 1
            state.append_jsonl(state.raw_path, {
                "world_id": spec_document.get("world_id"),
                "attack_family": spec_document.get("attack_family"),
                "application_domain": spec_document.get("application_domain"),
                "complexity": classify_complexity(spec_document),
                "structural_signature": structural_signature(spec_document),
                "raw_generation_id": raw.raw_generation_id,
                "spec_document": dict(spec_document),
            })
            process_world(
                spec_document, state=state, batch_meta=batch_meta,
                world_number=world_number, renderer=args.renderer,
            )

        batch_record = {
            **batch_meta,
            "batch_index": state.progress["batches"],
            "specs_parsed": len(result.specs),
            "element_rejections": len(result.rejections),
            "wallclock_s": round(time.time() - batch_started, 2),
            "prompt_version": str(frozen["prompt_version"]),
            "prompt_sha256": str(frozen["prompt_sha256"]),
            "schema_bundle_sha256": str(frozen["schema_bundle_sha256"]),
            "coverage_directive_sha256": _sha256_text(directive),
        }
        provenance.setdefault("batches", []).append(batch_record)
        provenance_path.write_text(
            json.dumps(provenance, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        state.save()
        print(
            f"batch {state.progress['batches']}: parsed={len(result.specs)} "
            f"rejected_elems={len(result.rejections)} "
            f"raw={state.progress['raw_worlds']} accepted={state.progress['accepted']} "
            f"quarantined={state.progress['quarantined']} "
            f"out_tokens={state.progress['output_tokens']} ({batch_record['wallclock_s']}s)"
        )
        if args.max_batches and state.progress["batches"] >= args.max_batches:
            print(f"停止：本批处理达到 --max-batches {args.max_batches}")
            break

    provenance["validation_outcome"] = "completed" if int(state.progress["accepted"]) > 0 else "no_accepted_worlds"
    provenance["totals"] = {
        "input_tokens": state.progress["input_tokens"],
        "output_tokens": state.progress["output_tokens"],
        "raw_worlds": state.progress["raw_worlds"],
        "accepted": state.progress["accepted"],
        "rejected": state.progress["rejected"],
        "quarantined": state.progress["quarantined"],
        "wallclock_s": round(time.time() - started, 1),
    }
    provenance_path.write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(provenance["totals"], ensure_ascii=False))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 1.5 真实 provider 批处理 runner")
    parser.add_argument("mode", choices=["smoke", "extend", "milestone"])
    parser.add_argument("--live", action="store_true", help="显式 opt-in 真实 provider 调用（缺省拒绝）")
    parser.add_argument("--replay-fixtures", default=None,
                        help="离线自检：用录播 fixture 代替真实调用（显式 opt-in、零网络）")
    parser.add_argument("--replay-bare-prompt", action="store_true",
                        help="仅自检用：不追加覆盖指令，匹配录播 fixture 的 prompt_sha256")
    parser.add_argument("--run-id", default="provider-run-001")
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--max-tokens", type=int, default=32768)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--top-p", type=float, default=0.9)
    parser.add_argument("--reasoning-effort", default="medium", choices=["low", "medium", "high"])
    parser.add_argument("--max-retries", type=int, default=4)
    parser.add_argument("--target-raw", type=int, default=None)
    parser.add_argument("--target-accepted", type=int, default=None)
    parser.add_argument("--max-raw", type=int, default=250)
    parser.add_argument("--max-batches", type=int, default=None)
    parser.add_argument("--renderer", default="http_request")
    parser.add_argument("--stop-on-provider-error", action="store_true")
    parser.add_argument("--max-consecutive-provider-errors", type=int, default=5,
                        help="连续 provider 传输失败达到此次数即停 run（凭据/配额问题不硬刚）")
    parser.add_argument("--max-consecutive-frame-failures", type=int, default=3,
                        help="连续帧解码失败达到此次数即停 run（截断会先触发批量自适应）")
    args = parser.parse_args()

    if args.mode == "smoke":
        args.target_raw = args.target_raw or 5
        args.target_accepted = None
    elif args.mode == "extend":
        args.target_raw = args.target_raw or 20
        args.target_accepted = None
    else:
        args.target_accepted = args.target_accepted or 100
        args.target_raw = None
    return run_batches(args)


if __name__ == "__main__":
    raise SystemExit(main())
