"""L6 发布层：冻结 release manifest + 冻结/校验原语（Agent E）。

公共契约（设计 §15.3 的 L6 部分）::

    build_release(episodes, *, out_dir, config, git_commit, schema_versions) -> ReleaseManifest
    freeze(out_dir) -> None          # 已冻结则拒绝覆盖

外加三个发布后可验证的原语：:func:`load_manifest` / :func:`verify_release` /
:func:`load_episodes`——"冻结"的唯一可验证承诺是字节没变，因此必须能重算对账。

分层纪律：本包 import L1–L5，**不** import L7 ``generation``（只经
``generation.prompts.registry`` 读 prompt hash，且是函数内延迟导入，避免把 L7
变成 L6 的编译期依赖）。
"""
from __future__ import annotations

from .errors import ReleaseError
from .freeze import (
    FROZEN_MARKER,
    freeze,
    is_frozen,
    load_episodes,
    load_manifest,
    release_digest,
    verify_release,
)
from .manifest import (
    DEFAULT_RELEASE_ID,
    DEFAULT_STRATEGY,
    EPISODES_NAME,
    FROZEN_NAME,
    MANIFEST_NAME,
    ReleaseManifest,
    build_release,
    resolve_generator_prompt_hash,
    schema_versions,
)

__all__ = [
    "DEFAULT_RELEASE_ID",
    "DEFAULT_STRATEGY",
    "EPISODES_NAME",
    "FROZEN_MARKER",
    "FROZEN_NAME",
    "MANIFEST_NAME",
    "ReleaseError",
    "ReleaseManifest",
    "build_release",
    "freeze",
    "is_frozen",
    "load_episodes",
    "load_manifest",
    "release_digest",
    "resolve_generator_prompt_hash",
    "schema_versions",
    "verify_release",
]
