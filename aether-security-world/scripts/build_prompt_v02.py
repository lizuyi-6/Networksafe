"""把 prompt v0.1 升级为 v0.2：头块升版 + 插入 schema 导出的嵌套字段契约。

v0.1 的业务逻辑段落（Your job / Diversity / Reminder）逐字保留；被替换的只有
"What a world seed must contain" 小节的顶层键列表（v0.2 的字段契约取代它）。
契约文本来自 .zcode-prompt-contract-v02.md（由 world-spec/world/evidence/policy
四个 schema 机械导出后人工核对）。产出 generation/prompts/v0.2.md。
"""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
src = (root / "generation" / "prompts" / "v0.1.md").read_text(encoding="utf-8")
contract = (root / ".zcode-prompt-contract-v02.md").read_text(encoding="utf-8")
lines = src.splitlines()

header = (
    "# prompt_version: 0.2\n"
    "# output_format: json_array\n"
    "# schema_contract: world-spec.schema.json\n"
    "# default_batch_size: 5\n"
    "# max_output_tokens: 32768\n"
)

body_start = next(i for i, l in enumerate(lines) if l.startswith("# Aether Security World"))
job_idx = next(i for i, l in enumerate(lines) if l.startswith("## Your job"))
head_part = "\n".join(lines[body_start:job_idx]).rstrip() + "\n"
tail_part = "\n".join(lines[job_idx:]).rstrip() + "\n"

marker = "Each element needs these top-level keys (all required by the schema):"
assert marker in head_part, "v0.1 key-list marker not found"
head_part = head_part[: head_part.index(marker)]

out = header + "\n" + head_part + contract + "\n" + tail_part
(root / "generation" / "prompts" / "v0.2.md").write_text(out, encoding="utf-8")
(root / ".zcode-prompt-contract-v02.md").unlink()
print("written:", root / "generation" / "prompts" / "v0.2.md", len(out.splitlines()), "lines")
