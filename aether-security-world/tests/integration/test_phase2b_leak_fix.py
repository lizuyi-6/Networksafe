"""Phase 2B 泄漏修复的回归（W-90a101a962ca 发现，provider-ood-pilot-001）。

编译器曾把机制族名嵌进 workflow / trust boundary 的 ``name``（族名 = 攻击族名），
``structured_state`` 渲染把它带进 model-visible，B12 投影白名单命中。Phase 2A 的审计
只扫 http_request 面所以从没发现——这条测试把**全部 46 个机制 × 全部 8 renderer ×
3 style** 都钉住，同类泄漏不再有藏身之处。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from security_world.expansion import expand_family
from security_world.expansion.config import ExpansionConfig, DEFAULT_RENDERERS
from security_world.model import WorldSpec
from semantic_skeleton import CompileContext, SemanticSkeletonCompiler
from semantic_skeleton.compiler import COMPILER_VERSION
from semantic_skeleton.identity import canonical_skeleton_id
from semantic_skeleton.skeleton import PRODUCTION_SCHEMA_PATH
from semantic_skeleton.validators import verify_compiled_world

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

RENDER_STYLES = ("rest", "graphql", "rpc")
PHASE2A_CONFIG = ROOT / "configs" / "phase2a.json"


def _probe(family: str) -> dict:
    from mechanism_selfcheck import _skeleton_for

    document = {
        key: value for key, value in _skeleton_for(0, family).items() if key != "skeleton_id"
    }
    return document


def _compile(family: str):
    from semantic_skeleton.compiler import SkeletonCompileError

    document = _probe(family)
    load = __import__(
        "semantic_skeleton.skeleton", fromlist=["load_skeleton"]
    ).load_skeleton
    load(document, schema_path=PRODUCTION_SCHEMA_PATH)
    result = SemanticSkeletonCompiler().compile_with_plan(
        document,
        context=CompileContext(canonical_skeleton_id=canonical_skeleton_id(document)),
    )
    report = verify_compiled_world(
        result.spec, skeleton=document, plan=result.plan, config_path=PHASE2A_CONFIG
    )
    assert report.compiled, f"{family}: {report.error_code} {report.error_detail}"
    return result.spec


def test_workflow_and_boundary_names_no_longer_carry_the_mechanism_family():
    spec = _compile("token_lineage_confusion")
    for workflow in spec.get("workflows") or ():
        name = str(workflow.get("name") or "")
        assert "token_lineage_confusion" not in name, name
    for boundary in spec.get("trust_boundaries") or ():
        name = str(boundary.get("name") or "")
        assert "token_lineage_confusion" not in name, name


def test_compiler_version_bumped_for_the_leak_fix():
    assert COMPILER_VERSION == "0.3.0"


def _registry_families() -> list[str]:
    from semantic_skeleton.mechanisms import mechanism_families

    return sorted(mechanism_families())


@pytest.mark.parametrize("family", _registry_families())
@pytest.mark.parametrize("renderer", DEFAULT_RENDERERS)
def test_every_mechanism_renders_clean_on_every_surface(family, renderer):
    """全机制 × 全 renderer：展开必须成功且 model_visible 无攻击族词。

    Phase 2A 审计只扫 http_request 面——W-90a101a962ca 的 workflow name 泄漏就是从
    structured_state 面溜进来的。这条测试堵死整类问题。
    """
    from security_world.validation.lexical import scan_model_visible as _scan

    cfg = ExpansionConfig.from_config(json.loads(PHASE2A_CONFIG.read_text(encoding="utf-8")))
    document = _probe(family)
    spec = WorldSpec.from_document(_compile(family))
    result = expand_family(
        spec, config=cfg, compile_config=json.loads(PHASE2A_CONFIG.read_text(encoding="utf-8")),
        renderer=renderer,
    )
    for episode in result.variants:
        model_visible = episode.to_document()["observation"]["model_visible"]
        blob = json.dumps(model_visible, ensure_ascii=False)
        assert "token_lineage_confusion" not in blob, (
            f"{family}/{renderer}: 攻击族词出现在 model_visible"
        )
        hits = _scan(model_visible)
        assert not hits, f"{family}/{renderer}: {hits[0].marker} @ {hits[0].path}"
