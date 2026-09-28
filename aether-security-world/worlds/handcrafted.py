"""人工测试世界（M5 交付物，设计 §12.2）的**可复现构造器**。

为什么有一个构造器而不是 23 份手敲 JSON：这些世界的正确性判据是"oracle 跑出来
必须等于人工预期"（设计 §12.2）。预期是**手写**的（``expected.md`` 里的
``world_truth`` / ``observable_decision`` 由人声明），但世界的其余部分（实体、
状态、证据、假设块、episode 模板）有大量结构相同的样板；手敲 23 份 250 行 JSON
的唯一结果是抄错一个字段然后花半小时定位。因此：

* ``worlds/materialize.py`` 把本模块的定义落成 ``worlds/handcrafted/ASW-HC-NNN/``
  下的 ``world-spec.json`` + ``expected.md``（**语料以磁盘文件为准**）；
* ``tests/integration/test_handcrafted_corpus.py`` 从磁盘加载并断言
  (a) 每个 spec 过 ``world-spec.schema.json``、(b) oracle 的判决等于
  ``expected.md`` 里**手写**的预期、(c) 重新物化的字节与磁盘一致（可复现）。

**没有自动回填标签**：``expected.md`` 里的判决来自人对世界的推理，不是跑一遍
oracle 抄下来。构造器只生成结构，不生成预期——``WorldDefinition.expectations``
是人写的常量。
"""
from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from security_world.invariants import decision_facts
from security_world.model import (
    WorldInstance,
    WorldSpec,
    compile_spec,
    stable_hash,
    validate_document,
)
from security_world.policy import Action

#: 虚拟时钟的"现在"（世界时间是声明出来的，不是读出来的）。
NOW = "2026-09-20T08:00:00Z"

#: 全语料共用的无关轴（``observation.*`` 表面路径，schema 模式限定）。
DEFAULT_IRRELEVANT_AXES: tuple[str, ...] = (
    "observation.request.headers.User-Agent",
    "observation.request.headers.X-Request-Id",
    "observation.request.headers.order",
    "observation.rendering.trace_id",
    "observation.rendering.timestamp_format",
    "observation.rendering.display_name_case",
)

#: 闭世界兜底策略（每个世界都有；``is_default_rule`` 让 default-deny 单独命中只产生
#: ``unauthorized``，不产生 ``attack``——设计 §8.2 / B10）。
DEFAULT_DENY_POLICY: dict[str, Any] = {
    "policy_id": "POL-DEFAULT-DENY",
    "description": "Closed-world default deny. Flagged is_default_rule so a default-deny hit alone can never produce an attack label.",
    "action": {"operation": "*"},
    "effect": "deny",
    "condition": {"op": "lit", "value": True},
    "priority": -1,
    "is_default_rule": True,
}


# --------------------------------------------------------------------------- #
# 期望（人工声明，不是跑 oracle 抄下来的）
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Expectation:
    """一个 probe action 的人工预期。"""

    world_truth: str
    observable_decision: str
    note: str = ""


@dataclass(frozen=True)
class ProbeAction:
    """episode 模板里的一个决策事件（``binds`` 直接进 action 文档）。"""

    summary: str
    binds: Mapping[str, Any]
    expectation: Expectation
    causal_tag: str = "relevant"


