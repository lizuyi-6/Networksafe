"""Production Contract Freeze（Phase 2B brief §19-§21）。

前置条件（不满足即拒绝冻结，fail-closed）：

1. ``state/production-frozen.json`` 存在且与现行 prompt / production schema /
   configs/phase2a.json 哈希一致（runner 的 verify_frozen 同款校验）；
2. ``state/ood-frozen.json`` 存在（OOD pilot 已冻结过——freeze 必须排在 pilot 之后）；
3. test collection guard 通过且 manifest 落盘（brief §5）；
4. 全量 pytest 的摘要由调用方以 ``--pytest-summary`` 显式传入（本脚本不替你跑 12 分钟
   测试，但也不允许编造——它把传入的摘要原样记进 freeze）；
5. OOD pilot 审计报告存在（brief §18：pilot 结束、必要修复完成、回归全绿之后才冻结）。

产出：``PRODUCTION-CONTRACT-FREEZE.json`` / ``.sha256`` / ``SHA256SUMS.txt``（LF）。
冻结后，500-world production 期间禁止修改任何列出的组件（brief §21）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.check_test_collection import MANIFEST_PATH, check as check_collection  # noqa: E402

OUT_JSON = ROOT / "PRODUCTION-CONTRACT-FREEZE.json"
OUT_SHA = ROOT / "PRODUCTION-CONTRACT-FREEZE.sha256"
OUT_SUMS = ROOT / "SHA256SUMS-production.txt"

#: 组件清单（brief §20 的"至少"集合 + 本仓库的实际模块边界）。description 说明用途。
COMPONENTS: tuple[tuple[str, str, str], ...] = (
    ("prompt", "semantic_skeleton/prompts/v0.7.md", "production prompt（v0.6 的 ID 归属差分）"),
    ("skeleton_schema", "semantic_skeleton/schemas/production/semantic-skeleton.schema.json",
     "production 契约 schema（provider 不拥有任何 ID）"),
    ("ontology", "semantic_skeleton/ontology.py", "语义事实本体"),
    ("type_vocabularies", "semantic_skeleton/vocabularies.py", "语义类型词表"),
    ("mechanism_registry", "semantic_skeleton/mechanisms.py", "机制族注册表"),
    ("invariant_archetypes", "semantic_skeleton/compiler/archetypes.py", "不变量原型库"),
    ("normalizer", "semantic_skeleton/skeleton.py", "骨架装载 + §17 禁止字段扫描"),
    ("batch_parser", "semantic_skeleton/generator/parser.py", "JSONL 批解析（production 不因撞 id 拒收）"),
    ("compiler", "semantic_skeleton/compiler/compiler.py", "确定性编译器"),
    ("compiler_plan", "semantic_skeleton/compiler/plan.py", "WorldPlan 与槽解析"),
    ("compiler_errors", "semantic_skeleton/compiler/errors.py", "编译失败分类词表"),
    ("identity", "semantic_skeleton/identity.py", "canonical id 派生（ID ownership）"),
    ("oracle", "security_world/oracle/oracle.py", "Oracle（两趟判决）"),
    ("counterfactual_verifier", "semantic_skeleton/validators/verify.py", "先验复核器"),
    ("coverage_controller", "semantic_skeleton/coverage.py", "硬配额覆盖控制器（least-used 调度）"),
    ("structural_fingerprint", "semantic_skeleton/fingerprint.py", "语义指纹（去重与多样性）"),
    ("leakage_gates", "configs/phase2a.json", "模型可见投影白名单 + 判决词表来源配置"),
    ("provider_client", "semantic_skeleton/generator/live.py", "加固版 provider 客户端"),
    ("episode_families", "security_world/expansion/families.py", "trust_provenance_variant 家族"),
    ("episode_expansion_driver", "analysis/phase2b_expand.py", "确定性 episode 展开驱动"),
    ("episode_expansion_config", "configs/phase2b-episodes.json", "episode 生产计划"),
    ("runner", "scripts/skeleton_run.py", "三契约 provider runner"),
    ("test_collection_manifest", "test-collection-manifest.json", "测试收集清单（brief §5）"),
)


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _verify_run_contracts() -> dict[str, Any]:
    production = json.loads((ROOT / "state" / "production-frozen.json").read_text(encoding="utf-8"))
    ood = json.loads((ROOT / "state" / "ood-frozen.json").read_text(encoding="utf-8"))
    prompt_path = ROOT / "semantic_skeleton" / "prompts" / "v0.7.md"
    schema_path = ROOT / "semantic_skeleton" / "schemas" / "production" / "semantic-skeleton.schema.json"
    config_path = ROOT / "configs" / "phase2a.json"
    if _sha256_file(prompt_path) != production["prompt_sha256"]:
        raise SystemExit("production-frozen.json 的 prompt_sha256 与现行 v0.7 不一致：先重新 freeze runner 合同")
    if _sha256_file(schema_path) != production["skeleton_schema_files"][0]["sha256"]:
        raise SystemExit("production-frozen.json 的 schema 哈希与现行 production schema 不一致")
    if _sha256_file(config_path) != production["config_sha256"]:
        raise SystemExit("production-frozen.json 的 config 哈希与现行 configs/phase2a.json 不一致")
    return {"production": production, "ood": ood}


def main() -> int:
    parser = argparse.ArgumentParser(description="冻结 production contract（brief §19-§20）")
    parser.add_argument(
        "--pytest-summary", required=True,
        help="全量 pytest 的真实摘要，例如 '1434 passed in 387.31s'——原样记入 freeze",
    )
    parser.add_argument(
        "--pytest-collected", type=int, required=True,
        help="全量收集数（必须 >= test-collection-manifest 的 total_collected）",
    )
    parser.add_argument("--label", default="", help="可选备注（例如 OOD pilot 的修复轮次）")
    args = parser.parse_args()

    contracts = _verify_run_contracts()
    if not (ROOT / "reports" / "phase2b" / "ood-pilot.json").is_file():
        raise SystemExit(
            "reports/phase2b/ood-pilot.json 不存在：先跑完 Generator-OOD pilot 并审计"
            "（brief §18/§19 的顺序）"
        )
    manifest = check_collection(quiet=True)
    if not manifest["passed"]:
        raise SystemExit(f"test collection guard FAIL: {manifest['failures']}")
    if args.pytest_collected < int(manifest["total_collected"]):
        raise SystemExit(
            f"--pytest-collected {args.pytest_collected} < manifest total_collected "
            f"{manifest['total_collected']}"
        )

    components: dict[str, dict[str, str]] = {}
    for name, relative, description in COMPONENTS:
        path = ROOT / relative
        if not path.is_file():
            raise SystemExit(f"冻结组件缺失: {relative}")
        components[name] = {
            "path": relative.replace("\\", "/"),
            "sha256": _sha256_file(path),
            "description": description,
        }

    freeze: dict[str, Any] = {
        "artifact": "PRODUCTION-CONTRACT-FREEZE",
        "phase": "2B",
        "status": "PRODUCTION_CONTRACT_FROZEN",
        "frozen_at_wallclock": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "label": args.label,
        "canonical_id_scheme": "asw-canonical-skeleton-id/v1",
        "run_contracts": {
            "production_run_id": contracts["production"]["run_id"],
            "ood_run_id": contracts["ood"]["run_id"],
        },
        "components": components,
        "tests": {
            "collected": args.pytest_collected,
            "summary": args.pytest_summary,
            "collection_guard": {
                "legacy": manifest["suites"]["legacy"]["collected"],
                "semantic": manifest["suites"]["semantic"]["collected"],
                "total": manifest["total_collected"],
                "expected_minimum": manifest["expected_minimum"],
            },
        },
        "forbidden_during_production": [
            "prompt", "schema", "ontology", "mechanism registry", "compiler", "oracle",
            "coverage controller", "fingerprint", "quality thresholds",
        ],
        "invalidation_policy": (
            "发现 blocker 即宣告当前 production run INVALIDATED；version bump + 重新 freeze"
            " + 从 0 开始新的 500 fresh worlds；禁止混合两个 production contract 凑 500（brief §21）。"
        ),
    }

    payload = (json.dumps(freeze, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    OUT_JSON.write_bytes(payload)
    OUT_SHA.write_bytes(
        f"{hashlib.sha256(payload).hexdigest()}  {OUT_JSON.name}\n".encode("ascii")
    )
    lines = [f"{entry['sha256']}  {entry['path']}" for entry in components.values()]
    lines.append(f"{hashlib.sha256(payload).hexdigest()}  {OUT_JSON.name}")
    OUT_SUMS.write_bytes(("\n".join(lines) + "\n").encode("ascii"))

    print(f"wrote {OUT_JSON.name} ({len(payload)} bytes)")
    print(f"components: {len(components)}")
    print(f"tests: collected={args.pytest_collected}  summary={args.pytest_summary!r}")
    print(f"verify with: sha256sum -c {OUT_SUMS.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
