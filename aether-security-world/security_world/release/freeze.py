"""冻结与校验（设计 §15.3 的 ``freeze`` / release 的不可变性）。

``freeze(out_dir)`` 的契约只有一条：**已冻结的 release 拒绝被覆盖**。修改必须是新
的 ``release_id``——否则"冻结"这个词没有任何工程含义，下游训练项目读到的字节会
在某次重跑后悄悄变化。

同时提供 :func:`verify_release`：重算 ``file_sha256`` 索引并与 manifest 对账。
它是"冻结"唯一可验证的承诺——字节没变。
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from ..model.canonical import canonical_json
from .errors import ReleaseError
from .manifest import EPISODES_NAME, FROZEN_NAME, MANIFEST_NAME

#: 冻结标记的内容（人读；机器只认文件存在）。
FROZEN_MARKER = "FROZEN - immutable release. Any change must be a new release_id.\n"


def is_frozen(out_dir: Path) -> bool:
    """该目录是否已是冻结 release。"""
    return Path(out_dir).joinpath(FROZEN_NAME).is_file()


def freeze(out_dir: Path, *, release_id: str | None = None) -> Path:
    """冻结一个已写出的 release；已冻结则拒绝覆盖。"""
    target = Path(out_dir)
    manifest_path = target / MANIFEST_NAME
    if not manifest_path.is_file():
        raise ReleaseError(
            "release_without_manifest", f"{target} 里没有 {MANIFEST_NAME}，先跑 build_release"
        )
    if is_frozen(target):
        raise ReleaseError(
            "release_already_frozen",
            f"{target} 已冻结（{FROZEN_NAME} 存在）。修改必须是新的 release_id，"
            "不得覆盖冻结产物",
        )
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    resolved_id = release_id or str(document.get("release_id") or "")
    marker = target / FROZEN_NAME
    marker.write_text(
        f"release_id={resolved_id}\ngit_commit={document.get('git_commit')}\n" + FROZEN_MARKER,
        encoding="utf-8",
    )
    return marker


def load_manifest(out_dir: Path) -> dict[str, Any]:
    """读 manifest（不存在即抛 :class:`ReleaseError`）。"""
    path = Path(out_dir) / MANIFEST_NAME
    if not path.is_file():
        raise ReleaseError("manifest_missing", f"{path} 不存在")
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ReleaseError("manifest_not_object", f"{path} 不是 JSON object")
    return document


def verify_release(out_dir: Path) -> list[dict[str, Any]]:
    """重算 ``file_sha256`` 并与 manifest 对账；返回不一致清单（空 == 一致）。"""
    target = Path(out_dir)
    document = load_manifest(target)
    mismatches: list[dict[str, Any]] = []
    for entry in document.get("file_sha256") or ():
        name = str(entry.get("path"))
        path = target / name
        if not path.is_file():
            mismatches.append({"path": name, "problem": "missing"})
            continue
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != entry.get("sha256"):
            mismatches.append(
                {"path": name, "problem": "sha256_mismatch", "expected": entry.get("sha256"), "actual": actual}
            )
    return mismatches


def load_episodes(out_dir: Path) -> list[dict[str, Any]]:
    """读 ``episodes.jsonl``（一行一个 episode 文档）。"""
    path = Path(out_dir) / EPISODES_NAME
    if not path.is_file():
        raise ReleaseError("episodes_missing", f"{path} 不存在")
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        document = json.loads(line)
        if not isinstance(document, dict):
            raise ReleaseError("episode_line_not_object", f"{path} 有一行不是 JSON object")
        out.append(document)
    return out


def release_digest(out_dir: Path) -> str:
    """整个 release 的指纹（manifest 的 canonical json sha256）。"""
    import hashlib

    return hashlib.sha256(canonical_json(load_manifest(out_dir)).encode("utf-8")).hexdigest()


__all__ = [
    "FROZEN_MARKER",
    "freeze",
    "is_frozen",
    "load_episodes",
    "load_manifest",
    "release_digest",
    "verify_release",
]