@dataclass(frozen=True)
class WorldDefinition:
    """一个人工世界的完整定义。"""

    number: int
    domain: str
    attack_family: str
    title: str
    description: str
    endpoints: tuple[Mapping[str, Any], ...]
    roles: tuple[Mapping[str, Any], ...]
    actors: tuple[Mapping[str, Any], ...]
    resources: tuple[Mapping[str, Any], ...]
    policies: tuple[Mapping[str, Any], ...]
    invariants: tuple[Mapping[str, Any], ...]
    #: (variable, before, after) —— 先验声明的关键轴（Gate 5 据此证伪）。
    critical_axes: tuple[tuple[str, Any, Any], ...]
    probes: tuple[ProbeAction, ...]
    sessions: tuple[Mapping[str, Any], ...] = ()
    tokens: tuple[Mapping[str, Any], ...] = ()
    workflows: tuple[Mapping[str, Any], ...] = ()
    services: tuple[Mapping[str, Any], ...] = ()
    caches: tuple[Mapping[str, Any], ...] = ()
    credentials: tuple[Mapping[str, Any], ...] = ()
    trust_boundaries: tuple[Mapping[str, Any], ...] = ()
    state_history: tuple[Mapping[str, Any], ...] = ()
    current_state: Mapping[str, Any] | None = None
    #: 额外证据（矛盾/陈旧/攻击者可控的声明；base 就可观测地不可判定）。
    extra_evidence: tuple[Mapping[str, Any], ...] = ()
    #: 对**自动生成**证据的按事实覆盖（``fact_key -> 字段覆盖``）。
    #: 用来声明"陈旧"/"攻击者可控"：掩蔽只能隐藏，造不出这两种退化，只能由世界声明。
    evidence_overrides: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)
    irrelevant_axes: tuple[str, ...] = DEFAULT_IRRELEVANT_AXES
    notes: str = ""

    @property
    def world_id(self) -> str:
        return f"W-HC-{self.number:03d}"

    @property
    def directory(self) -> str:
        return f"ASW-HC-{self.number:03d}"

    @property
    def seed(self) -> int:
        return 20260920 + self.number


# --------------------------------------------------------------------------- #
# 构造助手
# --------------------------------------------------------------------------- #
def _provenance() -> dict[str, Any]:
    return {
        "origin": "handcrafted",
        "generator_model": "human",
        "generator_model_version": "n/a",
        "prompt_version": "n/a",
        "prompt_hash": "0" * 64,
        "generation_timestamp": NOW,
        "validation_outcome": "accepted",
    }


def _decidable_pair(
    policy_id: str,
    invariant_id: str,
    category: str,
    expr: Mapping[str, Any],
    *,
    operation: str,
    resource_type: str,
    severity: str = "critical",
    requires_fresh: bool = False,
    description: str = "",
) -> tuple[dict[str, Any], dict[str, Any]]:
    """一条 allow 策略 + 一条不变量（条件同源：干预后两者同时翻转）。"""
    policy: dict[str, Any] = {
        "policy_id": policy_id,
        "description": description or f"synthetic allow policy {policy_id}",
        "action": {"operation": operation, "resource_type": resource_type},
        "effect": "allow",
        "condition": copy.deepcopy(dict(expr)),
        "priority": 100,
    }
    if requires_fresh:
        policy["requires_fresh"] = True
    invariant = {
        "invariant_id": invariant_id,
        "category": category,
        "applies_to": [operation],
        "severity": severity,
        "description": description or f"synthetic invariant {invariant_id}",
        "expr": copy.deepcopy(dict(expr)),
    }
    return policy, invariant


