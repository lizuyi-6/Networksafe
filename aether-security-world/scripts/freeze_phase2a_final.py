"""Phase 2A 最终冻结（brief §13）：GO 之后把整个合同固化成可验算的产物。

产出三件：

* ``PHASE2A-FINAL-FREEZE.json`` —— 每个组件的 sha256 + 测试结果 + GO 门结果；
* ``PHASE2A-FINAL-FREEZE.sha256`` —— 上一文件自身的摘要（防篡改）；
* ``SHA256SUMS.txt`` —— 全部受冻结源文件的逐行摘要（``sha256sum -c`` 可复算）。

只覆盖**源**（prompt/schema/ontology/registry/compiler/oracle/coverage/fingerprint/
provider client/tests），不覆盖生成数据——数据是带自己 manifest 的冻结产物，
不该把字节塞进代码历史（与 ``.gitignore`` 的约定一致）。

用法::

    py -3 scripts/freeze_phase2a_final.py [--go-json reports/phase2a/go-no-go-confirmation.json]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]

#: (名称, 路径, 说明)
FROZEN_COMPONENTS: tuple[tuple[str, str, str], ...] = (
    ("prompt", "semantic_skeleton/prompts/v0.6.md", "generator prompt（v0.6，冻结）"),
    ("skeleton_schema", "semantic_skeleton/schemas/semantic-skeleton.schema.json",
     "语义骨架 schema"),
    ("ontology", "semantic_skeleton/ontology.py", "语义事实本体"),
    ("mechanism_registry", "semantic_skeleton/mechanisms.py", "机制族注册表"),
    ("compiler", "semantic_skeleton/compiler/compiler.py", "确定性编译器"),
    ("compiler_archetypes", "semantic_skeleton/compiler/archetypes.py", "不变量原型库"),
    ("compiler_plan", "semantic_skeleton/compiler/plan.py", "WorldPlan 与槽解析"),
    ("compiler_errors", "semantic_skeleton/compiler/errors.py", "失败分类词表"),
    ("oracle", "security_world/oracle/oracle.py", "Oracle（两趟判决）"),
    ("coverage_controller", "semantic_skeleton/coverage.py", "覆盖控制器（含 least-used 调度）"),
    ("fingerprint", "semantic_skeleton/fingerprint.py", "语义指纹实现"),
    ("provider_client", "semantic_skeleton/generator/live.py", "加固版 provider 客户端"),
    ("counterfactual_verifier", "semantic_skeleton/validators/verify.py", "先验复核器"),
    ("skeleton_gate", "semantic_skeleton/skeleton.py", "§17 禁止字段扫描"),
    ("config", "configs/phase2a.json", "Phase 2A 配置（含租户轴白名单）"),
)

#: 参与冻结的测试目录（两个 suite 分别记录，因为 ``testpaths`` 只收 ``tests/``）。
TEST_SUITES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("legacy_suite", ("tests",)),
    ("phase2a_suite", ("semantic_skeleton/tests",)),
)


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _run_tests() -> dict[str, Any]:
    """跑两个 suite 并如实记录结果（不吞输出、不改退出码语义）。"""
    out: dict[str, Any] = {}
    for name, paths in TEST_SUITES:
        proc = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", *paths],
            cwd=str(ROOT), capture_output=True, text=True, timeout=2400,
        )
        tail = [line for line in proc.stdout.splitlines() if line.strip()][-1:] or [""]
        out[name] = {
            "paths": list(paths),
            "exit_code": proc.returncode,
            "passed": proc.returncode == 0,
            "summary": tail[0].strip(),
        }
    return out


def build(go_json: Path) -> dict[str, Any]:
    components: dict[str, Any] = {}
    for name, relative, description in FROZEN_COMPONENTS:
        path = ROOT / relative
        if not path.is_file():
            raise SystemExit(f"冻结组件缺失: {relative}")
        components[name] = {
            "path": relative,
            "sha256": _sha256_file(path),
            "description": description,
        }

    tests = _run_tests()
    go = json.loads(go_json.read_text(encoding="utf-8")) if go_json.is_file() else {}
    decision = go.get("decision") or {}

    frozen_versions_path = ROOT / "state" / "phase2a-frozen.json"
    run_freeze = (
        json.loads(frozen_versions_path.read_text(encoding="utf-8"))
        if frozen_versions_path.is_file() else {}
    )

    return {
        "artifact": "PHASE2A-FINAL-FREEZE",
        "status": "PHASE_2A_PRODUCTION_READY" if decision.get("go") else "PHASE_2A_NOT_READY",
        "frozen_at_wallclock": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
        "phase": "2A",
        "architecture": (
            "LLM → Semantic Skeleton → Deterministic Compiler → ASW world-spec "
            "→ existing gates → Oracle"
        ),
        "components": components,
        "run_contract": {
            "run_id": "provider-run-002",
            "prompt_version": run_freeze.get("prompt_version"),
            "prompt_sha256": run_freeze.get("prompt_sha256"),
            "skeleton_schema_bundle_sha256": run_freeze.get("skeleton_schema_bundle_sha256"),
            "config_sha256": run_freeze.get("config_sha256"),
            "compiler_version": run_freeze.get("compiler_version"),
        },
        "confirmation_run": {
            "run_id": "provider-run-003",
            "audit": str(go_json.relative_to(ROOT)),
        },
        "tests": tests,
        "go_gate": {
            "source": str(go_json.relative_to(ROOT)) if go_json.is_file() else None,
            "go": decision.get("go"),
            "passed": decision.get("passed"),
            "total": decision.get("total"),
            "criteria": decision.get("criteria"),
        },
        "next_phase_blocked": (
            "GO 后按 brief §14 STOP：不自动进入 500-world production。"
            "production budget / generator-OOD pilot / release split strategy / "
            "episode expansion scale / ASW v0.x freeze policy 需单独决定。"
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 2A 最终冻结")
    parser.add_argument("--go-json", default="reports/phase2a/go-no-go-confirmation.json")
    parser.add_argument("--out-dir", default=".")
    args = parser.parse_args()
    payload = build(ROOT / args.go_json)
    out_dir = ROOT / args.out_dir

    freeze_path = out_dir / "PHASE2A-FINAL-FREEZE.json"
    freeze_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    digest = hashlib.sha256(freeze_path.read_bytes()).hexdigest()
    (out_dir / "PHASE2A-FINAL-FREEZE.sha256").write_text(
        digest + "  PHASE2A-FINAL-FREEZE.json\n", encoding="utf-8"
    )

    lines = []
    for name in sorted(payload["components"]):
        entry = payload["components"][name]
        lines.append(f"{entry['sha256']}  {entry['path']}")
    lines.append(f"{digest}  PHASE2A-FINAL-FREEZE.json")
    (out_dir / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"status: {payload['status']}")
    print(f"components frozen: {len(payload['components'])}")
    for name, result in payload["tests"].items():
        print(f"tests {name}: {result['summary']} (exit {result['exit_code']})")
    print(f"go gate: {payload['go_gate']['passed']}/{payload['go_gate']['total']} "
          f"go={payload['go_gate']['go']}")
    print(f"wrote {freeze_path.name}, PHASE2A-FINAL-FREEZE.sha256, SHA256SUMS.txt")
    return 0 if payload["go_gate"]["go"] and all(
        result["passed"] for result in payload["tests"].values()
    ) else 1


if __name__ == "__main__":
    raise SystemExit(main())
