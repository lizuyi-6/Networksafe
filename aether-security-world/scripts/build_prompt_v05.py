"""构建 prompt v0.5：v0.4 + 两条真实 batch 学到的合同细化。

v0.4 真实 batch：3/5 过 schema+compile（其中 1 个轴白名单拒绝——模型用了
session.<id>.privilege_version，该路径在 session 实体上不存在，特权版本在
privilege_snapshot 里）；2 个 expansion 时 binds 缺 operation（代码已修为类型化
错误 BindsIncompleteError，世界按 reason code 隔离，但合同该防住它）。

v0.5 只加规则，不动 v0.4 的业务逻辑段落与骨架。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    v04 = (ROOT / "generation" / "prompts" / "v0.4.md").read_text(encoding="utf-8")
    header = (
        "# prompt_version: 0.5\n"
        "# output_format: json_array\n"
        "# schema_contract: world-spec.schema.json\n"
        "# default_batch_size: 5\n"
        "# max_output_tokens: 32768\n"
    )
    body = v04.split("\n", 6)[6]
    body = body.replace("## Field contract (v0.4;", "## Field contract (v0.5;", 1)

    additions = """## v0.5 additions (found by the fourth real batch)

- The **decision event's** `binds` MUST include `operation` (and `resource_id` when
  the action targets a resource). A decision event without a bound operation cannot be
  turned into an action; such a world is quarantined, not repaired.
- Critical axes must be paths that **exist on the entity**. There is no
  `session.<id>.privilege_version`; a session's privilege version lives at
  `session.<id>.privilege_snapshot.privilege_version`. The same rule applies to every
  entity: check the field against the entity shapes above before naming it.

"""
    marker = "## What changed in v0.4 (and why)"
    if marker in body:
        body = body[: body.index(marker)]
    out = header + "\n" + body + additions + "\n## What changed in v0.5 (and why)\n\nSee the section above; v0.1–v0.4 prose is otherwise unchanged.\n"
    (ROOT / "generation" / "prompts" / "v0.5.md").write_text(out, encoding="utf-8")
    print("written v0.5")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
