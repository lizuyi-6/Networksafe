"""``canonical_json`` / ``stable_hash`` 的确定性与规范化契约。

设计 §7 R7：同一份数据必须产出同一串字节。``dict`` 迭代序、``set`` 哈希随机化、
``PYTHONHASHSEED`` 都会让"看起来一样的 JSON"得到不同哈希——于是
``test_determinism_byte_identical`` 与 dedup 全部失效。这些测试就是那条性质的
可证伪断言。
"""
from __future__ import annotations

import ast
import dataclasses
import enum
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from security_world.model import (
    canonical_bytes,
    canonical_json,
    derive_family_id,
    short_hash,
    stable_hash,
    to_plain_json,
)

MODEL_DIR = Path(__file__).resolve().parents[2] / "security_world" / "model"


def test_canonical_json_sorts_keys_and_uses_compact_separators():
    assert canonical_json({"b": 1, "a": 2}) == '{"a":2,"b":1}'
    assert canonical_json({"a": [1, 2], "b": {"c": None}}) == '{"a":[1,2],"b":{"c":null}}'


def test_canonical_json_keeps_non_ascii_literal():
    """``ensure_ascii=False``：转义会让同一份数据在不同工具链下字节不同。"""
    assert canonical_json({"name": "订单 183"}) == '{"name":"订单 183"}'


def test_canonical_json_is_independent_of_dict_insertion_order():
    left = {}
    left["z"] = 1
    left["a"] = 2
    left["m"] = 3
    right = {}
    right["a"] = 2
    right["m"] = 3
    right["z"] = 1
    assert canonical_json(left) == canonical_json(right)
    assert stable_hash(left) == stable_hash(right)


def test_canonical_json_normalises_tuples_and_sets():
    assert canonical_json(("a", "b")) == '["a","b"]'
    # 集合按元素自身的规范化 JSON 排序，与插入顺序、与 PYTHONHASHSEED 无关。
    assert canonical_json(frozenset({"b", "a", "c"})) == '["a","b","c"]'
    assert canonical_json({"s": {3, 1, 2}}) == '{"s":[1,2,3]}'


def test_canonical_json_handles_enum_and_dataclass():
    class Colour(enum.Enum):
        RED = "red"

    @dataclasses.dataclass(frozen=True)
    class Pair:
        left: str
        right: int

    assert canonical_json({"c": Colour.RED}) == '{"c":"red"}'
    assert canonical_json(Pair("a", 1)) == '{"left":"a","right":1}'


def test_canonical_json_prefers_to_document_over_asdict():
    @dataclasses.dataclass(frozen=True)
    class Weird:
        def to_document(self):
            return {"only": "this"}

        def __post_init__(self):
            object.__setattr__(self, "ignored", "that")

    assert canonical_json(Weird()) == '{"only":"this"}'


def test_canonical_json_rejects_non_finite_floats():
    """``NaN`` / ``Infinity`` 不是合法 JSON，静默写出去会破坏跨工具字节一致。"""
    for bad in (float("nan"), float("inf"), float("-inf")):
        with pytest.raises(ValueError, match="非有限浮点数|Out of range"):
            canonical_json({"x": bad})


def test_canonical_json_rejects_non_string_keys():
    with pytest.raises(ValueError, match="字符串键"):
        canonical_json({1: "a"})


def test_canonical_json_rejects_unknown_types():
    with pytest.raises(ValueError, match="无法序列化"):
        canonical_json({"when": object()})


def test_canonical_bytes_is_utf8_of_canonical_json():
    payload = {"世界": "安全", "n": 3}
    assert canonical_bytes(payload) == canonical_json(payload).encode("utf-8")


def test_stable_hash_is_sha256_of_canonical_json():
    import hashlib

    payload = {"b": 1, "a": [1, 2, 3]}
    assert stable_hash(payload) == hashlib.sha256(canonical_bytes(payload)).hexdigest()
    assert len(stable_hash(payload)) == 64


def test_short_hash_takes_the_prefix_and_rejects_bad_length():
    digest = stable_hash({"a": 1})
    assert short_hash({"a": 1}) == digest[:12]
    assert short_hash({"a": 1}, 4) == digest[:4]
    with pytest.raises(ValueError, match="length"):
        short_hash({"a": 1}, 0)


def test_stable_hash_is_stable_across_pythonhashseed():
    """子进程换 ``PYTHONHASHSEED`` 后哈希必须不变（R7 的 test_pythonhashseed_stable）。"""
    program = (
        "import json,sys;"
        "sys.path.insert(0, sys.argv[1]);"
        "from security_world.model import stable_hash;"
        "print(stable_hash(json.loads(sys.argv[2])))"
    )
    project_root = str(Path(__file__).resolve().parents[2])
    payload = json.dumps({"b": 1, "a": ["x", "y"], "s": ["p", "q"]})
    digests = set()
    for hash_seed in ("0", "1", "12345", "99991"):
        env = dict(os.environ)
        env["PYTHONHASHSEED"] = hash_seed
        completed = subprocess.run(
            [sys.executable, "-c", program, project_root, payload],
            capture_output=True,
            text=True,
            env=env,
            check=True,
        )
        digests.add(completed.stdout.strip())
    assert len(digests) == 1, f"不同 PYTHONHASHSEED 得到不同哈希: {digests}"


def test_derive_family_id_requires_dash_terminated_prefix():
    with pytest.raises(ValueError, match="前缀"):
        derive_family_id("WF", {"a": 1})


def test_derive_family_id_is_order_sensitive_and_deterministic():
    first = derive_family_id("WF-", ["a", "b"])
    second = derive_family_id("WF-", ["b", "a"])
    assert first.startswith("WF-") and len(first) == 15
    assert first == derive_family_id("WF-", ["a", "b"])
    assert first != second


def test_to_plain_json_detaches_nested_mappings():
    source = {"outer": {"inner": [1, 2]}}
    plain = to_plain_json(source)
    plain["outer"]["inner"].append(3)
    assert source == {"outer": {"inner": [1, 2]}}, "to_plain_json 必须切断共享引用"


def test_model_package_has_no_dynamic_code_entrypoints():
    """L1 是审计面：不允许 ``eval`` / ``exec`` / ``compile`` / 动态 import。

    世界状态与标签必须由可读的确定性 Python 产生；任何"把字符串当代码跑"的入口
    都是不可审计的旁路（设计 §7.1 的"封闭、无副作用、可静态分析"立场）。
    """
    banned_calls = {"eval", "exec", "compile", "__import__"}
    for path in sorted(MODEL_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id not in banned_calls, f"{path.name} 调用了 {node.func.id}()"
            if isinstance(node, ast.ImportFrom) and any(alias.name == "*" for alias in node.names):
                raise AssertionError(f"{path.name} 含有 star import")
