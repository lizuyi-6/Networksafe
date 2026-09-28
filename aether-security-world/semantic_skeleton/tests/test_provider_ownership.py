"""provider 责任审计：契约里不允许再出现程序可派生的字段（Phase 2B brief §7）。

``IF CODE CAN DERIVE IT, DO NOT ASK THE LLM TO GENERATE IT.``

Phase 2B-0 把 ``skeleton_id`` 从 provider 契约里删掉之后，这里把剩下的字段逐条钉死：
production schema 的**每一个**键要么是安全语义（LLM 该负责的），要么是 provenance-only
（``provider_claimed_id``）。任何"程序完全能算出来"的字段再溜回来，这些测试就红。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from semantic_skeleton.identity import PROVIDER_OWNED_KEYS
from semantic_skeleton.skeleton import PRODUCTION_SCHEMA_PATH

ROOT = Path(__file__).resolve().parents[2]

#: 程序可派生 / 程序拥有的字段名。provider 契约里出现任何一个都是 brief §7 违规。
#: （``skeleton_id`` / ``provider_claimed_id`` 单独处理：前者已删除，后者是显式的
#: provenance-only 例外。）
PROGRAM_DERIVABLE_KEYS: tuple[str, ...] = (
    "world_id", "world_family_id", "counterfactual_family_id", "workflow_family_id",
    "policy_family_id", "invariant_family_id", "application_family", "mechanism_family_id",
    "family_id", "family_hash", "group_key", "split", "split_assignment", "attack_family",
    "attack_label", "label", "verdict", "expected_verdict", "hypothesized_verdict",
    "oracle_verdict", "world_truth", "observable_decision", "decision",
    "canonical_fact_path", "fact_path", "policy_ast", "expr", "condition",
    "state_preconditions", "resource_states", "state_history", "current_state",
    "episode_templates", "policies", "invariants", "actors", "resources", "sessions",
    "tokens", "caches", "services", "workflows", "trust_boundaries", "credentials",
    "roles", "seed", "critical_state_variables", "irrelevant_state_variables",
    "hypotheses", "attack_opportunities", "expected_counterfactual_axes",
    "schema_version", "schema_hash", "prompt_hash", "config_hash", "provenance",
    "timestamp", "created_at", "generated_at", "observed_at", "valid_at", "run_id",
    "batch_index", "ordinal", "index", "sequence",
)

#: 实体 / 证据 ID 形状（brief §17 的同一条规则，这里按"键名"再查一遍）。
_ID_KEY_RE = re.compile(r"(^|_)(id|ids)$")

#: provider 契约里允许的全部键（语义字段 + provenance-only 例外）。
SEMANTIC_KEYS: frozenset[str] = frozenset({
    "domain", "scenario_summary", "mechanism_family", "complexity", "actor_types",
    "resource_types", "service_types", "security_goal", "critical_facts", "history",
    "security_invariants", "failure_mechanism", "required_evidence", "optional_evidence",
    "untrusted_evidence", "irrelevant_facts", "counterfactuals", "evidence_masking_targets",
    "trust_relationships", "new_semantic_fact_candidates", "notes_for_compiler",
})
PROVENANCE_ONLY_KEYS: frozenset[str] = frozenset({"provider_claimed_id"})
COSMETIC_KEYS: frozenset[str] = frozenset({"$comment"})


def _schema() -> dict:
    return json.loads(PRODUCTION_SCHEMA_PATH.read_text(encoding="utf-8"))


def test_no_program_derivable_key_survives_in_the_production_contract():
    schema = _schema()
    properties = set(schema["properties"])
    for name in PROGRAM_DERIVABLE_KEYS:
        assert name not in properties, f"{name!r} 是程序可派生字段，不得出现在 provider 契约里"
        assert name not in schema["required"], f"{name!r} 不得是必填项"
    for name in sorted(properties):
        assert not _ID_KEY_RE.search(name) or name in PROVENANCE_ONLY_KEYS, (
            f"键 {name!r} 以 id 结尾——ID 由程序拥有（brief §6/§7）"
        )


def test_every_production_key_is_either_semantic_or_provenance_only():
    schema = _schema()
    properties = set(schema["properties"])
    unexpected = properties - SEMANTIC_KEYS - PROVENANCE_ONLY_KEYS - COSMETIC_KEYS
    assert not unexpected, f"未登记的键: {sorted(unexpected)}"
    assert set(schema["required"]) <= SEMANTIC_KEYS
    # provider_claimed_id 必须是可选的：缺了它骨架照样合法
    assert "provider_claimed_id" not in schema["required"]


def test_skeleton_id_is_gone_from_the_production_contract():
    schema = _schema()
    assert "skeleton_id" not in schema["properties"]
    assert "skeleton_id" not in schema["required"]
    assert schema["additionalProperties"] is False


def test_prompt_v07_declares_exactly_the_production_required_keys():
    """prompt 声明的键清单必须与 production schema 的 required 逐字一致。

    否则模型会按一份过期契约生产，然后整批撞 schema——这是纯工程失误，不是模型问题。
    """
    prompt = (ROOT / "semantic_skeleton" / "prompts" / "v0.7.md").read_text(encoding="utf-8")
    match = re.search(r"exactly these keys: ([^.]+)\.", prompt)
    assert match, "v0.7 prompt 里找不到键清单"
    declared = [key.strip() for key in match.group(1).split(",")]
    schema = _schema()
    assert declared == list(schema["required"]), (
        f"prompt 键清单与 schema.required 不一致:\n prompt={declared}\n schema={schema['required']}"
    )
    # prompt 必须明确告诉模型别再产 id
    assert "Do NOT emit any id" in prompt
    assert "no `skeleton_id`" in prompt


def test_provider_owned_keys_are_the_only_identity_inputs():
    """identity 模块剥掉的键必须正好是 provider 拥有的那两个。"""
    assert PROVIDER_OWNED_KEYS == frozenset({"skeleton_id", "provider_claimed_id"})


def test_frozen_phase2a_prompt_and_schema_are_still_byte_identical():
    """Phase 2A 冻结产物不许被顺手改掉——它们的哈希在 PHASE2A-FINAL-FREEZE 里。"""
    import hashlib

    expected = {
        "semantic_skeleton/prompts/v0.6.md":
            "1c891e4b6f51911d93f8c7bd86e9526147dcfcc5a59dc18b4623a4db3d2234bc",
        "semantic_skeleton/schemas/semantic-skeleton.schema.json":
            "82bc9516e089f9b37bd1f56b97da79d6faa83e020b74d4dac545a00196a3874d",
    }
    for relative, digest in expected.items():
        actual = hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
        assert actual == digest, f"{relative} 与 Phase 2A 冻结值不一致"
