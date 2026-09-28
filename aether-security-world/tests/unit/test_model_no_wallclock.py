"""数据路径无挂钟 / 无全局随机的静态守卫（设计 §7 R7 / §8.1）。

这是**源码级**断言而不是运行期断言：一次 ``time.time()`` 就足以让
"同种子 ⇒ 同字节"（Gate 4）在整个 release 上失效，而运行期测试只能抓住它一次。
用 ``ast`` 走 ``security_world/**``，把禁用的调用与 import 直接钉死。

被排除的正当用法只有两处，且都在 ``rng.py`` / ``clock.py`` 内部：

* ``random.Random(seed)`` —— 局部实例，种子由调用方给出；
* ``datetime`` 的纯函数（``fromisoformat`` / ``astimezone`` / 比较）——不读挂钟。

REVISION 2（任务书 A8）：守卫范围从 ``security_world/model/**`` 扩展到**整个
引擎**（policy / invariants / workflows / oracle / expansion / validation /
release）——world/episode 的每一条程序化生成路径都在这些包里，只守 L1 会漏掉
"上游干净、下游读挂钟"的形态。实证：全引擎扫描零命中（唯一的 ``time.monotonic``
在 ``generation/step5/live.py`` 的 provider 计时里，不是数据路径）。
"""
from __future__ import annotations

import ast
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parents[2] / "security_world" / "model"
ENGINE_DIR = Path(__file__).resolve().parents[2] / "security_world"

#: 禁用的调用（属性形式）。这些都会引入墙钟时间或进程级随机状态。
FORBIDDEN_CALLS = frozenset({
    "time.time",
    "time.time_ns",
    "time.monotonic",
    "time.perf_counter",
    "time.process_time",
    "datetime.now",
    "datetime.utcnow",
    "datetime.today",
    "date.today",
    "os.urandom",
    "secrets.token_bytes",
    "secrets.token_hex",
    "secrets.randbelow",
    "secrets.choice",
    "uuid.uuid1",
    "uuid.uuid4",
    "random.random",
    "random.seed",
    "random.randint",
    "random.choice",
    "random.choices",
    "random.shuffle",
    "random.sample",
    "random.uniform",
    "random.getrandbits",
})

#: 禁用的模块导入（挂钟 / 进程随机 / 全局随机）。
FORBIDDEN_MODULES = frozenset({"secrets", "uuid"})

#: 允许出现 ``random`` 的文件（只允许 ``random.Random(seed)`` 这一种用法）。
RNG_OWNER = "rng.py"


def _dotted(node: ast.AST) -> str:
    """把 ``a.b.c`` 形态的属性访问还原成点分字符串。"""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))


def _iter_calls(tree: ast.AST):
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            yield node


def test_no_wallclock_or_global_random_in_the_model_package():
    offenders: list[str] = []
    for path in sorted(MODEL_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in _iter_calls(tree):
            target = _dotted(node.func)
            if target in FORBIDDEN_CALLS:
                offenders.append(f"{path.name}: 调用了 {target}()")
            if target.startswith("random.") and path.name != RNG_OWNER:
                offenders.append(f"{path.name}: 在 {RNG_OWNER} 之外调用了 {target}()")
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    root = alias.name.split(".")[0]
                    if root in FORBIDDEN_MODULES:
                        offenders.append(f"{path.name}: import 了 {alias.name}")
            elif isinstance(node, ast.ImportFrom):
                root = (node.module or "").split(".")[0]
                if root in FORBIDDEN_MODULES:
                    offenders.append(f"{path.name}: from {node.module} import ...")
    assert not offenders, "数据路径出现挂钟/全局随机源:\n" + "\n".join(offenders)


def test_the_only_random_usage_is_a_local_seeded_instance():
    """``random.Random`` 只允许出现在 rng.py，且必须带参数（局部实例）。"""
    for path in sorted(MODEL_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in _iter_calls(tree):
            if _dotted(node.func) != "random.Random":
                continue
            assert path.name == RNG_OWNER, f"{path.name} 构造了 random.Random"
            assert node.args, f"{path.name}: random.Random() 必须显式传入种子"


def test_the_model_package_imports_no_time_module():
    for path in sorted(MODEL_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                assert all(alias.name.split(".")[0] != "time" for alias in node.names), path.name
            elif isinstance(node, ast.ImportFrom):
                assert (node.module or "").split(".")[0] != "time", path.name


def test_the_model_package_reads_no_environment_variables():
    """``configs/default.json`` 的约定：任何东西都不得依赖挂钟、环境或线程调度。"""
    offenders: list[str] = []
    for path in sorted(MODEL_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            target = ""
            if isinstance(node, ast.Call):
                target = _dotted(node.func)
            if target in {"os.environ.get", "os.getenv", "environ.get"}:
                offenders.append(f"{path.name}: 读取环境变量 {target}()")
            elif isinstance(node, ast.Attribute) and _dotted(node) == "os.environ":
                offenders.append(f"{path.name}: 访问 os.environ")
    assert not offenders, "数据路径不得依赖环境变量:\n" + "\n".join(offenders)


def test_the_forbidden_list_is_not_vacuous():
    """守卫本身要可证伪：确认这些名字确实解析得到。"""
    import random
    import secrets
    import time
    import uuid

    assert callable(time.time)
    assert callable(random.random)
    assert callable(secrets.token_bytes)
    assert callable(uuid.uuid4)


def _scan(directory: Path) -> list[str]:
    offenders: list[str] = []
    for path in sorted(directory.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                target = _dotted(node.func)
                if target in FORBIDDEN_CALLS:
                    offenders.append(f"{path.name}: 调用了 {target}()")
                if target.startswith("random.") and path.name != RNG_OWNER:
                    offenders.append(f"{path.name}: 在 {RNG_OWNER} 之外调用了 {target}()")
    return offenders


def test_no_wallclock_or_global_random_anywhere_in_the_engine() -> None:
    """REVISION 2（A8）：整个 ``security_world/**`` 都没有挂钟/全局随机。

    范围比 ``test_no_wallclock_or_global_random_in_the_model_package`` 大：oracle /
    expansion / validation / release 的每一条生成路径都被覆盖——一次
    ``time.time()`` 渗进任一层都会让"同种子 ⇒ 同字节"在全 release 上失效。
    """
    offenders = _scan(ENGINE_DIR)
    assert not offenders, "引擎里出现挂钟/全局随机源:\n" + "\n".join(offenders)


def test_the_engine_imports_no_time_module() -> None:
    for path in sorted(ENGINE_DIR.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                assert all(alias.name.split(".")[0] != "time" for alias in node.names), path.name
            elif isinstance(node, ast.ImportFrom):
                assert (node.module or "").split(".")[0] != "time", path.name
