"""分层纪律：跨包只经包级公共 API，依赖方向必须是 DAG（设计 §3.1 / §15.2）。

``security_world`` 的顶层 ``__init__`` 故意**不** eager import 任何子包（见其
docstring）；这里静态断言两件事：

1. **每个子包的 import 边**符合设计的分层表——L5 可以 import L1..L4，L4 不 import
   L5/L6，L1 不 import 任何兄弟包；
2. **没有深导入**：``security_world.model.xxx`` 之外的包只能 ``from security_world.model
   import ...``（包级公共 API），不能 ``from security_world.model.entities import ...``。

第二条是"互不改对方文件"规则的机械化：深导入会把另一个子代理的私有模块变成自己
的编译期依赖，一次内部重构就炸到别人的测试。
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENGINE_ROOT = PROJECT_ROOT / "security_world"

#: 层级号（设计 §3.1）。数字小的在被依赖侧。
LAYER_OF = {
    "model": 1,
    "policy": 2,
    "invariants": 2,
    "workflows": 2,
    "oracle": 3,
    "expansion": 4,
    "validation": 5,
    "release": 6,
}

#: 允许的跨包 import（白名单，逐条有设计出处）。
ALLOWED_CROSS_PACKAGE: dict[str, frozenset[str]] = {
    # policy → workflows（L2 内部 DAG 的一条边，无环）
    "policy": frozenset({"workflows"}),
    # invariants → policy
    "invariants": frozenset({"policy"}),
    # oracle → policy / invariants（truth 趟要跑同一套规则）
    "oracle": frozenset({"policy", "invariants"}),
    # expansion → oracle（D → C 是唯一允许的跨包调用方向）
    "expansion": frozenset({"oracle"}),
    # validation → L1..L4
    "validation": frozenset({"model", "policy", "invariants", "oracle", "expansion"}),
    # release → L1..L5（不含 L7 generation：那是函数内延迟导入）
    "release": frozenset({"model", "policy", "invariants", "oracle", "expansion", "validation"}),
}


def _python_files() -> list[Path]:
    return sorted(
        path
        for path in ENGINE_ROOT.rglob("*.py")
        if "__pycache__" not in path.parts
    )


def _imports_of(path: Path) -> list[tuple[str, int]]:
    """文件里的全部 ``security_world.*`` import（模块名 + 行号）。"""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    out: list[tuple[str, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("security_world"):
            out.append((node.module, node.lineno))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith("security_world"):
                    out.append((alias.name, node.lineno))
    return out


def _owning_package(path: Path) -> str:
    relative = path.relative_to(ENGINE_ROOT)
    return relative.parts[0] if len(relative.parts) > 1 else "<root>"


def test_every_subpackage_declares_its_contract() -> None:
    """每个子包的 ``__all__`` 必须显式导出契约符号（设计 §15.2 硬规则 2）。"""
    for package in sorted(LAYER_OF):
        init = ENGINE_ROOT / package / "__init__.py"
        assert init.is_file(), f"缺少 {package}/__init__.py"
        text = init.read_text(encoding="utf-8")
        assert "__all__" in text, f"{package}/__init__.py 没有 __all__"
        tree = ast.parse(text)
        assigned = {
            node.targets[0].id
            for node in tree.body
            if isinstance(node, ast.Assign)
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == "__all__"
        }
        assert "__all__" in assigned, f"{package}/__init__.py 的 __all__ 不是模块级赋值"


def test_top_level_init_does_not_eager_import_subpackages() -> None:
    """顶层 ``__init__`` 不 import 任何子包（否则 A 的改动会变成 B 的导入失败）。"""
    init = (ENGINE_ROOT / "__init__.py").read_text(encoding="utf-8")
    tree = ast.parse(init)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("security_world."):
            raise AssertionError(f"顶层 __init__ 不得 import 子包: {node.module}")
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith("security_world."):
                    raise AssertionError(f"顶层 __init__ 不得 import 子包: {alias.name}")


def test_layer_dependencies_form_a_dag() -> None:
    """每个子包只能 import 层级号 ≤ 自己的兄弟包，且只在白名单里。"""
    problems: list[str] = []
    for path in _python_files():
        owner = _owning_package(path)
        if owner not in LAYER_OF:
            continue
        for module, line in _imports_of(path):
            parts = module.split(".")
            target = parts[1] if len(parts) > 1 else ""
            if target not in LAYER_OF or target == owner:
                continue
            if target not in ALLOWED_CROSS_PACKAGE.get(owner, frozenset()):
                problems.append(
                    f"{path.relative_to(PROJECT_ROOT)}:{line} {owner} → {target} 不在白名单里"
                )
            elif LAYER_OF[target] > LAYER_OF[owner]:
                problems.append(
                    f"{path.relative_to(PROJECT_ROOT)}:{line} {owner}(L{LAYER_OF[owner]}) 不得依赖 "
                    f"{target}(L{LAYER_OF[target]})"
                )
    assert problems == [], "\n".join(problems)


def test_no_deep_imports_across_packages() -> None:
    """跨包只经包级公共 API，禁止 ``security_world.<pkg>.<module>`` 深导入。"""
    problems: list[str] = []
    for path in _python_files():
        owner = _owning_package(path)
        for module, line in _imports_of(path):
            parts = module.split(".")
            if len(parts) < 3:
                continue
            target = parts[1]
            if target not in LAYER_OF:
                continue
            if target == owner:
                continue  # 包内相对/绝对导入是自己的事
            problems.append(
                f"{path.relative_to(PROJECT_ROOT)}:{line} 深导入 {module}"
                f"（应 from security_world.{target} import ...）"
            )
    assert problems == [], "\n".join(problems)


def test_no_network_or_subprocess_in_the_engine() -> None:
    """引擎里没有网络/子进程/挂钟调用（设计不可协商项 2 与 7 的静态面）。

    用 AST 而不是正则：docstring 里**提到** ``time.time()`` 是在解释禁令，不是调用它
    （``model/clock.py`` 与 ``model/rng.py`` 的模块 docstring 正是如此）。
    ``urllib.parse.unquote`` 是允许的——它是离线字符串归一，不是网络 IO。
    """
    forbidden_modules = {"socket", "requests", "http", "subprocess", "urllib.request"}
    forbidden_calls = {
        "time.time",
        "datetime.now",
        "datetime.datetime.now",
        "datetime.utcnow",
        "os.system",
        "os.popen",
    }
    forbidden_roots = {"socket", "requests", "subprocess"}
    problems: list[str] = []
    for path in _python_files():
        relative = path.relative_to(PROJECT_ROOT)
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    root = alias.name.split(".")[0]
                    if alias.name in forbidden_modules or root in forbidden_roots:
                        problems.append(f"{relative}:{node.lineno} import {alias.name}")
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                root = module.split(".")[0]
                if module in forbidden_modules or root in forbidden_roots:
                    problems.append(f"{relative}:{node.lineno} from {module} import ...")
            elif isinstance(node, ast.Call):
                target = _dotted_name(node.func)
                if target in forbidden_calls or (
                    target and target.split(".")[0] in forbidden_roots
                ):
                    problems.append(f"{relative}:{node.lineno} 调用 {target}()")
    assert problems == [], "\n".join(problems)


def _dotted_name(node: ast.AST) -> str:
    """把一个调用目标还原成点号名（``a.b.c``）；做不到就返回空串。"""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return ""


def test_no_real_credentials_in_the_engine() -> None:
    """引擎里没有真实凭据样式的字面量（只有合成占位）。"""
    patterns = (
        re.compile(r"AKIA[0-9A-Z]{16}"),
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
        re.compile(r"sk-[A-Za-z0-9]{24,}"),
    )
    problems: list[str] = []
    for path in list(_python_files()) + sorted((PROJECT_ROOT / "worlds").rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for pattern in patterns:
            if pattern.search(text):
                problems.append(f"{path.relative_to(PROJECT_ROOT)}: {pattern.pattern}")
    assert problems == [], "\n".join(problems)
