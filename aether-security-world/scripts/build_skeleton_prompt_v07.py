"""从**冻结的 prompt v0.6** 派生 production prompt v0.7（Phase 2B brief §6/§7）。

注意：production prompt 的文本（含词表块）派生自**冻结的 v0.6 字节**，不是活注册表——
OOD pilot 逼出的词表扩展（cache_service / ci_service 进 actor 词表）只改编译器的**验收
边界**（semantic_skeleton/vocabularies.py），不改 prompt 的语义内容（brief §8 禁止为此
动语义 prompt；prompt 是建议契约，编译器是验收边界，二者本来就不必同源）。

Phase 2B-0 明确禁止"借 production hardening 之名重新优化语义 prompt"（brief §8）。所以
v0.7 不是重写，而是一次**可证明最小**的差分：拿冻结的 v0.6 文本，只施加 ID 归属这一处
改动，然后用 difflib 逐行断言"除白名单行外一个字节都没动"。白名单只有五处，全部与
provider 不再拥有 ``skeleton_id`` 直接相关：

1. 标题代际（Phase 2A → Phase 2B production）；
2. 输出键清单去掉 ``skeleton_id``；
3. 规则 1 改成"ID 由程序从语义内容派生，不要输出任何 id 字段"；
4. / 5. 两个 worked example 去掉 ``skeleton_id`` 键。

v0.6.md 本身逐字节不动（被 PHASE2A-FINAL-FREEZE 哈希）。
"""
from __future__ import annotations

import difflib
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROMPTS_DIR = ROOT / "semantic_skeleton" / "prompts"
FROZEN_PROMPT = PROMPTS_DIR / "v0.6.md"

PROMPT_VERSION = "0.7"
PRODUCTION_PROMPT = PROMPTS_DIR / f"v{PROMPT_VERSION}.md"
#: PHASE2A-FINAL-FREEZE.json 里记录的 v0.6 sha256。
FROZEN_SHA256 = "1c891e4b6f51911d93f8c7bd86e9526147dcfcc5a59dc18b4623a4db3d2234bc"

OLD_TITLE = "# Aether Security World — Phase 2A semantic skeleton generator"
NEW_TITLE = "# Aether Security World — Phase 2B production semantic skeleton generator"

OLD_KEYS = "exactly these keys: skeleton_id, domain,"
NEW_KEYS = "exactly these keys: domain,"

OLD_RULE = "   every ID from a stable hash of your `skeleton_id`."
NEW_RULE = (
    "   every ID from a stable hash of your skeleton's semantic content. Do NOT emit any id\n"
    "   field: no `skeleton_id`, no `provider_claimed_id`, no example-style handles. The\n"
    "   canonical id is derived by the program; an id you invent has no meaning and is never\n"
    "   used."
)

OLD_EXAMPLES = (
    '{"skeleton_id": "SK-EXAMPLE-001", ',
    '{"skeleton_id": "SK-EXAMPLE-002", ',
)
NEW_EXAMPLES = ("{", "{")

#: 白名单：任何新增/删除行必须命中其中一条，否则脚本拒绝生成。
#: 新规则块的每一行都逐字列在这里——白名单是"允许的全部改动"，不是"看起来相关的改动"。
ALLOWED_LINE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^# Aether Security World — Phase 2[AB] .*semantic skeleton generator$"),
    re.compile(r"^exactly these keys: (skeleton_id, )?domain,"),
    re.compile(r"^\s*every ID from a stable hash of your `skeleton_id`\.$"),
    *(re.compile("^" + re.escape(line) + "$") for line in NEW_RULE.splitlines()),
    # 两个 worked example：删掉整行带 skeleton_id 的旧行，新增去掉该前缀的同行
    re.compile(r'^\{"skeleton_id": "SK-EXAMPLE-00[12]", '),
    re.compile(r'^\{"domain": "(saas|devops_platform)", '),
    re.compile(r"^\{$"),
)


def build() -> str:
    raw = FROZEN_PROMPT.read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != FROZEN_SHA256:
        raise SystemExit(
            f"拒绝派生：冻结 prompt v0.6 的 sha256 与 PHASE2A-FINAL-FREEZE 不一致"
            f"（期望 {FROZEN_SHA256}，实际 {actual}）。"
        )
    text = raw.decode("utf-8")

    def substitute(old: str, new: str) -> None:
        nonlocal text
        if text.count(old) != 1:
            raise SystemExit(f"预期片段在 v0.6 里出现 {text.count(old)} 次（应为 1）: {old[:60]!r}")
        text = text.replace(old, new)

    substitute(OLD_TITLE, NEW_TITLE)
    substitute(OLD_KEYS, NEW_KEYS)
    substitute(OLD_RULE, NEW_RULE)
    for old, new in zip(OLD_EXAMPLES, NEW_EXAMPLES):
        substitute(old, new)

    # 差分自证：逐行比对，任何改动行必须在白名单里。
    before = raw.decode("utf-8").splitlines()
    after = text.splitlines()
    for line in difflib.unified_diff(before, after, lineterm="", n=0):
        if line.startswith(("---", "+++", "@@")):
            continue
        if line[:1] not in "+-":
            continue
        if not any(pattern.search(line[1:]) for pattern in ALLOWED_LINE_PATTERNS):
            raise SystemExit(f"预期外改动行（不在 ID 归属白名单内）: {line[:160]}")
    return text


def main() -> int:
    text = build()
    # 显式 write_bytes：Windows 的 write_text 会把文本里的 "\n" 再翻译成 "\r\n"，
    # 而 v0.6 本身是 CRLF，结果每一行都变成 "\r\r\n"——整份文件 diff 全行不同，
    # 且这里算出的 sha256 与落盘字节不是同一个东西。冻结哈希必须对落盘字节算。
    payload = text.encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    PRODUCTION_PROMPT.write_bytes(payload)
    meta = {
        "prompt_version": PROMPT_VERSION,
        "prompt_sha256": digest,
        "derived_from": "semantic_skeleton/prompts/v0.6.md (PHASE2A-FINAL-FREEZE, frozen)",
        "derived_from_sha256": FROZEN_SHA256,
        "delta": "ID ownership only (vs frozen v0.6); compiler-side vocabulary extension is tracked separately",
        "output_format": "jsonl",
    }
    (PROMPTS_DIR / f"v{PROMPT_VERSION}.json").write_bytes(
        (json.dumps(meta, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    )
    print(f"wrote {PRODUCTION_PROMPT.relative_to(ROOT)} ({len(payload)} bytes, sha256 {digest})")
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
