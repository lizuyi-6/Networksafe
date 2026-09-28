"""从**冻结的 Phase 2A schema** 派生 production schema（Phase 2B brief §6/§7）。

为什么用脚本派生而不是手写副本：production schema 必须与 Phase 2A 冻结版**只差 ID 归属
这一处**。手写 200 行 JSON 迟早漂进一处无意改动，而这里要能向审计者证明"除了把
``skeleton_id`` 从 provider 责任里删掉，别的一个字节都没动"。

做法：读冻结 schema → 校验它的 sha256 与 PHASE2A-FINAL-FREEZE 记录一致 → 施加三处
显式编辑 → 落盘 → 打印逐字节 diff 统计。任何"预期外差异"都会让脚本非零退出。

Phase 2A 的 ``semantic_skeleton/schemas/semantic-skeleton.schema.json`` **保持逐字节
不变**（它被 PHASE2A-FINAL-FREEZE 哈希）；production 版是同级新目录下的新文件。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FROZEN_SCHEMA = ROOT / "semantic_skeleton" / "schemas" / "semantic-skeleton.schema.json"
PRODUCTION_SCHEMA = ROOT / "semantic_skeleton" / "schemas" / "production" / "semantic-skeleton.schema.json"

#: PHASE2A-FINAL-FREEZE.json 里记录的冻结 schema sha256。
FROZEN_SHA256 = "82bc9516e089f9b37bd1f56b97da79d6faa83e020b74d4dac545a00196a3874d"

#: Phase 2A schema 的版本号（写进新 title，便于 provenance 一眼看出契约代际）。
PHASE2A_SCHEMA_VERSION = "v0.1"
PRODUCTION_SCHEMA_VERSION = "v0.2-production"

#: 允许存在的差异键（除此之外一个字节都不许差）。
ALLOWED_TOP_LEVEL_CHANGES = {"title", "description", "required", "properties"}

PROVIDER_CLAIMED_ID_PROPERTY = {
    "type": "string",
    "maxLength": 67,
    "description": (
        "PROVENANCE ONLY. The id the provider claims for itself. It has NO canonical "
        "meaning: the canonical skeleton_id, world_id, entity ids, seed and every hash "
        "are derived by the program from the skeleton's semantic content "
        "(semantic_skeleton/identity.py). Repeating an id another skeleton already "
        "claimed is recorded, never a rejection reason - only a semantic duplicate is."
    ),
}


def build() -> tuple[dict, dict]:
    """返回 (production schema, 变更报告)。"""
    raw = FROZEN_SCHEMA.read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != FROZEN_SHA256:
        raise SystemExit(
            f"拒绝派生：冻结 schema 的 sha256 与 PHASE2A-FINAL-FREEZE 不一致"
            f"（期望 {FROZEN_SHA256}，实际 {actual}）。Phase 2A 冻结产物被改动过，"
            "先查清原因再继续。"
        )
    frozen = json.loads(raw.decode("utf-8"))

    schema = json.loads(json.dumps(frozen))  # 深拷贝，绝不原地改冻结字典
    changes: dict[str, object] = {}

    schema["title"] = (
        f"Aether Security World - Semantic Skeleton {PRODUCTION_SCHEMA_VERSION} "
        f"(derived from frozen Phase 2A {PHASE2A_SCHEMA_VERSION}; ID ownership moved to code)"
    )
    changes["title"] = [frozen["title"], schema["title"]]

    schema["description"] = (
        frozen["description"]
        + " PRODUCTION CONTRACT (Phase 2B): the provider owns NO identifier. "
        "`skeleton_id` is REMOVED from the provider contract - the canonical id is derived "
        "deterministically from this document's semantic content by "
        "semantic_skeleton/identity.py. A provider may still claim an id; it is accepted "
        "only as the optional provenance-only field `provider_claimed_id`."
    )
    changes["description"] = ["<frozen Phase 2A description> + production ID-ownership clause"]

    if "skeleton_id" not in frozen["required"]:
        raise SystemExit("冻结 schema 的 required 里没有 skeleton_id——与预期不符，停止。")
    schema["required"] = [key for key in frozen["required"] if key != "skeleton_id"]
    changes["required"] = {
        "removed": ["skeleton_id"],
        "now": schema["required"],
    }

    if "skeleton_id" not in frozen["properties"]:
        raise SystemExit("冻结 schema 的 properties 里没有 skeleton_id——与预期不符，停止。")
    del schema["properties"]["skeleton_id"]
    schema["properties"]["provider_claimed_id"] = json.loads(
        json.dumps(PROVIDER_CLAIMED_ID_PROPERTY)
    )
    changes["properties"] = {
        "removed": ["skeleton_id"],
        "added": ["provider_claimed_id"],
        "everything_else": "structurally identical to the frozen Phase 2A schema",
    }

    return schema, changes


def main() -> int:
    schema, changes = build()
    frozen = json.loads(FROZEN_SCHEMA.read_text(encoding="utf-8"))

    # 逐字节级的差异自证：除了白名单键，其余顶层键必须完全相等。
    for key in set(frozen) | set(schema):
        if key in ALLOWED_TOP_LEVEL_CHANGES:
            continue
        if frozen.get(key) != schema.get(key):
            raise SystemExit(f"预期外差异：顶层键 {key!r} 与冻结版不一致。停止。")
    for key in set(frozen["properties"]) | set(schema["properties"]):
        if key in ("skeleton_id", "provider_claimed_id"):
            continue
        if frozen["properties"].get(key) != schema["properties"].get(key):
            raise SystemExit(f"预期外差异：properties[{key!r}] 与冻结版不一致。停止。")

    PRODUCTION_SCHEMA.parent.mkdir(parents=True, exist_ok=True)
    # 显式 write_bytes + LF：Windows 的 write_text 会把 "\n" 翻成 "\r\n"，落盘字节与
    # 这里算出的 sha256 就不是同一个东西；冻结哈希必须对落盘字节算，且跨平台可复现。
    text = json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    payload = text.encode("utf-8")
    PRODUCTION_SCHEMA.write_bytes(payload)
    digest = hashlib.sha256(payload).hexdigest()
    print(f"wrote {PRODUCTION_SCHEMA.relative_to(ROOT)} ({len(payload)} bytes, sha256 {digest})")
    print(json.dumps(changes, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
