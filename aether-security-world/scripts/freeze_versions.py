"""冻结 Phase 1.5 首次真实 provider run 的全部版本坐标（brief C）。

产出：

* ``state/frozen-versions.json`` —— prompt_version / prompt_sha256 /
  schema_bundle_sha256 / normalizer_version / compiler_version / oracle_version /
  parser_version / config_version / git commit。
* ``provenance/provider-run-001.json`` —— run 级 provenance 骨架（批次记录往里追加）。

规则（brief C）：run 中途不得无版本地改 prompt/schema。runner 每批前都重新计算
这些哈希，与冻结值不一致即拒绝继续（"发现致命错误 ⇒ 停 run、标记 invalid、升级
prompt_version、重新开始"，绝不一边生成一边改）。
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from generation.prompts import available_versions, load_prompt  # noqa: E402
from security_world.model.compile import COMPILER_VERSION  # noqa: E402
from security_world.model.config import load_default_config  # noqa: E402

#: 解析器（严格 JSON 帧解码 + world-spec 校验）版本。新引入，本次冻结为 0.1.0。
PARSER_VERSION = "0.1.0"
#: 规格归一化（spec 文档 -> 可编译形式的确定性规范化）版本。新引入，本次冻结。
NORMALIZER_VERSION = "0.1.0"
#: 首次真实 run 的标识（所有产物路径都以它命名）。
RUN_ID = "provider-run-001"


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def schema_bundle_sha256(schemas_dir: Path) -> tuple[str, list[dict[str, str]]]:
    """全部 schema 的捆绑哈希：排序后的 (文件名, 文件 sha256) 序列再取 sha256。"""
    entries = []
    for path in sorted(schemas_dir.glob("*.schema.json")):
        entries.append({"file": path.name, "sha256": _sha256_file(path)})
    bundle = json.dumps(entries, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(bundle).hexdigest(), entries


def git_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT.parents[0],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if out.returncode == 0:
            return out.stdout.strip()
    except OSError:
        pass
    return "unknown"


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="冻结 Phase 1.5 真实 provider run 的版本坐标")
    parser.add_argument("--prompt-version", default=None, help="默认用注册表里最新的 prompt 版本")
    args = parser.parse_args()
    version = args.prompt_version or sorted(available_versions())[-1]
    prompt = load_prompt(version)
    prompt_path = ROOT / "generation" / "prompts" / f"v{version}.md"
    prompt_sha256 = _sha256_file(prompt_path)
    bundle_hash, schema_entries = schema_bundle_sha256(ROOT / "schemas")
    config = load_default_config()
    oracle_version = str((config.get("oracle") or {}).get("version", "unknown"))
    config_sha256 = _sha256_file(ROOT / "configs" / "default.json")

    frozen = {
        "run_id": RUN_ID,
        "frozen_at_wallclock": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
        "prompt_version": prompt.version,
        "prompt_hash": prompt.prompt_hash,
        "prompt_sha256": prompt_sha256,
        "prompt_output_format": prompt.output_format,
        "prompt_default_batch_size": prompt.default_batch_size,
        "schema_bundle_sha256": bundle_hash,
        "schema_files": schema_entries,
        "config_sha256": config_sha256,
        "parser_version": PARSER_VERSION,
        "normalizer_version": NORMALIZER_VERSION,
        "compiler_version": COMPILER_VERSION,
        "oracle_version": oracle_version,
        "config_version": str(config.get("config_version", "unknown")),
        "git_commit": git_commit(),
        "provider": "stepfun-live",
        "provider_base_url_host": "api.stepfun.com/step_plan/v1",
        "model_default": "step-5-preview",
    }
    state_dir = ROOT / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "frozen-versions.json").write_text(
        json.dumps(frozen, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    provenance = {
        "run_id": RUN_ID,
        "generator_model": "step-5-preview",
        "generator_model_version": "unknown-until-first-response",
        "prompt_version": prompt.version,
        "prompt_hash": prompt.prompt_hash,
        "prompt_sha256": prompt_sha256,
        "schema_bundle_sha256": bundle_hash,
        "normalizer_version": NORMALIZER_VERSION,
        "compiler_version": COMPILER_VERSION,
        "oracle_version": oracle_version,
        "git_commit": frozen["git_commit"],
        "batches": [],
        "validation_outcome": "in_progress",
    }
    provenance_dir = ROOT / "provenance"
    provenance_dir.mkdir(parents=True, exist_ok=True)
    (provenance_dir / f"{RUN_ID}.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps({"frozen": frozen, "provenance": str(provenance_dir / f"{RUN_ID}.json")},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
