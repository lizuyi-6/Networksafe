"""Phase 2A / Phase 2B 语义骨架 provider runner（brief §39-§41, §48-§51；2B §6/§7/§23）。

链路（每批）：覆盖指令（硬调度）→ 生成 → JSONL 帧解析 → 逐骨架 §17/schema 预检 →
语义编译 → 世界 spec schema → compile_spec → 展开 → Oracle 复核（先验证伪）→ 语义指纹
去重 → accept/quarantine/reject → 覆盖更新 → checkpoint。

两个契约共用同一条链路，差别只在**身份归属与产物目录**：

====================  ===============================  ==============================
                      Phase 2A（``--contract phase2a``）  production（``--contract production``）
====================  ===============================  ==============================
schema                semantic-skeleton.schema.json    schemas/production/…（无 skeleton_id）
prompt                v0.6                             v0.7（只差 ID 归属）
canonical skeleton_id provider 写的 skeleton_id        程序从语义内容派生
provider 撞 id        拒收（duplicate_skeleton_id）    只记录，绝不拒收（brief §29）
产物目录              worlds/skeletons/…                worlds/production/…
默认 run_id           provider-run-002                  provider-run-production-001
====================  ===============================  ==============================

Phase 2A 是**默认**契约：不传 ``--contract`` 时行为与冻结版逐字节一致。

与 Phase 1 runner 的关键差别：

* **逐元素处理**（brief §40）：一个坏骨架只拒它自己，不再有 ``batch_all_elements_rejected``。
* **先验必须被 Oracle 复核**（brief §35-§36）：``semantic_expectation`` 与 Oracle 轨迹
  矛盾 ⇒ 拒收，绝不改期望值让门变绿。
* **语义指纹去重**（brief §28）：只换业务名的骨架算近重复，进 quarantine。
* **硬覆盖调度 + 停顿检测**（brief §26）：某标签连续若干批零推进就停 run 上报。

诚实性规则（与 Phase 1 一致）：

* ``--live`` 是显式 opt-in；缺它一律拒绝发网络请求，凭据只从环境读。
* 每批前重算 prompt/skeleton-schema/ontology/mechanism/compiler 哈希，与冻结状态
  不一致即中止（brief §56 / 2B §21）。
* token 数只用 provider usage；失败分类逐字记录；不修 JSON、不猜语义。

用法::

    py -3 scripts/skeleton_run.py smoke --live          # 10 个骨架，至少 4 个 multi_tenant
    py -3 scripts/skeleton_run.py round2 --live         # 累计 30 accepted
    py -3 scripts/skeleton_run.py round3 --live         # 累计 60 accepted
    py -3 scripts/skeleton_run.py final --live          # 累计 100 accepted
    py -3 scripts/skeleton_run.py freeze --contract production
    py -3 scripts/skeleton_run.py production --live --contract production --target-accepted 500
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

from generation.schema_registry import world_spec_validator  # noqa: E402
from semantic_skeleton import CompileContext, SemanticSkeletonCompiler, load_skeleton  # noqa: E402
from semantic_skeleton.compiler import SkeletonCompileError  # noqa: E402
from semantic_skeleton.compiler.compiler import classify_history_line  # noqa: E402
from semantic_skeleton.coverage import (  # noqa: E402
    CoverageState,
    advance_stalls,
    coverage_report,
    directive,
    record_world,
    selection_record,
)
from semantic_skeleton.fingerprint import semantic_fingerprint  # noqa: E402
from semantic_skeleton.generator.live import (  # noqa: E402
    AuthCircuitOpen,
    LiveSkeletonClient,
    ProviderError,
)
from semantic_skeleton.generator.parser import parse_skeleton_batch  # noqa: E402
from semantic_skeleton.identity import canonical_skeleton_id  # noqa: E402
from semantic_skeleton.mechanisms import mechanism  # noqa: E402
from semantic_skeleton.skeleton import PRODUCTION_SCHEMA_PATH  # noqa: E402
from semantic_skeleton.validators import verify_compiled_world  # noqa: E402

RUN_ID = "provider-run-002"
#: 001 已因编译器泄漏缺陷（workflow/boundary name 嵌攻击族名）作废，产物隔离在
#: worlds/invalidated-runs/；fresh run 从 002 开始（brief §60/§21：不混版本凑数）。
PRODUCTION_RUN_ID = "provider-run-production-002"
OOD_RUN_ID = "provider-ood-pilot-001"
PHASE2A_CONFIG = ROOT / "configs" / "phase2a.json"
FROZEN_PATH = ROOT / "state" / "phase2a-frozen.json"
PRODUCTION_FROZEN_PATH = ROOT / "state" / "production-frozen.json"
OOD_FROZEN_PATH = ROOT / "state" / "ood-frozen.json"
CONTRACTS = ("phase2a", "production", "ood")
#: 每个契约的 prompt 版本来源（构建脚本）与默认模型。
CONTRACT_PROMPT_BUILDER = {
    "phase2a": "build_skeleton_prompt",
    "production": "build_skeleton_prompt_v07",
    "ood": "build_ood_prompt",
}
CONTRACT_DEFAULT_MODEL = {
    "phase2a": "step-5-preview",
    "production": "step-5-preview",
    #: OOD pilot 的第二生成器：与 step-5-preview 不同的模型（同一供应商，见报告的限制说明）。
    "ood": "step-3.7-flash",
}

#: brief §48：第一个 smoke 的目标。
SMOKE_TARGET_SKELETONS = 10
SMOKE_MIN_MULTI_TENANT = 4
SMOKE_MIN_ACCEPTED = 7


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


#: 每个契约的 prompt 文件名模板。phase2a / production 是 "v0.6" / "v0.7"；
#: OOD pilot 的版本串本身就是 "ood-pilot-v1"（不带 v 前缀），文件名就是它本身。
CONTRACT_PROMPT_FILE = {
    "phase2a": "v{version}.md",
    "production": "v{version}.md",
    "ood": "{version}.md",
}


def _prompt_path_of(contract: str, version: str) -> Path:
    return ROOT / "semantic_skeleton" / "prompts" / CONTRACT_PROMPT_FILE[contract].format(
        version=version
    )


def _prompt_version_of(contract: str) -> str:
    """prompt 版本由构建脚本拥有，这里只读它——手写副本会漂移。"""
    import importlib.util

    builder_name = CONTRACT_PROMPT_BUILDER[contract]
    builder_spec = importlib.util.spec_from_file_location(
        builder_name, ROOT / "scripts" / f"{builder_name}.py"
    )
    builder = importlib.util.module_from_spec(builder_spec)
    builder_spec.loader.exec_module(builder)
    return str(builder.PROMPT_VERSION)


def freeze_phase2a() -> dict[str, Any]:
    """冻结 Phase 2A 的全部契约（brief §56）。"""
    from semantic_skeleton.compiler.archetypes import archetype_keys
    from semantic_skeleton.mechanisms import mechanism_families
    from semantic_skeleton.ontology import fact_names

    prompt_version = _prompt_version_of("phase2a")
    prompt_path = ROOT / "semantic_skeleton" / "prompts" / f"v{prompt_version}.md"
    if not prompt_path.is_file():
        raise SystemExit(
            f"semantic_skeleton/prompts/v{prompt_version}.md 不存在："
            "先跑 py -3 scripts/build_skeleton_prompt.py"
        )
    schema_dir = ROOT / "semantic_skeleton" / "schemas"
    entries = [
        {"file": p.name, "sha256": _sha256_file(p)} for p in sorted(schema_dir.glob("*.json"))
    ]

    frozen = {
        # 注意：这里必须是模块常量 RUN_ID。早先写成一个未定义的全局 ``run_id``，
        # 一调用就 NameError——freeze 模式因此从没被真正跑通过，state/phase2a-frozen.json
        # 是更早一版留下的。现在两条 freeze 路径都由测试覆盖。
        "run_id": RUN_ID,
        "phase": "2A",
        "prompt_version": prompt_version,
        "prompt_sha256": _sha256_file(prompt_path),
        "prompt_output_format": "jsonl",
        "skeleton_schema_bundle_sha256": hashlib.sha256(
            json.dumps(entries, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest(),
        "skeleton_schema_files": entries,
        "ontology_version": "0.1",
        "ontology_fact_count": len(fact_names()),
        "mechanism_registry_version": "0.1",
        "mechanism_family_count": len(mechanism_families()),
        "invariant_archetype_count": len(archetype_keys()),
        "compiler_version": "0.3.0",
        "config_path": "configs/phase2a.json",
        "config_sha256": _sha256_file(PHASE2A_CONFIG),
        "provider_base_url_host": "api.stepfun.com/step_plan/v1",
        "model_default": "step-5-preview",
    }
    FROZEN_PATH.write_bytes(
        (json.dumps(frozen, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    )
    return frozen


def freeze_production() -> dict[str, Any]:
    """冻结 production contract（Phase 2B brief §4/§19-§20）。

    与 Phase 2A 的差别只有两处，都源自 brief §6/§7：

    * schema 换成 ``schemas/production/``（provider 不再拥有 skeleton_id）；
    * prompt 换成 v0.7（同一份 v0.6 只差 ID 归属，见 build_skeleton_prompt_v07.py）。

    ontology / mechanism registry / compiler / oracle / coverage controller / fingerprint /
    provider client 的哈希照实记录——OOD pilot 若逼出确定性修复，这里必须重新冻结。
    """
    return _freeze_contract("production", PRODUCTION_FROZEN_PATH, PRODUCTION_RUN_ID)


def freeze_ood() -> dict[str, Any]:
    """冻结 Generator-OOD Engineering Pilot 的合同（brief §10-§16）。

    pilot 用的 schema 与 production 相同（同样不把 skeleton_id 给 provider），prompt 是
    clean-room 家族。它**不是** benchmark：pilot 期间可能根据发现修 compiler/normalizer，
    所以这批 worlds 永远不进正式训练集/benchmark/500 production corpus（brief §16）。
    """
    frozen = _freeze_contract("ood", OOD_FROZEN_PATH, OOD_RUN_ID)
    frozen["purpose"] = "ENGINEERING OOD PILOT - representation robustness probe"
    frozen["not_for"] = ["training", "benchmark", "500-world production corpus"]
    OOD_FROZEN_PATH.write_bytes(
        (json.dumps(frozen, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    )
    return frozen


def _freeze_contract(contract: str, path: Path, run_id: str) -> dict[str, Any]:
    from semantic_skeleton.compiler.archetypes import archetype_keys
    from semantic_skeleton.mechanisms import mechanism_families
    from semantic_skeleton.ontology import fact_names

    prompt_version = _prompt_version_of(contract)
    prompt_path = _prompt_path_of(contract, prompt_version)
    if not prompt_path.is_file():
        raise SystemExit(
            f"{prompt_path} 不存在：先跑 py -3 scripts/{CONTRACT_PROMPT_BUILDER[contract]}.py"
        )
    if not PRODUCTION_SCHEMA_PATH.is_file():
        raise SystemExit(
            f"{PRODUCTION_SCHEMA_PATH} 不存在：先跑 py -3 scripts/build_production_schema.py"
        )
    entries = [{"file": PRODUCTION_SCHEMA_PATH.name, "sha256": _sha256_file(PRODUCTION_SCHEMA_PATH)}]

    frozen: dict[str, Any] = {
        "run_id": run_id,
        "phase": "2B",
        "contract": contract,
        "prompt_version": prompt_version,
        "prompt_sha256": _sha256_file(prompt_path),
        "prompt_output_format": "jsonl",
        "skeleton_schema_bundle_sha256": hashlib.sha256(
            json.dumps(entries, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest(),
        "skeleton_schema_files": entries,
        "canonical_id_scheme": "asw-canonical-skeleton-id/v1",
        "ontology_version": "0.1",
        "ontology_fact_count": len(fact_names()),
        "mechanism_registry_version": "0.1",
        "mechanism_family_count": len(mechanism_families()),
        "invariant_archetype_count": len(archetype_keys()),
        "compiler_version": "0.3.0",
        "config_path": "configs/phase2a.json",
        "config_sha256": _sha256_file(PHASE2A_CONFIG),
        "provider_base_url_host": "api.stepfun.com/step_plan/v1",
        "model_default": CONTRACT_DEFAULT_MODEL[contract],
    }
    if contract == "production":
        frozen["prompt_derived_from"] = {
            "path": "semantic_skeleton/prompts/v0.6.md",
            "sha256": "1c891e4b6f51911d93f8c7bd86e9526147dcfcc5a59dc18b4623a4db3d2234bc",
            "delta": "ID ownership only",
        }
    if contract == "ood":
        frozen["prompt_family"] = "clean-room specification-sheet (not the v0.6/v0.7 family)"
        frozen["generator_note"] = (
            "same vendor as the training generator; different model. Report must state this "
            "limitation explicitly (brief §11)."
        )
    path.write_bytes(
        (json.dumps(frozen, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    )
    return frozen


def _frozen_path_of(contract: str) -> Path:
    return {
        "phase2a": FROZEN_PATH,
        "production": PRODUCTION_FROZEN_PATH,
        "ood": OOD_FROZEN_PATH,
    }[contract]


def verify_frozen(contract: str = "phase2a") -> dict[str, Any]:
    """brief §56 / 2B §21：run 中途不许无版本地改合同。"""
    path = _frozen_path_of(contract)
    if not path.is_file():
        raise SystemExit(
            f"{path} 不存在：先跑 py -3 scripts/skeleton_run.py freeze --contract {contract}"
        )
    frozen = json.loads(path.read_text(encoding="utf-8"))
    prompt_path = _prompt_path_of(contract, str(frozen["prompt_version"]))
    if _sha256_file(prompt_path) != frozen["prompt_sha256"]:
        raise SystemExit(
            "RUN INVALID：prompt 与冻结值不一致。按 brief §56：停止本 run、冻结新版本、重新 freeze。"
        )
    if contract == "phase2a":
        schema_dir = ROOT / "semantic_skeleton" / "schemas"
        entries = [
            {"file": p.name, "sha256": _sha256_file(p)} for p in sorted(schema_dir.glob("*.json"))
        ]
        bundle = hashlib.sha256(
            json.dumps(entries, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        if bundle != frozen["skeleton_schema_bundle_sha256"]:
            raise SystemExit(
                "RUN INVALID：semantic skeleton schema bundle 与冻结值不一致。停止本 run，重新 freeze。"
            )
    else:
        if _sha256_file(PRODUCTION_SCHEMA_PATH) != frozen["skeleton_schema_files"][0]["sha256"]:
            raise SystemExit(
                f"RUN INVALID：{contract} schema 与冻结值不一致。停止本 run，重新 freeze。"
            )
    if _sha256_file(PHASE2A_CONFIG) != frozen["config_sha256"]:
        raise SystemExit("RUN INVALID：configs/phase2a.json 与冻结值不一致。停止本 run，重新 freeze。")
    return frozen


#: 运行锁路径。两个实例同时写同一批 checkpoint 会互相覆盖——Phase 2A 实测踩过
#: （一次 TaskStop 只杀掉了 shell 包装，python 子进程又跑了 4 批，帧文件里混进
#: 两种 prompt 版本）。锁是 fail-closed 的：拿不到就退出，绝不并发。
LOCK_PATH = ROOT / "state" / "phase2a-run.lock"


def acquire_run_lock(run_id: str = RUN_ID) -> Any:
    """拿运行锁；已被占用即退出（不并发、不覆盖）。

    锁是**全局**的而不是按 run_id 分的：两个 run 并发会同时打同一个 provider 账号
    （Phase 1 实测过并发上限 5 触发的 429），产物目录隔离解决不了配额争用。
    """
    import os

    if LOCK_PATH.is_file():
        try:
            holder = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            holder = {}
        raise SystemExit(
            "RUN INVALID：检测到另一个 Phase 2A run 正在执行"
            f"（锁文件 {LOCK_PATH}，持有者 pid={holder.get('pid')}，"
            f"启动于 {holder.get('started_at')}）。两个实例并发会互相覆盖 checkpoint。"
            "若确认没有残留进程，删除该锁文件后重试。"
        )
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOCK_PATH.write_text(json.dumps({
        "pid": os.getpid(),
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "run_id": run_id,
    }, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return LOCK_PATH


def release_run_lock() -> None:
    try:
        LOCK_PATH.unlink()
    except OSError:
        pass


class RunState:
    """断点续跑的全部累积状态。

    ``run_id`` 可覆盖（brief §3：confirmation run 用新 run_id，不复用被 401 中断的
    输出目录）。默认值保持 Phase 2A 既有的 ``provider-run-002``，行为逐字节不变。

    ``contract="production"`` 时（Phase 2B brief §23）全部产物搬到
    ``worlds/production/`` 与 ``state/production-*``——正式 corpus 与开发 corpus
    物理分开，不允许"顺手从开发集里凑几个"。
    """

    def __init__(self, run_id: str = RUN_ID, *, contract: str = "phase2a") -> None:
        run_id = str(run_id)
        if not run_id or "/" in run_id or "\\" in run_id:
            raise SystemExit(f"非法 run_id: {run_id!r}")
        if contract not in CONTRACTS:
            raise SystemExit(f"未知契约 {contract!r}（可选 {CONTRACTS}）")
        self.contract = contract
        default_run_id = {
            "phase2a": RUN_ID,
            "production": PRODUCTION_RUN_ID,
            "ood": OOD_RUN_ID,
        }[contract]
        #: 非默认 run_id 时全部产物路径加后缀，与既有 run 完全隔离
        # （brief §10：GO/NO-GO 必须能分别看到每个 run 的独立指标）。
        suffix = "" if run_id == default_run_id else f"-{run_id}"
        self.run_id = run_id
        #: 三种布局：Phase 2A 开发 corpus / production 正式 corpus / OOD pilot（brief §23）。
        worlds = ROOT / "worlds" if contract == "phase2a" else ROOT / "worlds" / contract
        state_prefix = {"phase2a": "phase2a", "production": "production", "ood": "ood"}[contract]
        self.progress_path = ROOT / "state" / f"{state_prefix}-progress{suffix}.json"
        self.coverage_path = ROOT / "state" / f"{state_prefix}-coverage{suffix}.json"
        self.raw_path = (
            worlds / "raw" / f"{run_id}.jsonl" if not contract == "phase2a"
            else worlds / "skeletons" / "raw" / f"{run_id}.jsonl"
        )
        self.accepted_path = (
            worlds / "accepted" / f"{run_id}.jsonl" if not contract == "phase2a"
            else worlds / "skeletons" / "accepted" / f"{run_id}.jsonl"
        )
        self.rejected_path = (
            worlds / "rejected" / f"{run_id}.jsonl" if not contract == "phase2a"
            else worlds / "skeletons" / "rejected" / f"{run_id}.jsonl"
        )
        self.quarantine_path = (
            worlds / "quarantine" / f"{run_id}.jsonl" if not contract == "phase2a"
            else worlds / "skeletons" / "quarantine" / f"{run_id}.jsonl"
        )
        self.compiled_path = (
            ROOT / "worlds" / "compiled" / "accepted" / f"phase2a-100{suffix}.jsonl"
            if contract == "phase2a" else worlds / "compiled" / f"{contract}-worlds{suffix}.jsonl"
        )
        self.provenance_path = ROOT / "provenance" / (
            f"{run_id}.jsonl" if contract == "phase2a" else f"{contract}-{run_id}.jsonl"
        )
        self.frames_path = (
            worlds / "raw" / f"frames-{run_id}.jsonl" if not contract == "phase2a"
            else worlds / "skeletons" / "raw" / f"frames-{run_id}.jsonl"
        )
        # brief §7：mechanism-selection 追踪（每次覆盖控制器做选择都记一行）
        self.selection_trace_path = ROOT / "state" / f"mechanism-selection-trace-{run_id}.jsonl"
        # brief §9：基础设施故障单独一条流——不进 dataset quality 指标，也不与
        # "生成器吐了坏数据"混在同一本账上。
        self.infrastructure_failures_path = (
            ROOT / "state" / f"infrastructure-failures-{run_id}.jsonl"
        )
        for path in (
            self.raw_path, self.accepted_path, self.rejected_path, self.quarantine_path,
            self.compiled_path, self.provenance_path, self.frames_path,
            self.selection_trace_path, self.infrastructure_failures_path,
        ):
            path.parent.mkdir(parents=True, exist_ok=True)
        self.progress = self._load(self.progress_path, {
            "run_id": run_id, "contract": contract, "batches": 0, "raw_skeletons": 0,
            "accepted": 0, "rejected": 0, "quarantined": 0, "parse_failures": 0,
            "compile_failures": 0, "verify_failures": 0, "duplicates": 0,
            "input_tokens": 0, "output_tokens": 0, "latency_s": 0.0, "retries": 0,
            "provider_errors": 0, "usage_missing_calls": 0,
            "canonical_ids": [], "fingerprints": [], "rejection_reasons": {},
            "compiler_failures": {}, "provider_claimed_id_reuse": 0,
            "provider_claimed_ids": [],
        })
        if "canonical_ids" not in self.progress:
            self.progress["canonical_ids"] = []
        if "provider_claimed_ids" not in self.progress:
            self.progress["provider_claimed_ids"] = []
        if "skeleton_ids" not in self.progress:
            # Phase 2A 的断点进度里这个键是 provider 句柄清单；production 里它没有意义，
            # 保留空清单只为让旧进度文件还能被读。
            self.progress["skeleton_ids"] = []
        self.coverage = CoverageState.from_document(self._load(self.coverage_path, {}))

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
            json.dumps(self.progress, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        self.coverage_path.write_text(
            json.dumps(self.coverage.to_document(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def bump(self, reason: str) -> None:
        reasons = self.progress["rejection_reasons"]
        reasons[reason] = int(reasons.get(reason, 0)) + 1

    def bump_compiler(self, code: str) -> None:
        codes = self.progress["compiler_failures"]
        codes[code] = int(codes.get(code, 0)) + 1


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


def process_skeleton(
    document: Mapping[str, Any],
    *,
    state: RunState,
    batch_meta: Mapping[str, Any],
    compiler: SemanticSkeletonCompiler,
    context: CompileContext,
    schema_path: Path | None = None,
) -> str:
    """单个骨架的预检 → 编译 → Oracle 复核 → 去重。返回 accepted/quarantined/rejected。

    ``contract == "production"`` 时的三处身份差别（Phase 2B brief §6/§7/§29）：

    1. ``skeleton_id`` 由程序从语义内容派生（``identity.canonical_skeleton_id``），
       provider 自称的 id 只作为 ``provider_claimed_id`` 进 provenance；
    2. provider 撞 id **不再**是拒收理由——只有语义重复才去重；
    3. canonical id 撞车（= 语义内容逐字节相同）是程序可判定的重复，单独记一类。
    """
    production = state.contract != "phase2a"
    claimed = str(document.get("provider_claimed_id") or document.get("skeleton_id") or "")
    canonical_id = canonical_skeleton_id(document)
    skeleton_id = canonical_id if production else claimed
    family = str(document.get("mechanism_family") or "")

    if production:
        # brief §29：provider 重复自称的 id 只记录，不拒收。用内存里的清单而不是每次重读
        # raw 文件——500 个世界那就是 500 次越来越大的文件读取。
        claimed_ids = set(state.progress.get("provider_claimed_ids") or ())
        if claimed:
            if claimed in claimed_ids:
                state.progress["provider_claimed_id_reuse"] = int(
                    state.progress.get("provider_claimed_id_reuse", 0)
                ) + 1
            claimed_ids.add(claimed)
            state.progress["provider_claimed_ids"] = sorted(claimed_ids)
        if canonical_id in state.progress["canonical_ids"]:
            # 语义内容逐字节相同 ⇒ 程序判定的重复（与"换业务名的近重复"分开记账）。
            state.progress["rejected"] += 1
            state.bump("duplicate_canonical_id")
            state.append_jsonl(state.rejected_path, {
                "skeleton_id": canonical_id, "provider_claimed_id": claimed or None,
                "reason": "duplicate_canonical_id",
                "batch": batch_meta["raw_generation_id"],
            })
            return "rejected"
    elif skeleton_id in state.progress["skeleton_ids"]:
        state.progress["rejected"] += 1
        state.bump("duplicate_skeleton_id")
        state.append_jsonl(state.rejected_path, {
            "skeleton_id": skeleton_id, "reason": "duplicate_skeleton_id",
            "batch": batch_meta["raw_generation_id"],
        })
        return "rejected"

    fingerprint = semantic_fingerprint(document)
    if fingerprint in state.progress["fingerprints"]:
        state.progress["quarantined"] += 1
        state.bump("semantic_near_duplicate")
        state.append_jsonl(state.quarantine_path, {
            "skeleton_id": skeleton_id, "provider_claimed_id": claimed or None,
            "reason": "semantic_near_duplicate",
            "semantic_fingerprint": fingerprint,
            "mechanism_family": family,
            "batch": batch_meta["raw_generation_id"],
        })
        return "quarantined"

    # 预检（brief §32）：装载期的 §17 + schema 扫描
    try:
        load_skeleton(document, schema_path=schema_path)
    except Exception as exc:
        state.progress["rejected"] += 1
        state.bump("skeleton_rejected")
        state.append_jsonl(state.rejected_path, {
            "skeleton_id": skeleton_id, "provider_claimed_id": claimed or None,
            "reason": "skeleton_rejected",
            "detail": str(exc)[:600], "batch": batch_meta["raw_generation_id"],
        })
        return "rejected"

    # 编译（brief §41 的渐进阶段 + §42 的失败分类）
    try:
        result = compiler.compile_with_plan(
            dict(document), context=compile_context_for(context, canonical_id)
        )
    except SkeletonCompileError as exc:
        state.progress["rejected"] += 1
        state.progress["compile_failures"] += 1
        state.bump("compile_" + exc.code)
        state.bump_compiler(exc.code)
        state.append_jsonl(state.rejected_path, {
            "skeleton_id": skeleton_id, "provider_claimed_id": claimed or None,
            "reason": "compile_error",
            "reason_code": exc.code, "stage": exc.stage, "field": exc.failure.field,
            "detail": exc.failure.detail[:500],
            "batch": batch_meta["raw_generation_id"],
        })
        return "rejected"
    except Exception as exc:  # 未登记失败码 ⇒ 编译器自己的 bug
        state.progress["quarantined"] += 1
        state.bump("INTERNAL_COMPILER_ERROR")
        state.bump_compiler("INTERNAL_COMPILER_ERROR")
        state.append_jsonl(state.quarantine_path, {
            "skeleton_id": skeleton_id, "provider_claimed_id": claimed or None,
            "reason": "internal_compiler_error",
            "detail": f"{type(exc).__name__}: {exc}"[:600],
            "batch": batch_meta["raw_generation_id"],
        })
        return "quarantined"

    spec = result.spec
    errors = list(world_spec_validator().iter_errors(spec))
    if errors:
        state.progress["rejected"] += 1
        state.bump("compiled_schema_invalid")
        state.append_jsonl(state.rejected_path, {
            "skeleton_id": skeleton_id, "provider_claimed_id": claimed or None,
            "reason": "compiled_schema_invalid",
            "detail": "; ".join(
                f"{'/'.join(str(p) for p in e.absolute_path)}: {e.message[:160]}"
                for e in errors[:3]
            )[:600],
            "batch": batch_meta["raw_generation_id"],
        })
        return "rejected"

    # Oracle 复核（brief §35-§36：先验不是真值）
    report = verify_compiled_world(
        spec, skeleton=dict(document), plan=result.plan, config_path=PHASE2A_CONFIG,
    )
    if not report.compiled:
        state.progress["quarantined"] += 1
        state.progress["verify_failures"] += 1
        state.bump("verify_" + str(report.error_code))
        state.append_jsonl(state.quarantine_path, {
            "skeleton_id": skeleton_id, "provider_claimed_id": claimed or None,
            "reason": "verify_failed",
            "stage": report.stage, "error_code": report.error_code,
            "detail": report.error_detail[:500],
            "batch": batch_meta["raw_generation_id"],
        })
        return "quarantined"
    if report.contradictions:
        state.progress["rejected"] += 1
        state.bump("CONTRADICTORY_EXPECTATION")
        state.append_jsonl(state.rejected_path, {
            "skeleton_id": skeleton_id, "provider_claimed_id": claimed or None,
            "reason": "contradictory_expectation",
            "detail": "; ".join(
                f"{item.axis_id}({item.variable}): 声明 {item.declared_expectation}，"
                f"实际 {item.actual_effect}/{item.semantic_class}"
                for item in report.contradictions
            )[:600],
            "batch": batch_meta["raw_generation_id"],
        })
        return "rejected"

    item = mechanism(family)
    labels = tuple(item.coverage_labels) if item is not None else ()
    complexity = str(document.get("complexity") or "medium")
    domain = str(document.get("domain") or "")
    state.progress["accepted"] += 1
    state.progress["skeleton_ids"].append(skeleton_id)
    state.progress["canonical_ids"].append(canonical_id)
    state.progress["fingerprints"].append(fingerprint)
    record_world(
        state.coverage, labels=labels, complexity=complexity, domain=domain, family=family
    )
    state.append_jsonl(state.accepted_path, {
        "skeleton_id": skeleton_id,
        "provider_claimed_id": claimed or None,
        "canonical_id": canonical_id,
        "semantic_fingerprint": fingerprint,
        "mechanism_family": family,
        "attack_family": spec["attack_family"],
        "coverage_labels": list(labels),
        "complexity": complexity,
        "application_domain": domain,
        "world_id": spec["world_id"],
        "probes": report.probes,
        "episodes": report.episodes,
        "base_labels": list(report.base_labels),
        "counterfactual_outcomes": [item.to_document() for item in report.outcomes],
        "batch": batch_meta["raw_generation_id"],
        "skeleton_document": dict(document),
        "spec_document": spec,
    })
    state.append_jsonl(state.compiled_path, {
        "world_id": spec["world_id"],
        "skeleton_id": skeleton_id,
        "provider_claimed_id": claimed or None,
        "canonical_id": canonical_id,
        "mechanism_family": family,
        "attack_family": spec["attack_family"],
        "coverage_labels": list(labels),
        "complexity": complexity,
        "application_domain": domain,
        "episodes": report.episodes,
        "base_labels": list(report.base_labels),
        "batch": batch_meta["raw_generation_id"],
        "spec_document": spec,
    })
    return "accepted"


def compile_context_for(context: CompileContext, canonical_id: str) -> CompileContext:
    """把 canonical id 装进编译上下文（生产路径）。

    世界身份（``world_id`` / ``seed`` / 全部实体 ID）由它派生，因此 provider 自称的
    任何 id 都影响不了编译结果。
    """
    return CompileContext(
        generator_model=context.generator_model,
        generator_model_version=context.generator_model_version,
        prompt_version=context.prompt_version,
        prompt_hash=context.prompt_hash,
        generation_timestamp=context.generation_timestamp,
        raw_generation_id=context.raw_generation_id,
        origin=context.origin,
        canonical_skeleton_id=canonical_id,
    )


def run_batches(args: argparse.Namespace) -> int:
    frozen = verify_frozen(args.contract)
    acquire_run_lock(args.run_id)
    try:
        return _run_batches_locked(args, frozen)
    finally:
        release_run_lock()


def _run_batches_locked(args: argparse.Namespace, frozen: Mapping[str, Any]) -> int:
    state = RunState(args.run_id, contract=args.contract)
    #: phase2a 用冻结 schema（provider 拥有 skeleton_id）；production / ood 用
    #: production schema（provider 不拥有任何 ID）。
    production = args.contract != "phase2a"
    prompt_path = _prompt_path_of(args.contract, str(frozen["prompt_version"]))
    prompt_text = prompt_path.read_text(encoding="utf-8")
    schema_path = PRODUCTION_SCHEMA_PATH if production else None

    client = None
    if args.live:
        client = LiveSkeletonClient(
            opt_in=True,
            run_id=state.run_id,
            prompt_version=str(frozen["prompt_version"]),
            prompt_hash=str(frozen["prompt_sha256"]),
            temperature=args.temperature,
            top_p=args.top_p,
            reasoning_effort=args.reasoning_effort,
            max_output_tokens=args.max_tokens,
            max_retries=args.max_retries,
            model=args.model or CONTRACT_DEFAULT_MODEL[args.contract],
            start_index=int(state.progress.get("batches", 0)),
            checkpoint_dir=ROOT / "provenance" / "phase2a-checkpoints",
            seed=int(state.progress.get("batches", 0)),
        )
        if not args.live and not args.replay:
            raise SystemExit("未传 --live：真实 provider 调用需要显式 opt-in（brief D）。")

    compiler = SemanticSkeletonCompiler()
    started = time.time()
    consecutive_provider_errors = 0
    consecutive_frame_failures = 0
    target_accepted = args.target_accepted
    max_batches = args.max_batches

    while True:
        accepted = int(state.progress["accepted"])
        if target_accepted is not None and accepted >= target_accepted:
            print(f"停止：accepted={accepted} 达到目标 {target_accepted}")
            break
        if max_batches is not None and int(state.progress["batches"]) >= max_batches:
            print(f"停止：本批处理达到 --max-batches {max_batches}（accepted={accepted}）")
            break

        recent_failures = tuple(sorted(state.progress["rejection_reasons"], key=lambda k: -int(
            state.progress["rejection_reasons"][k])))[:8]
        directive_text = directive(
            state.coverage, args.batch_size,
            recent_failures=recent_failures,
            duplicate_signatures=tuple(state.progress["fingerprints"])[-20:],
            # 黑名单取**全部**已解析骨架（不只是 accepted）：被拒的 id 同样不能再出现，
            # 否则模型会在每一批里重复同一批被拒的 id（v0.6 run 实测 10/15 拒绝是它）。
            # production 契约下 provider 不拥有 id，这份黑名单整体不发（brief §6）。
            used_skeleton_ids=(
                ()
                if production else
                tuple(
                    str(record.get("skeleton_id"))
                    for record in _read_jsonl(state.raw_path)
                    if record.get("skeleton_id")
                )
            ),
            include_id_blacklist=not production,
        )
        full_prompt = prompt_text + "\n\n" + directive_text
        # brief §7：把这次覆盖选择如实落盘（在发请求之前记，失败批也留痕）。
        # 记录的是 selection_record() 已经算出来的东西，不改变选择本身。
        state.append_jsonl(state.selection_trace_path, {
            **selection_record(
                state.coverage, batch_index=int(state.progress["batches"]) + 1
            ),
            "coverage_directive_sha256": hashlib.sha256(
                directive_text.encode("utf-8")
            ).hexdigest(),
            "batch_size": args.batch_size,
        })

        batch_started = time.time()
        if client is None:
            print("DRY RUN：未提供 provider（传 --live）。覆盖指令如下：\n" + directive_text)
            return 0
        try:
            raw = client.generate(full_prompt, batch_size=args.batch_size)
        except AuthCircuitOpen as exc:
            # brief §9 / §5：凭据/配额问题是基础设施故障，不是数据质量问题。熔断即停，
            # 单独落一条 INFRASTRUCTURE_BLOCKED_PROVIDER_AUTH，绝不混进 GO/NO-GO 指标。
            state.progress["provider_errors"] += 1
            state.bump("provider_transport_error")
            state.append_jsonl(state.infrastructure_failures_path, {
                "event": "INFRASTRUCTURE_BLOCKED_PROVIDER_AUTH",
                "classification": "INFRASTRUCTURE_FAILURE",
                "detail": str(exc)[:500],
                "batch": "failed-batch",
                "accepted_so_far": state.progress["accepted"],
                "run_id": state.run_id,
                "contract": state.contract,
            })
            state.append_jsonl(state.rejected_path, {
                "skeleton_id": "?batch", "reason": "provider_transport_error",
                "classification": "INFRASTRUCTURE_FAILURE",
                "detail": str(exc)[:500], "batch": "failed-batch",
            })
            state.save()
            print(f"鉴权熔断：{exc}")
            print("按 brief §9 停止本 run 并标记 INFRASTRUCTURE_BLOCKED_PROVIDER_AUTH；"
                  "该事件不计入 dataset quality 指标。")
            return 6
        except ProviderError as exc:
            state.progress["provider_errors"] += 1
            state.bump("provider_transport_error")
            # classification 让审计能把"生成器噪声"与"基础设施故障"分开数（brief §61）。
            state.append_jsonl(state.infrastructure_failures_path, {
                "event": "PROVIDER_TRANSPORT_ERROR",
                "classification": "INFRASTRUCTURE_FAILURE",
                "detail": str(exc)[:500],
                "batch": "failed-batch",
                "accepted_so_far": state.progress["accepted"],
                "run_id": state.run_id,
                "contract": state.contract,
            })
            state.append_jsonl(state.rejected_path, {
                "skeleton_id": "?batch", "reason": "provider_transport_error",
                "classification": "INFRASTRUCTURE_FAILURE",
                "detail": str(exc)[:500], "batch": "failed-batch",
            })
            state.save()
            consecutive_provider_errors += 1
            print(f"provider 传输失败（连续第 {consecutive_provider_errors} 次）：{exc}")
            if consecutive_provider_errors >= args.max_consecutive_provider_errors:
                print("连续 provider 失败，停止本 run。凭据/配额问题只能由运行方解决。")
                return 3
            continue
        consecutive_provider_errors = 0

        call = client.calls[-1] if client.calls else {}
        state.append_jsonl(state.frames_path, {
            "raw_generation_id": raw.raw_generation_id,
            "model": raw.model,
            "prompt_version": raw.prompt_version,
            "prompt_hash": raw.prompt_hash,
            "input_tokens": raw.input_tokens,
            "output_tokens": raw.output_tokens,
            "output_text": raw.output_text,
            "finish_reason": client.last_finish_reason,
            "coverage_directive_sha256": hashlib.sha256(
                directive_text.encode("utf-8")
            ).hexdigest(),
        })
        state.progress["batches"] += 1
        state.progress["input_tokens"] += int(call.get("input_tokens", raw.input_tokens))
        state.progress["output_tokens"] += int(call.get("output_tokens", raw.output_tokens))
        state.progress["latency_s"] = round(
            float(state.progress["latency_s"]) + float(call.get("latency_s", 0.0)), 3)
        state.progress["retries"] += int(call.get("retries", 0))
        state.progress["usage_missing_calls"] += 1 if call.get("usage_missing") else 0

        batch_meta = {
            "raw_generation_id": raw.raw_generation_id,
            "model": raw.model,
            "input_tokens": call.get("input_tokens", raw.input_tokens),
            "output_tokens": call.get("output_tokens", raw.output_tokens),
            "latency_s": call.get("latency_s", 0.0),
            "retries": call.get("retries", 0),
        }
        # production / ood 契约下模型按 prompt 不再输出 skeleton_id；预检必须用
        # 同一份 production schema，并且不把 provider 撞 id 当拒收（brief §29）。
        result = parse_skeleton_batch(
            raw.output_text, reject_duplicate_ids=not production, schema_path=schema_path
        )
        if result.frame_rejected:
            state.progress["parse_failures"] += 1
            state.bump("frame_decode_failed")
            state.append_jsonl(state.rejected_path, {
                "skeleton_id": "?batch", "reason": "frame_decode_failed",
                "rejections": [item.to_document() for item in result.rejections][:4],
                "batch": raw.raw_generation_id,
                "output_text_length": len(raw.output_text),
                "finish_reason": client.last_finish_reason,
            })
            consecutive_frame_failures += 1
            if client.last_finish_reason == "length" and args.batch_size > 2:
                args.batch_size = max(2, args.batch_size // 2)
                print(f"帧被输出上限截断：批量自适应降为 {args.batch_size}")
            if consecutive_frame_failures >= args.max_consecutive_frame_failures:
                print(f"连续 {consecutive_frame_failures} 帧解码失败，停止本 run。")
                return 4
        else:
            consecutive_frame_failures = 0

        for rejection in result.rejections:
            state.bump("element_" + rejection.reason)
            state.append_jsonl(state.rejected_path, {
                "skeleton_id": rejection.skeleton_id,
                "reason": "element_" + rejection.reason,
                "detail": rejection.detail[:400],
                "line": rejection.line,
                "batch": raw.raw_generation_id,
            })

        context = CompileContext(
            generator_model=raw.model,
            generator_model_version=raw.model,
            prompt_version=str(frozen["prompt_version"]),
            prompt_hash=str(frozen["prompt_sha256"]),
            generation_timestamp=raw.raw_generation_id and "2026-09-25T00:00:00Z",
            raw_generation_id=raw.raw_generation_id,
        )
        for document in result.skeletons:
            state.progress["raw_skeletons"] += 1
            state.append_jsonl(state.raw_path, {
                # production 契约：provider 自称的 id 记成 provider_claimed_id，
                # canonical id 由程序现算并单独落一列（brief §6）。
                "skeleton_id": (
                    canonical_skeleton_id(document) if production
                    else document.get("skeleton_id")
                ),
                "provider_claimed_id": (
                    str(document.get("provider_claimed_id"))
                    if document.get("provider_claimed_id") else None
                ),
                "mechanism_family": document.get("mechanism_family"),
                "domain": document.get("domain"),
                "complexity": document.get("complexity"),
                "semantic_fingerprint": semantic_fingerprint(document),
                "history_topology": [
                    classify_history_line(str(line)) for line in document.get("history") or ()
                ],
                "raw_generation_id": raw.raw_generation_id,
                "skeleton_document": dict(document),
            })
            process_skeleton(
                document, state=state, batch_meta=batch_meta,
                compiler=compiler, context=context, schema_path=schema_path,
            )

        state.append_jsonl(state.provenance_path, {
            **batch_meta,
            "batch_index": state.progress["batches"],
            "skeletons_parsed": len(result.skeletons),
            "element_rejections": len(result.rejections),
            "frame_rejected": result.frame_rejected,
            "wallclock_s": round(time.time() - batch_started, 2),
            "prompt_version": str(frozen["prompt_version"]),
            "prompt_sha256": str(frozen["prompt_sha256"]),
            "coverage_directive_sha256": hashlib.sha256(
                directive_text.encode("utf-8")).hexdigest(),
            "coverage_after": coverage_report(state.coverage),
        })
        stuck = advance_stalls(state.coverage)
        state.save()
        print(
            f"batch {state.progress['batches']}: parsed={len(result.skeletons)} "
            f"rejected_elems={len(result.rejections)} raw={state.progress['raw_skeletons']} "
            f"accepted={state.progress['accepted']} quarantined={state.progress['quarantined']} "
            f"out_tokens={state.progress['output_tokens']} "
            f"labels={state.coverage.labels} ({round(time.time() - batch_started, 1)}s)"
        )
        if stuck:
            print(
                f"覆盖停顿：标签 {stuck} 连续多批零推进。按 brief §26 停止本 run并上报——"
                "继续烧 token 只会得到同一个结果。"
            )
            return 5

    totals = {
        "input_tokens": state.progress["input_tokens"],
        "output_tokens": state.progress["output_tokens"],
        "raw_skeletons": state.progress["raw_skeletons"],
        "accepted": state.progress["accepted"],
        "rejected": state.progress["rejected"],
        "quarantined": state.progress["quarantined"],
        "provider_claimed_id_reuse": state.progress.get("provider_claimed_id_reuse", 0),
        "wallclock_s": round(time.time() - started, 1),
    }
    state.append_jsonl(state.provenance_path, {"event": "run_completed", **totals})
    state.save()
    print(json.dumps(totals, ensure_ascii=False))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="语义骨架 provider runner（Phase 2A / Phase 2B）")
    parser.add_argument(
        "mode", choices=["freeze", "smoke", "round2", "round3", "final", "production", "ood", "plan"]
    )
    parser.add_argument("--live", action="store_true", help="显式 opt-in 真实 provider 调用")
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--max-tokens", type=int, default=32768)
    parser.add_argument("--temperature", type=float, default=0.3)
    parser.add_argument("--top-p", type=float, default=0.9)
    parser.add_argument("--reasoning-effort", default="medium", choices=["low", "medium", "high"])
    parser.add_argument("--max-retries", type=int, default=4)
    parser.add_argument("--target-accepted", type=int, default=None)
    parser.add_argument("--max-batches", type=int, default=None)
    parser.add_argument("--max-consecutive-provider-errors", type=int, default=5)
    parser.add_argument("--max-consecutive-frame-failures", type=int, default=3)
    parser.add_argument(
        "--contract", default="phase2a", choices=list(CONTRACTS),
        help="phase2a = 冻结的 Phase 2A 契约（默认）；production = Phase 2B 正式契约"
        "（provider 不拥有 skeleton_id，产物落 worlds/production/）",
    )
    parser.add_argument("--run-id", default=None,
                        help="run id（缺省按契约取 provider-run-002 / provider-run-production-001 /"
                             " provider-ood-pilot-001）")
    parser.add_argument("--model", default=None,
                        help="覆盖模型（OOD pilot 用第二生成器；缺省按契约取）")
    args = parser.parse_args()

    # production 模式隐含 production 契约：少一个必须记住的开关。
    if args.mode == "production":
        if args.contract != "production":
            raise SystemExit("mode=production 必须配 --contract production（brief §23）")
        args.target_accepted = args.target_accepted or 500
    if args.mode == "ood":
        if args.contract != "ood":
            raise SystemExit("mode=ood 必须配 --contract ood")
        args.target_accepted = args.target_accepted or 40
    if args.run_id is None:
        args.run_id = {
            "phase2a": RUN_ID,
            "production": PRODUCTION_RUN_ID,
            "ood": OOD_RUN_ID,
        }[args.contract]

    if args.mode == "freeze":
        frozen = {
            "phase2a": freeze_phase2a,
            "production": freeze_production,
            "ood": freeze_ood,
        }[args.contract]()
        print(json.dumps(frozen, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    if args.mode == "plan":
        state = RunState(args.run_id, contract=args.contract)
        print(json.dumps(coverage_report(state.coverage), ensure_ascii=False, indent=2))
        return 0

    targets = {
        "smoke": None, "round2": 30, "round3": 60, "final": 100,
        "production": 500, "ood": 40,
    }
    args.target_accepted = args.target_accepted or targets[args.mode]
    if args.mode == "smoke":
        args.max_batches = args.max_batches or 4
    return run_batches(args)


if __name__ == "__main__":
    raise SystemExit(main())
