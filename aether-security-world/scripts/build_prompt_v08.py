"""构建 prompt v0.8：v0.7 + 两条从真实隔离数据学到的可教学规则。

provider-run-001 的 21 个 raw worlds 里 11 个被质量门隔离，两类是可教学的：
- G12 词汇泄漏 ×5：模型把判决线索词（attack/malicious/unauthorized/…）写进
  world 文本（application.name、event summary、notes）——模型可见侧出现即拒。
- G3 policy 空洞 ×3：policy 条件恒真/恒假，非空洞探针抓不到 allow 与 deny 两侧。

v0.8 把这两条写成明确规则。G5（假设与程序真值不符）不在此列——那是模型的
可证伪先验，设计上就是"猜错即拒"，教不了也不该教。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    v07 = (ROOT / "generation" / "prompts" / "v0.7.md").read_text(encoding="utf-8")
    header = (
        "# prompt_version: 0.8\n"
        "# output_format: json_array\n"
        "# schema_contract: world-spec.schema.json\n"
        "# default_batch_size: 4\n"
        "# max_output_tokens: 65536\n"
    )
    body = v07.split("\n", 6)[6]
    body = body.replace("## Field contract (v0.7;", "## Field contract (v0.8;", 1)

    additions = """## v0.8 additions (found by the 21-world deep review)

**1. No verdict vocabulary in world text.** The model-visible surface must never
contain a word that hands over the answer. These words are rejected on sight
anywhere a model could read them — `application.name`, `application.description`,
event `summary`, `notes`, resource/actor `display_name`, evidence `source`:
malicious, unauthorized, attack, suspicious, invalid, violation, exploit,
exploitation, forbidden, blocked, denied, benign, idor, injection, malware (and
their case variants). Describe the *mechanics* instead: "support agent reads an
order belonging to another buyer", not "unauthorized access attempt". The
`decision_metadata` side and your `hypotheses` block may use these words — the
model-visible side may not. This is not style: a world whose text contains the
answer is rejected, not relabelled.

**2. Every policy must be non-vacuous.** A policy whose condition can never be
true (or is always true) is rejected by a probe that enumerates each referenced
path's declared domain. Make sure every `allow`/`deny` rule is reachable by at
least one concrete actor/resource/session/token combination, and that at least
one combination reaches the opposite effect for the same action. Concretely:
do not write conditions comparing a field against a value no entity in your
world can hold (e.g. `actor.roles` contains `"ROLE-GHOST"` when no such role
exists), and do not make the only rule for an operation a `lit true` default.

"""
    marker = "## What changed in v0.7 (and why)"
    if marker in body:
        body = body[: body.index(marker)]
    out = header + "\n" + body + additions + "\n## What changed in v0.8 (and why)\n\nSee the section above; v0.1–v0.7 prose is otherwise unchanged.\n"
    (ROOT / "generation" / "prompts" / "v0.8.md").write_text(out, encoding="utf-8")
    print("written v0.8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
