"""构建 prompt v0.6：v0.5 + 真实 smoke 学到的最后两条合同规则。

v0.5 真实 smoke：5/5 过 schema（合同层修复确认）。剩余 4 个下游失败：
1 个 resource.*.state 轴被白名单拒（已修 configs/default.json，REVISION 1.5）；
2 个可见证据缺 timestamp（七键投影必需）；
2 个带 binds 的事件缺 operation（v0.5 规则只约束了决策事件，但每个带 binds
的事件都会成为 probe action）。v0.6 把这两条升级为普适规则。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    v05 = (ROOT / "generation" / "prompts" / "v0.5.md").read_text(encoding="utf-8")
    header = (
        "# prompt_version: 0.6\n"
        "# output_format: json_array\n"
        "# schema_contract: world-spec.schema.json\n"
        "# default_batch_size: 5\n"
        "# max_output_tokens: 32768\n"
    )
    body = v05.split("\n", 6)[6]
    body = body.replace("## Field contract (v0.5;", "## Field contract (v0.6;", 1)

    additions = """## v0.6 additions (found by the fifth real batch)

- **Every** event that carries `binds` must include `operation` — not only the
  decision event. Each bound event becomes a probe action; without an operation the
  action cannot be built and the world is quarantined.
- Every evidence item with `visible_in_observation: true` must include `timestamp`
  (the model-visible seven-key projection requires it). Hidden items may omit it.
- `resource.<id>.state` is a valid critical axis (the whitelist now includes it).

"""
    marker = "## What changed in v0.5 (and why)"
    if marker in body:
        body = body[: body.index(marker)]
    out = header + "\n" + body + additions + "\n## What changed in v0.6 (and why)\n\nSee the section above; v0.1–v0.5 prose is otherwise unchanged.\n"
    (ROOT / "generation" / "prompts" / "v0.6.md").write_text(out, encoding="utf-8")
    print("written v0.6")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
