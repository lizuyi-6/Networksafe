"""``configs/default.json`` 的 L4 视图（设计 §15.3 的 ``ExpansionConfig``）。

配置是 L0 契约（架构师所有，实现者只读）；本模块只负责**读**它并提供一份
逐字一致的 fallback 镜像——装了 wheel 但没有 ``configs/`` 的环境不能静默换一套
旋钮（与 ``security_world/model/config.py`` 的
``FALLBACK_CRITICAL_AXES_WHITELIST`` 同一道理，由
``tests/unit/test_expansion_config.py`` 钉死同步）。

``level_to_hidden_set`` 里的 ``$comment`` 键在读取时被剥掉：它是给人看的注释，
不是 level 词表的一部分（``configs/default.json`` 的 JSON 对象里混着注释键，
直接塞进 ``Mapping[str, str]`` 会让"7 个 level"变成 8 个）。
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from ..model.config import (
    FALLBACK_CRITICAL_AXES_WHITELIST,
    critical_axes_whitelist,
    irrelevant_axes,
    try_load_default_config,
)
from ..model.rng import validate_seed
from ..oracle import TRUSTED_ESTABLISHES

#: 8 种 renderer（与 ``configs/default.json`` 的 ``rendering.renderers`` 逐字一致；
#: ``episode.schema.json`` 的 ``model_visible.renderer`` 枚举同源）。
DEFAULT_RENDERERS: tuple[str, ...] = (
    "structured_state",
    "http_request",
    "reverse_proxy_log",
    "application_log",
    "audit_log",
    "api_gateway_record",
    "multi_event_trace",
    "mixed_evidence_bundle",
)

#: 7 个掩蔽 level（与 ``configs/default.json`` 的 ``evidence_masking.levels`` 逐字一致；
#: ``episode.schema.json`` 的 ``decision_metadata.evidence_availability_level`` 枚举同源）。
DEFAULT_MASKING_LEVELS: tuple[str, ...] = (
    "complete",
    "partially_missing",
    "minimally_sufficient",
    "insufficient",
    "contradictory",
    "stale",
    "attacker_controlled",
)

#: ``configs/default.json`` 的 ``rendering.default_renderer`` 镜像。
DEFAULT_RENDERER = "http_request"

#: ``configs/default.json`` 的 ``expansion.variants_per_world`` 镜像（§9.1：1+3+3+6）。
FALLBACK_VARIANTS_PER_WORLD: dict[str, int] = {
    "base": 1,
    "critical_intervention": 3,
    "irrelevant_perturbation": 3,
    "evidence_masked": 6,
}

#: ``configs/default.json`` 的 ``evidence_masking.per_world_level_quota`` 镜像（B8）。
FALLBACK_PER_WORLD_LEVEL_QUOTA: dict[str, int] = {
    "complete": 1,
    "minimally_sufficient": 1,
    "insufficient": 1,
    "contradictory": 1,
    "stale": 1,
    "attacker_controlled": 1,
}

#: ``configs/default.json`` 的 ``evidence_masking.decoy_masking_per_world`` 镜像。
FALLBACK_DECOY_MASKING_PER_WORLD = 1

#: ``configs/default.json`` 的 ``expansion.irrelevant_axes`` 镜像（§9.5 / S16）。
FALLBACK_IRRELEVANT_AXES: tuple[str, ...] = (
    "observation.request.headers.User-Agent",
    "observation.request.headers.X-Request-Id",
    "observation.rendering.header_order",
    "observation.rendering.trace_id",
    "observation.rendering.timestamp_format",
    "observation.rendering.display_name_case",
)

#: ``configs/default.json`` 的 ``rendering.projection_allowlist`` 镜像（B12）。
FALLBACK_PROJECTION_ALLOWLIST: dict[str, Any] = {
    "world_side_allowed": [
        "actors", "resources", "sessions", "tokens", "credentials", "workflows",
        "services", "caches", "trust_boundaries", "state_history", "current_state", "roles",
    ],
    "world_side_forbidden": [
        "provenance", "compile", "seed", "policies", "invariants", "world_family_id",
        "application_domain", "evidence",
    ],
    "forbidden_id_prefixes": ["POL-", "INV-", "OPP-", "AXIS-"],
    # 值模式是锚定的正则（^...$）；guard 以"去锚后做子串搜索"的语义执行，
    # 因为 rendered_text 是一整段字符串，逐值 fullmatch 挡不住嵌在日志行里的
    # attack_family 令牌。镜像与 configs/default.json 的 38 项逐字一致。
    "forbidden_value_patterns": [
        "^idor_bola$", "^horizontal_privesc$", "^vertical_privesc$", "^tenant_isolation_violation$",
        "^stale_authorization$", "^revoked_session_reuse$", "^stale_session_privilege$",
        "^cross_account_session_misuse$", "^session_after_password_reset$", "^session_after_account_disable$",
        "^token_replay$", "^one_time_token_reuse$", "^cross_workflow_token_reuse$", "^cross_resource_token_reuse$",
        "^scope_mismatch$", "^audience_mismatch$", "^privilege_version_mismatch$", "^token_lineage_confusion$",
        "^workflow_bypass$", "^invalid_state_transition$", "^repeated_operation$", "^skipping_required_step$",
        "^irreversible_state_reversal$", "^state_machine_confusion$", "^stale_permission_cache$",
        "^inconsistent_revocation_state$", "^stale_ownership_cache$", "^cache_invalidation_failure$",
        "^inconsistent_replicas$", "^owner_mismatch$", "^tenant_mismatch$", "^resource_state_violation$",
        "^race_sensitive_state$", "^stale_object_reference$", "^sql_injection$", "^command_injection$",
        "^path_traversal$", "^xss$", "^ssrf$", "^unsafe_deserialization$", "^prompt_injection$", "^benign$",
    ],
}

#: ``configs/default.json`` 的 ``seed`` 镜像。
FALLBACK_SEED = 20260920


def _without_comment_keys(mapping: Mapping[str, Any]) -> dict[str, Any]:
    """剥掉 ``$comment`` / ``$comment_*`` 注释键（配置对象里混着给人看的注释）。"""
    return {key: value for key, value in mapping.items() if not str(key).startswith("$")}


@dataclass(frozen=True)
class ExpansionConfig:
    """L4 展开引擎的全部旋钮（设计 §15.3）。

    ``variants_per_world`` / ``critical_axes_whitelist`` / ``irrelevant_axes`` /
    ``masking_levels`` / ``level_to_hidden_set`` / ``renderer`` / ``seed`` 是
    §15.3 钉死的七个契约字段；其余字段（配额、诱蔽数、renderer 全集、投影
    白名单、信任集）带默认值，因此按契约形态构造
    ``ExpansionConfig(variants_per_world=..., critical_axes_whitelist=...,
    irrelevant_axes=..., masking_levels=..., level_to_hidden_set=...,
    renderer=..., seed=...)`` 依然合法。
    """

    variants_per_world: Mapping[str, int]
    critical_axes_whitelist: tuple[str, ...]
    irrelevant_axes: tuple[str, ...]
    masking_levels: tuple[str, ...]
    level_to_hidden_set: Mapping[str, str]
    renderer: str
    seed: int
    per_world_level_quota: Mapping[str, int] = field(
        default_factory=lambda: dict(FALLBACK_PER_WORLD_LEVEL_QUOTA)
    )
    decoy_masking_per_world: int = FALLBACK_DECOY_MASKING_PER_WORLD
    renderers: tuple[str, ...] = DEFAULT_RENDERERS
    projection_allowlist: Mapping[str, Any] = field(
        default_factory=lambda: dict(FALLBACK_PROJECTION_ALLOWLIST)
    )
    trusted_establishes: frozenset[str] = TRUSTED_ESTABLISHES

    def __post_init__(self) -> None:
        validate_seed(self.seed)
        object.__setattr__(self, "variants_per_world", dict(self.variants_per_world))
        object.__setattr__(self, "level_to_hidden_set", dict(self.level_to_hidden_set))
        object.__setattr__(self, "per_world_level_quota", dict(self.per_world_level_quota))
        object.__setattr__(self, "projection_allowlist", dict(self.projection_allowlist))
        object.__setattr__(
            self, "trusted_establishes", frozenset(self.trusted_establishes)
        )

    # -- 构造 --------------------------------------------------------------- #
    @classmethod
    def from_config(cls, config: Mapping[str, Any]) -> "ExpansionConfig":
        """从 ``configs/default.json`` 形态的配置读取（L0 契约的 L4 视图）。"""
        if not isinstance(config, Mapping):
            raise ValueError("ExpansionConfig.from_config 需要 Mapping")
        expansion = config.get("expansion") or {}
        masking = config.get("evidence_masking") or {}
        rendering = config.get("rendering") or {}
        levels = tuple(str(item) for item in (masking.get("levels") or DEFAULT_MASKING_LEVELS))
        level_map = _without_comment_keys(masking.get("level_to_hidden_set") or {})
        trusted = masking.get("trusted_establishes")
        return cls(
            variants_per_world={
                str(key): int(value)
                for key, value in (expansion.get("variants_per_world") or FALLBACK_VARIANTS_PER_WORLD).items()
            },
            critical_axes_whitelist=critical_axes_whitelist(config),
            irrelevant_axes=irrelevant_axes(config) or FALLBACK_IRRELEVANT_AXES,
            masking_levels=levels,
            level_to_hidden_set={str(key): str(value) for key, value in level_map.items()},
            renderer=str(rendering.get("default_renderer") or DEFAULT_RENDERER),
            seed=validate_seed(int(config.get("seed", FALLBACK_SEED))),
            per_world_level_quota={
                str(key): int(value)
                for key, value in (
                    masking.get("per_world_level_quota") or FALLBACK_PER_WORLD_LEVEL_QUOTA
                ).items()
            },
            decoy_masking_per_world=int(
                masking.get("decoy_masking_per_world", FALLBACK_DECOY_MASKING_PER_WORLD)
            ),
            renderers=tuple(str(item) for item in (rendering.get("renderers") or DEFAULT_RENDERERS)),
            projection_allowlist=dict(
                _without_comment_keys(rendering.get("projection_allowlist") or FALLBACK_PROJECTION_ALLOWLIST)
            ),
            trusted_establishes=frozenset(
                str(item) for item in (trusted or sorted(TRUSTED_ESTABLISHES))
            ),
        )

    @classmethod
    def default(cls) -> "ExpansionConfig":
        """读 ``configs/default.json``；文件缺失时退回内置镜像（逐字一致）。"""
        config = try_load_default_config()
        if config is None:
            return cls.fallback()
        return cls.from_config(config)

    @classmethod
    def fallback(cls) -> "ExpansionConfig":
        """不依赖 ``configs/`` 目录的内置配置（wheel 安装态可用）。"""
        return cls(
            variants_per_world=dict(FALLBACK_VARIANTS_PER_WORLD),
            critical_axes_whitelist=FALLBACK_CRITICAL_AXES_WHITELIST,
            irrelevant_axes=FALLBACK_IRRELEVANT_AXES,
            masking_levels=DEFAULT_MASKING_LEVELS,
            level_to_hidden_set={
                level: f"fallback level rule for {level}" for level in DEFAULT_MASKING_LEVELS
            },
            renderer=DEFAULT_RENDERER,
            seed=FALLBACK_SEED,
            per_world_level_quota=dict(FALLBACK_PER_WORLD_LEVEL_QUOTA),
            decoy_masking_per_world=FALLBACK_DECOY_MASKING_PER_WORLD,
            renderers=DEFAULT_RENDERERS,
            projection_allowlist=dict(FALLBACK_PROJECTION_ALLOWLIST),
            trusted_establishes=TRUSTED_ESTABLISHES,
        )

    # -- 查询 --------------------------------------------------------------- #
    def variant_count(self, variant_type: str) -> int:
        """某类变体的每世界上限（缺省 0）。"""
        return int(self.variants_per_world.get(variant_type, 0))

    def masked_levels(self) -> tuple[str, ...]:
        """每世界的掩蔽 level 生产顺序：配额 level + 诱饵（decoy）。

        配额（B8）固定 6 个 level 各 1；诱饵变体用 ``partially_missing``
        （隐藏 1 个**非** consulted 证据，verdict 必须仍可判定——R2 的混杂要求）。
        """
        ordered: list[str] = []
        for level in self.masking_levels:
            quota = int(self.per_world_level_quota.get(level, 0))
            ordered.extend([level] * quota)
        ordered.extend(["partially_missing"] * int(self.decoy_masking_per_world))
        return tuple(ordered)

    def is_irrelevant_axis(self, axis: str) -> bool:
        """该轴是否是配置声明的无关轴（``observation.*`` 表面路径）。"""
        return axis in self.irrelevant_axes


__all__ = [
    "DEFAULT_MASKING_LEVELS",
    "DEFAULT_RENDERER",
    "DEFAULT_RENDERERS",
    "ExpansionConfig",
    "FALLBACK_DECOY_MASKING_PER_WORLD",
    "FALLBACK_IRRELEVANT_AXES",
    "FALLBACK_PER_WORLD_LEVEL_QUOTA",
    "FALLBACK_PROJECTION_ALLOWLIST",
    "FALLBACK_SEED",
    "FALLBACK_VARIANTS_PER_WORLD",
]
