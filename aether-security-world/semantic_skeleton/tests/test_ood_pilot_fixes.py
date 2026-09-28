"""OOD pilot 逼出的确定性修复（Phase 2B brief §15/§17）。

pilot（provider-ood-pilot-001）实测的发现与修复对应关系：

==============================  ========================================
发现                            修复
==============================  ========================================
cache_service / ci_service      ACTOR_TYPES 扩展（映射目标 backend_service
用作 actor 被拒                 与十个已在两表的服务完全相同——词表不对称，
                                不是安全语义边界）
"issues a delegated access      _LANDMARK_KEYWORDS[token_issued] 扩展
token" 分类为 other
"ownership is updated" 等       _LANDMARK_KEYWORDS[permission_changed] 扩展
分类为 other
"attempts a transition to       _LANDMARK_KEYWORDS[workflow_transition]
the paid state" 被 sensitive    扩展（同分同位时按元组序 workflow 在前）
_operation 以同分抢先
==============================  ========================================

 UNSUPPORTED_INVARIANT / CONTRADICTORY_EXPECTATION 的拒收**不是**缺陷，是门在正确工作，
 本文件同时钉住"这些门不为第二生成器放松"。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

from semantic_skeleton.compiler.compiler import classify_history_line
from semantic_skeleton.mechanisms import mechanism
from semantic_skeleton.vocabularies import ACTOR_TYPES, actor_type, service_type

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))


# --------------------------------------------------------------------------- #
# 词表扩展
# --------------------------------------------------------------------------- #
def test_cache_service_and_ci_service_are_accepted_actor_names():
    assert actor_type("cache_service") == "backend_service"
    assert actor_type("ci_service") == "backend_service"
    # 映射目标必须与既有服务完全一致——词表扩展不改任何已编译世界的语义
    assert actor_type("cache_service") == actor_type("records_service")
    assert actor_type("ci_service") == actor_type("gateway_service")
    assert service_type("cache_service") == "cache"


def test_extended_actor_names_compile_end_to_end(compiler):
    """端到端：actor_types 带 cache_service 的骨架必须能编译 + 过 Oracle。"""
    from mechanism_selfcheck import _skeleton_for
    from semantic_skeleton import CompileContext, SemanticSkeletonCompiler
    from semantic_skeleton.identity import canonical_skeleton_id
    from semantic_skeleton.skeleton import PRODUCTION_SCHEMA_PATH, load_skeleton
    from semantic_skeleton.validators import verify_compiled_world

    document = {
        key: value for key, value in _skeleton_for(0, "cache_invalidation_failure").items()
        if key != "skeleton_id"
    }
    document["actor_types"] = ["cache_service", "ordinary_user"]
    load_skeleton(document, schema_path=PRODUCTION_SCHEMA_PATH)
    result = SemanticSkeletonCompiler().compile_with_plan(
        document, context=CompileContext(canonical_skeleton_id=canonical_skeleton_id(document))
    )
    report = verify_compiled_world(
        result.spec, skeleton=document, plan=result.plan,
        config_path=ROOT / "configs" / "phase2a.json",
    )
    assert report.compiled, f"{report.error_code}: {report.error_detail}"


def test_genuinely_unknown_names_are_still_rejected():
    """词表扩展只加证据支持的名字；陌生名字仍然拒收（不许静默放行，brief §17）。"""
    from semantic_skeleton.vocabularies import unknown_actor_types

    assert unknown_actor_types(["cache_service", "ci_service"]) == ()
    assert unknown_actor_types(["quantum_frobnicator"]) == ("quantum_frobnicator",)


# --------------------------------------------------------------------------- #
# 分类器关键词扩展
# --------------------------------------------------------------------------- #
def test_ood_phrasings_now_classify_to_the_right_landmark():
    assert classify_history_line(
        "the identity service issues a delegated access token for tenant B"
    ) == "token_issued"
    assert classify_history_line(
        "the file ownership is updated in the system of record"
    ) == "permission_changed"
    assert classify_history_line(
        "the platform admin revokes a privilege, updating the authoritative version"
    ) == "permission_changed"
    assert classify_history_line(
        "the workflow service attempts a transition to the paid state"
    ) == "workflow_transition"
    assert classify_history_line(
        "the workflow engine attempts to move the task to the next state"
    ) == "workflow_transition"
    assert classify_history_line(
        "the workflow engine processes a transition for the invoice"
    ) == "workflow_transition"
    assert classify_history_line(
        "the workflow engine records a transition attempt without review"
    ) == "workflow_transition"
    assert classify_history_line(
        "the gateway service records the token validation attempt"
    ) == "sensitive_operation"


def test_canonical_step_phrasings_keep_their_classification():
    """canonical 措辞的分类必须一个都不变（Phase 1/2A 语料字节中性的前提）。"""
    canonical = [
        ("the user authenticates against the identity service and a session is established",
         "login"),
        ("the identity service issues a one-time token for the requested flow",
         "token_issued"),
        ("the client presents the token and the first use consumes the code",
         "token_used"),
        ("the platform admin grants a role and bumps the privilege version",
         "role_changed"),
        ("the policy is updated and the new state is committed",
         "permission_changed"),
        ("the downstream service populates a cache entry from the authoritative record",
         "cache_populated"),
        ("the workflow moves toward the next state in the machine",
         "workflow_transition"),
        ("the resource record is created in the system of record",
         "resource_created"),
        ("the resource record is updated by its owner",
         "resource_updated"),
        ("the principal requests the sensitive operation on the target resource",
         "sensitive_operation"),
        ("the platform disables the account", "account_disabled"),
        ("the platform revokes the session after an abuse report", "session_revoked"),
    ]
    for line, expected in canonical:
        actual = classify_history_line(line)
        assert actual == expected, f"{line!r}: {actual} != {expected}"


def test_sensitive_operation_still_wins_for_plain_operation_lines():
    """扩展的 workflow 关键词不许把普通操作行抢成 workflow_transition。"""
    assert classify_history_line(
        "the user attempts to read the billing record"
    ) == "sensitive_operation"
    assert classify_history_line(
        "the principal requests the sensitive operation on the target resource"
    ) == "sensitive_operation"


# --------------------------------------------------------------------------- #
# 不放松的门
# --------------------------------------------------------------------------- #
def test_unsupported_invariant_gate_stays_closed(compiler):
    """声明机制不携带的原型必须仍然被拒（brief §17：不为第二生成器降安全门）。"""
    from semantic_skeleton import CompileContext, SemanticSkeletonCompiler
    from semantic_skeleton.compiler import SkeletonCompileError
    from semantic_skeleton.identity import canonical_skeleton_id
    from semantic_skeleton.skeleton import PRODUCTION_SCHEMA_PATH, load_skeleton
    from mechanism_selfcheck import _skeleton_for

    document = {
        key: value for key, value in _skeleton_for(0, "horizontal_peer_access").items()
        if key != "skeleton_id"
    }
    document["security_invariants"] = [
        {"type": "tenant_isolation", "rule": "the wrong archetype for this mechanism"}
    ]
    load_skeleton(document, schema_path=PRODUCTION_SCHEMA_PATH)
    with pytest.raises(SkeletonCompileError) as excinfo:
        SemanticSkeletonCompiler().compile_with_plan(
            document,
            context=CompileContext(canonical_skeleton_id=canonical_skeleton_id(document)),
        )
    assert excinfo.value.code == "UNSUPPORTED_INVARIANT"

