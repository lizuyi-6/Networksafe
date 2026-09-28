"""构建 prompt v0.7：v0.6 + session_states 定向强化。

真实 batch b003：5/5 元素因同一个错误被拒——``session_states`` 的值写了
``{valid, revoked}`` 却漏了必填的 ``privilege_version``。契约里速查表有这条，
但模型仍然稳定漏它；v0.7 在状态形状小节里直接内联一个完整示例（比速查表更显眼），
不改其他任何内容。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    v06 = (ROOT / "generation" / "prompts" / "v0.6.md").read_text(encoding="utf-8")
    header = (
        "# prompt_version: 0.7\n"
        "# output_format: json_array\n"
        "# schema_contract: world-spec.schema.json\n"
        "# default_batch_size: 5\n"
        "# max_output_tokens: 32768\n"
    )
    body = v06.split("\n", 6)[6]
    body = body.replace("## Field contract (v0.6;", "## Field contract (v0.7;", 1)

    anchor = "### State history and current state (same object shape)"
    assert anchor in body, "state-shape anchor not found"
    emphasis = """### State history and current state (same object shape)

**The most-repeated mistake in real batches:** a `session_states` value written as
`{"valid": true, "revoked": false}` — it is **missing the required
`privilege_version`**. A complete session state is
`{"valid": true, "revoked": false, "privilege_version": 1}`. Likewise a complete
`token_states` value is `{"used": false, "valid": true}` and a complete
`actor_states` value is `{"authentication_state": "authenticated", "privilege_version": 1}`.
Every `*_states` entry in **every** snapshot (state_history items AND current_state)
must be a complete object — check each one before emitting.

"""
    body = body.replace(anchor + "\n", emphasis, 1)

    additions = """## v0.7 addition (found by the sixth real batch)

See the session_states emphasis above: `privilege_version` is required in every
session state object, in every snapshot.

"""
    marker = "## What changed in v0.6 (and why)"
    if marker in body:
        body = body[: body.index(marker)]
    out = header + "\n" + body + additions + "\n## What changed in v0.7 (and why)\n\nSee the section above; v0.1–v0.6 prose is otherwise unchanged.\n"
    (ROOT / "generation" / "prompts" / "v0.7.md").write_text(out, encoding="utf-8")
    print("written v0.7")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
