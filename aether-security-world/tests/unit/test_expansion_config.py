"""``ExpansionConfig``：L0 配置的 L4 视图与 fallback 镜像的一致性。

``configs/default.json`` 是架构师所有的 L0 契约；本模块的 fallback 镜像必须与它
逐字一致——否则"装了 wheel 但没有 configs/"的环境会静默换一套旋钮（与
``security_world/model/config.py`` 的 ``FALLBACK_CRITICAL_AXES_WHITELIST`` 同一
道理，那里由 ``test_model_compile.py`` 钉死，这里由本文件钉死）。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from security_world.expansion import ExpansionConfig
from security_world.model.config import (
    DEFAULT_CONFIG_PATH,
    critical_axes_whitelist,
    irrelevant_axes,
)

CONFIG = json.loads(Path(DEFAULT_CONFIG_PATH).read_text(encoding="utf-8"))


def test_default_config_matches_configs_file():
    config = ExpansionConfig.default()
    assert dict(config.variants_per_world) == CONFIG["expansion"]["variants_per_world"]
    assert config.renderer == CONFIG["rendering"]["default_renderer"]
    assert config.masking_levels == tuple(CONFIG["evidence_masking"]["levels"])
    assert config.critical_axes_whitelist == critical_axes_whitelist(CONFIG)
    assert config.irrelevant_axes == irrelevant_axes(CONFIG)
    assert set(config.level_to_hidden_set) == set(CONFIG["evidence_masking"]["level_to_hidden_set"]) - {"$comment"}
    assert dict(config.per_world_level_quota) == CONFIG["evidence_masking"]["per_world_level_quota"]
    assert config.decoy_masking_per_world == CONFIG["evidence_masking"]["decoy_masking_per_world"]
    assert config.renderers == tuple(CONFIG["rendering"]["renderers"])
    assert config.seed == CONFIG["seed"]
    assert config.trusted_establishes == frozenset(CONFIG["evidence_masking"]["trusted_establishes"])


def test_projection_allowlist_mirrors_config():
    allowlist = ExpansionConfig.default().projection_allowlist
    expected = CONFIG["rendering"]["projection_allowlist"]
    assert allowlist["world_side_allowed"] == expected["world_side_allowed"]
    assert allowlist["world_side_forbidden"] == expected["world_side_forbidden"]
    assert allowlist["forbidden_id_prefixes"] == expected["forbidden_id_prefixes"]
    assert allowlist["forbidden_value_patterns"] == expected["forbidden_value_patterns"]
    assert "$comment" not in allowlist


def test_fallback_mirrors_default_on_stable_fields():
    default = ExpansionConfig.default()
    fallback = ExpansionConfig.fallback()
    assert dict(fallback.variants_per_world) == dict(default.variants_per_world)
    assert fallback.critical_axes_whitelist == default.critical_axes_whitelist
    assert fallback.irrelevant_axes == default.irrelevant_axes
    assert fallback.masking_levels == default.masking_levels
    assert fallback.renderer == default.renderer
    assert fallback.renderers == default.renderers
    assert fallback.seed == default.seed
    assert fallback.projection_allowlist == default.projection_allowlist
    assert fallback.trusted_establishes == default.trusted_establishes


def test_from_config_applies_defaults_for_missing_sections():
    config = ExpansionConfig.from_config({"seed": 7})
    assert config.seed == 7
    assert config.masking_levels == ExpansionConfig.fallback().masking_levels
    assert dict(config.variants_per_world) == dict(ExpansionConfig.fallback().variants_per_world)


def test_from_config_rejects_non_mapping():
    with pytest.raises(ValueError):
        ExpansionConfig.from_config(["not", "a", "mapping"])  # type: ignore[arg-type]


def test_masked_levels_order_is_quota_then_decoy():
    config = ExpansionConfig.default()
    assert config.masked_levels() == (
        "complete",
        "minimally_sufficient",
        "insufficient",
        "contradictory",
        "stale",
        "attacker_controlled",
        "partially_missing",  # 诱饵（decoy）
    )
    # 配额总数与 configs 的 variants_per_world.evidence_masked 一致（B8）。
    assert sum(config.per_world_level_quota.values()) == config.variant_count("evidence_masked")


def test_variant_count_and_axis_membership():
    config = ExpansionConfig.default()
    assert config.variant_count("critical_intervention") == 3
    assert config.variant_count("no_such_variant") == 0
    assert config.is_irrelevant_axis("observation.request.headers.User-Agent")
    assert not config.is_irrelevant_axis("resource.RES-001.owner")


def test_negative_seed_rejected():
    config = ExpansionConfig.default()
    with pytest.raises(ValueError):
        ExpansionConfig(
            variants_per_world=dict(config.variants_per_world),
            critical_axes_whitelist=config.critical_axes_whitelist,
            irrelevant_axes=config.irrelevant_axes,
            masking_levels=config.masking_levels,
            level_to_hidden_set=dict(config.level_to_hidden_set),
            renderer=config.renderer,
            seed=-1,
        )