def _evidence_for(
    world_document: Mapping[str, Any],
    probes: Sequence[ProbeAction],
    overrides: Mapping[str, Mapping[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """为每个 probe action 的决策闭包生成 trusted/visible/fresh 证据。

    用**静态**闭包（``decision_facts``）而不是动态 consulted 集合：静态闭包是动态
    集合的超集，为超集生成证据保证任何分支下事实都可建立（测试要能专心断言 truth
    趟的结论）。世界自己声明的 ``extra_evidence`` 原样附加在后面。
    """
    instance = _temporary_instance(world_document)
    items: list[dict[str, Any]] = []
    index = 0
    resolved_overrides = dict(overrides or {})
    for probe in probes:
        action = Action.from_document(_action_document(probe))
        for fact in sorted(decision_facts(instance, action)):
            if not instance.contains(fact):
                continue
            item: dict[str, Any] = {
                "evidence_id": f"EV-{index:03d}",
                "type": "log_line",
                "asserts_ref": fact,
                "value": instance.resolve(fact),
                "source": "synthetic-system-of-record",
                "provenance": "system_of_record",
                "trust_level": "trusted",
                "timestamp": NOW,
                "freshness": "fresh",
                "attacker_controllable": False,
                "visible_in_observation": True,
            }
            item.update(dict(resolved_overrides.get(fact) or {}))
            items.append(item)
            index += 1
    return items


def _temporary_instance(world_document: Mapping[str, Any]) -> WorldInstance:
    document = copy.deepcopy(dict(world_document))
    document.pop("world_family_id", None)
    document.pop("compile", None)
    document.pop("hypotheses", None)
    document.pop("attack_family", None)
    document.pop("critical_state_variables", None)
    document.pop("irrelevant_state_variables", None)
    document.pop("episode_templates", None)
    document.pop("notes", None)
    document.pop("$comment", None)
    document.pop("provenance", None)
    document["provenance"] = _provenance()
    # 占位证据：decision_facts 是**静态**闭包，不看证据内容；这里只需要让文档过
    # world.schema.json 的 evidence minItems=1。
    document.setdefault(
        "evidence",
        [
            {
                "evidence_id": "EV-PLACEHOLDER",
                "type": "identity_claim",
                "asserts_ref": f"actor.{document['actors'][0]['actor_id']}.actor_id",
                "value": document["actors"][0]["actor_id"],
                "source": "placeholder",
                "provenance": "system_of_record",
                "trust_level": "trusted",
                "timestamp": NOW,
                "freshness": "fresh",
                "attacker_controllable": False,
                "visible_in_observation": True,
            }
        ],
    )
    document["world_family_id"] = "WF-" + "0" * 12
    document["compile"] = {
        "compiler_version": "0.1.0",
        "source_spec_id": document["world_id"],
        "derived_world_family_id": True,
        "dropped_hypothesis_fields": [],
        "reason_codes": [],
    }
    return WorldInstance.from_document(document)


def _action_document(probe: ProbeAction) -> dict[str, Any]:
    binds = dict(probe.binds)
    # action_id 必须是确定性的：它进 evidence view id 与 episode id，
    # 因此这里用 (operation, actor, 绑定) 的稳定哈希，不用 Python 的 hash()。
    digest = stable_hash(
        [
            str(binds.get("operation")),
            str(binds.get("actor")),
            str(binds.get("resource_id")),
            str(binds.get("session_id")),
            str(binds.get("token_id")),
            str(binds.get("workflow_instance_id")),
            str(binds.get("flow_id")),
        ]
    )[:12]
    document: dict[str, Any] = {
        "action_id": f"ACTN-{digest}",
        "operation": str(binds.get("operation")),
        "actor": str(binds.get("actor")),
        "flow_id": str(binds.get("flow_id") or f"FLOW-{binds.get('operation')}"),
        "at": NOW,
    }
    for action_key, bind_key in (
        ("resource", "resource_id"),
        ("session", "session_id"),
        ("token", "token_id"),
        ("workflow_instance", "workflow_instance_id"),
    ):
        value = binds.get(bind_key)
        if value is not None:
            document[action_key] = value
    return document


def _episode_template(definition: WorldDefinition) -> list[dict[str, Any]]:
    """把 probe actions 变成 episode 模板（最后一个 probe 是决策事件）。

    **每个事件都带 ``binds``**：语料必须自描述——从磁盘上的 ``world-spec.json``
    就要能恢复全部 probe action（集成管线对每个 probe 各展开一个家族），不能依赖
    ``corpus.py`` 在内存里的定义。``decision_event_index`` 仍指向最后一个
    （攻击动作），``expand_family`` 的默认决策事件因此不变。
    """
    events: list[dict[str, Any]] = []
    for index, probe in enumerate(definition.probes):
        binds = dict(probe.binds)
        event: dict[str, Any] = {
            "event_type": "request",
            "actor_id": str(binds.get("actor")),
            "t_offset_ms": index * 60000,
            "causal_tag": probe.causal_tag,
            "summary": probe.summary,
            "binds": {
                key: value
                for key, value in (
                    ("operation", binds.get("operation")),
                    ("resource_id", binds.get("resource_id")),
                    ("session_id", binds.get("session_id")),
                    ("token_id", binds.get("token_id")),
                    ("workflow_instance_id", binds.get("workflow_instance_id")),
                    ("flow_id", binds.get("flow_id")),
                )
                if value is not None
            },
        }
        events.append(event)
    return [
        {
            "template_id": "TPL-001",
            "decision_event_index": len(events) - 1,
            "events": events,
        }
    ]


def _hypotheses(definition: WorldDefinition) -> dict[str, Any]:
    attack = definition.probes[-1]
    axes: list[dict[str, Any]] = []
    for index, (variable, before, after) in enumerate(definition.critical_axes, start=1):
        axes.append(
            {
                "axis_id": f"AXIS-{index:03d}",
                "variable": variable,
                "kind": "critical",
                "before": before,
                "after": after,
                "expected_effect": "verdict_flip",
                "rationale": (
                    f"If {variable} changes from {before!r} to {after!r} the decisive condition of "
                    "this world flips, so the verdict must flip with it."
                ),
            }
        )
    for index, axis in enumerate(definition.irrelevant_axes, start=1):
        axes.append(
            {
                "axis_id": f"AXIS-IR-{index:03d}",
                "variable": axis,
                "kind": "irrelevant",
                "before": "before",
                "after": "after",
                "expected_effect": "verdict_invariant",
                "rationale": "Surface-only axis: it carries no decision-critical fact.",
            }
        )
    return {
        "attack_opportunities": [
            {
                "opportunity_id": "OPP-001",
                "attack_family": definition.attack_family,
                "target_operation": str(attack.binds.get("operation")),
                "hypothesized_verdict": attack.expectation.world_truth,
                "rationale": attack.summary,
            }
        ],
        "expected_counterfactual_axes": axes,
    }


def build_spec_document(definition: WorldDefinition) -> dict[str, Any]:
    """一个 :class:`WorldDefinition` → 完整 world-spec 文档（构造即校验）。"""
    workflows = definition.workflows or (_default_workflow(definition),)
    document: dict[str, Any] = {
        "$comment": (
            f"{definition.directory}: {definition.title}. Generated by worlds/handcrafted.py; "
            "the human expectation lives in expected.md and is NOT derived from the oracle."
        ),
        "schema_version": "0.1",
        "world_id": definition.world_id,
        "application_domain": definition.domain,
        "seed": definition.seed,
        "provenance": _provenance(),
        "attack_family": definition.attack_family,
        "application": {
            "name": definition.title,
            "description": definition.description,
            "endpoints": [dict(item) for item in definition.endpoints],
        },
        "roles": [dict(item) for item in definition.roles],
        "actors": [dict(item) for item in definition.actors],
        "resources": [dict(item) for item in definition.resources],
        "sessions": [dict(item) for item in definition.sessions],
        "tokens": [dict(item) for item in definition.tokens],
        "credentials": [dict(item) for item in definition.credentials],
        "workflows": [dict(item) for item in workflows],
        "services": [dict(item) for item in definition.services],
        "caches": [dict(item) for item in definition.caches],
        "trust_boundaries": [dict(item) for item in definition.trust_boundaries],
        "policies": [dict(item) for item in definition.policies] + [dict(DEFAULT_DENY_POLICY)],
        "invariants": [dict(item) for item in definition.invariants],
        "state_history": [dict(item) for item in (definition.state_history or _default_history(definition))],
        "current_state": dict(definition.current_state or _default_current_state(definition)),
        "critical_state_variables": [axis[0] for axis in definition.critical_axes],
        "irrelevant_state_variables": list(definition.irrelevant_axes),
        "hypotheses": _hypotheses(definition),
        "episode_templates": _episode_template(definition),
        "notes": definition.notes or f"{definition.directory} handcrafted world.",
    }
    # 证据：先按决策闭包生成，再附加世界显式声明的（矛盾/陈旧/攻击者可控）。
    document["evidence"] = _evidence_for(
        document, definition.probes, overrides=definition.evidence_overrides
    ) + [dict(item) for item in definition.extra_evidence]
    errors = validate_document(document, "world-spec")
    if errors:
        raise ValueError(
            f"{definition.directory} 构造的 spec 未通过 world-spec.schema.json:\n  - "
            + "\n  - ".join(errors)
        )
    return document


def _default_workflow(definition: WorldDefinition) -> dict[str, Any]:
    operation = str(definition.probes[-1].binds.get("operation"))
    return {
        "workflow_id": "WFL-GENERIC",
        "name": "Generic lifecycle",
        "states": ["open", "active", "closed"],
        "initial_state": "open",
        "transitions": [
            {"from_state": "open", "to_state": "active"},
            {"from_state": "active", "to_state": "closed"},
        ],
        "instances": [
            {
                "instance_id": "WFI-001",
                "resource_id": definition.resources[0]["resource_id"],
                "current_state": "active",
                "history": [
                    {
                        "from_state": "open",
                        "to_state": "active",
                        "at": "2026-09-19T08:30:00Z",
                        "actor_id": definition.actors[0]["actor_id"],
                    }
                ],
            }
        ],
    }


def _default_history(definition: WorldDefinition) -> tuple[Mapping[str, Any], ...]:
    return (
        {
            "snapshot_id": "SNAP-000",
            "at": "2026-09-19T07:00:00Z",
            "label": "T-1 before any event",
            "actor_states": {
                actor["actor_id"]: {
                    "authentication_state": actor.get("authentication_state", "authenticated"),
                    "privilege_version": actor.get("privilege_version", 0),
                    "roles": list(actor.get("roles") or ()),
                }
                for actor in definition.actors
            },
            "session_states": {
                session["session_id"]: {
                    "valid": session.get("valid", True),
                    "revoked": session.get("revoked", False),
                    "privilege_version": (session.get("privilege_snapshot") or {}).get(
                        "privilege_version", 0
                    ),
                }
                for session in definition.sessions
            },
            "token_states": {
                token["token_id"]: {
                    "used": token.get("used", False),
                    "valid": True,
                }
                for token in definition.tokens
            },
            "workflow_states": {
                instance["instance_id"]: {"current_state": instance["current_state"]}
                for workflow in definition.workflows
                for instance in workflow.get("instances") or ()
            },
            "resource_states": {
                resource["resource_id"]: {
                    "state": resource.get("state", "active"),
                    "owner": resource["owner"],
                }
                for resource in definition.resources
            },
        },
    )


def _default_current_state(definition: WorldDefinition) -> dict[str, Any]:
    history = _default_history(definition)
    snapshot = copy.deepcopy(dict(history[-1]))
    snapshot["snapshot_id"] = "SNAP-001"
    snapshot["at"] = NOW
    snapshot["label"] = "T0 current"
    return snapshot


# --------------------------------------------------------------------------- #
# expected.md
# --------------------------------------------------------------------------- #
def render_expected_md(definition: WorldDefinition) -> str:
    """``expected.md``：人工预期 + 这个世界在测什么。"""
    lines: list[str] = [
        f"# {definition.directory} — {definition.title}",
        "",
        f"- **domain**: `{definition.domain}`",
        f"- **attack_family (先验声明)**: `{definition.attack_family}`",
        f"- **主测不变量**: "
        + ", ".join(f"`{item['category']}`" for item in definition.invariants),
        "",
        "## 人工预期（人写的，不是跑 oracle 抄下来的）",
        "",
        "oracle 的判决必须逐字等于下表；不一致 ⇒ 这个世界写错了，修 spec，不是修 oracle",
        "（设计 §12.2）。`observable_decision` 是**可见证据上**的判决，`world_truth` 是",
        "完整状态上的判决——世界声明了矛盾/陈旧/攻击者可控证据时，两者刻意分歧。",
        "",
        "| probe | operation | world_truth | observable_decision | 说明 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for index, probe in enumerate(definition.probes, start=1):
        lines.append(
            f"| P{index} | `{probe.binds.get('operation')}` | `{probe.expectation.world_truth}` "
            f"| `{probe.expectation.observable_decision}` | {probe.summary} |"
        )
    lines.extend(
        [
            "",
            "## 关键轴（先验声明，Gate 5 据此证伪）",
            "",
        ]
    )
    for variable, before, after in definition.critical_axes:
        lines.append(f"- `{variable}`: `{before!r}` → `{after!r}`，期望 `verdict_flip`")
    lines.extend(
        [
            "",
            "## 无关轴（Gate 6：世界状态零变化）",
            "",
        ]
    )
    for axis in definition.irrelevant_axes:
        lines.append(f"- `{axis}`")
    lines.extend(["", "## 备注", "", definition.notes or "（无）", ""])
    return "\n".join(lines)


__all__ = [
    "DEFAULT_DENY_POLICY",
    "DEFAULT_IRRELEVANT_AXES",
    "Expectation",
    "NOW",
    "ProbeAction",
    "WorldDefinition",
    "build_spec_document",
    "render_expected_md",
]
