"""RENDERER-V1: episode -> model prompt + supervised target.

Frozen rendering rules (master brief §34/§35):
- The model-visible surface is built ONLY from observation.model_visible fields
  (request / timeline / evidence / current_time). Nothing from oracle_output,
  decision_metadata, group_keys, provenance, world_truth may enter the prompt.
- M1 view is episode-independent: request only. M2/M3 view adds timeline and
  evidence (state/history/evidence/provenance).
- The target is the observable decision + attack family; it never leaks back
  into the input.
"""
from __future__ import annotations

import json
from typing import Any

from .contract import FAMILY_NONE, Verdict

SYSTEM_PROMPT = (
    "你是 AetherGuard 安全访问判定引擎。根据输入的当前请求、时间线历史和可见证据，"
    "判断该请求应判定为 attack、safe 还是 insufficient_evidence。"
    "只能输出一个 JSON 对象，不得输出 Markdown、代码块、思考过程或额外说明。"
    "必须且只能包含 verdict 和 attack_family 两个键。"
    "verdict 只能是 attack、safe、insufficient_evidence；"
    "attack_family 只能是观察中明确出现的攻击家族名，无法给出家族或 verdict 不是 attack 时必须为 none。"
    "证据不足以支持判定时必须返回 insufficient_evidence；解析或判断失败绝不能返回 safe 或 attack。"
)

RENDERER_ID = "RENDERER-V1"

# RENDERER-V1 frozen rule: an evidence value longer than this is truncated with
# an explicit marker (some derived_summary values embed whole JSON documents;
# letting them through would explode the context window).
MAX_VALUE_CHARS = 600


def _truncate(text: str) -> str:
    if len(text) <= MAX_VALUE_CHARS:
        return text
    return text[:MAX_VALUE_CHARS] + "…[truncated]"


def _fmt_evidence_item(ev: dict[str, Any]) -> str:
    # Only the model_visible evidence's own fields; provenance/trust info comes
    # from the evidence record itself, never from decision_metadata.
    parts = [
        f"id={ev.get('evidence_id', '')}",
        f"type={ev.get('type', '')}",
        f"source={ev.get('source', '')}",
        f"provenance={ev.get('provenance', '')}",
        f"at={ev.get('timestamp', '')}",
    ]
    value = ev.get("value")
    value_text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)
    return f"- {'; '.join(parts)}; value={_truncate(value_text)}"


def render_m1(episode: dict[str, Any]) -> str:
    """Episode-independent view: the current request only."""
    mv = episode["observation"]["model_visible"]
    request = mv["request"]
    text = request.get("rendered_text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"episode {episode.get('episode_id')}: missing request.rendered_text")
    return text.rstrip("\n")


def render_m2(episode: dict[str, Any]) -> str:
    """Stateful view: request + timeline + evidence with provenance."""
    mv = episode["observation"]["model_visible"]
    request = mv["request"]
    text = request.get("rendered_text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"episode {episode.get('episode_id')}: missing request.rendered_text")
    blocks = [
        "CURRENT_TIME: " + str(mv.get("current_time", "")),
        "REQUEST:",
        text.rstrip("\n"),
    ]
    timeline = mv.get("timeline") or []
    if timeline:
        lines = []
        for ev_item in sorted(timeline, key=lambda t: t.get("t_index", 0)):
            lines.append(
                f"- t{ev_item.get('t_index', '')} [{ev_item.get('at', '')}] "
                f"{ev_item.get('event_type', '')}: {ev_item.get('summary', '')} "
                f"(actor={ev_item.get('actor_id', '')})"
            )
        blocks.append("TIMELINE:")
        blocks.extend(lines)
    evidence = mv.get("evidence") or []
    if evidence:
        blocks.append("EVIDENCE:")
        blocks.extend(_fmt_evidence_item(e) for e in evidence)
    return "\n".join(blocks)


VIEWS = {"m1": render_m1, "m2": render_m2, "m3": render_m2}


def render_view(method: str, episode: dict[str, Any]) -> str:
    key = method.split("-")[0]
    if key not in VIEWS:
        raise ValueError(f"no renderer view for method {method}")
    return VIEWS[key](episode)


def target_for(episode: dict[str, Any]) -> dict[str, str]:
    """Frozen supervised target: observable decision + family (or 'none')."""
    oracle = episode["oracle_output"]
    verdict = oracle["observable_decision"]
    if verdict not in (Verdict.ATTACK.value, Verdict.SAFE.value, Verdict.INSUFFICIENT_EVIDENCE.value):
        raise ValueError(f"episode {episode.get('episode_id')}: unknown observable_decision {verdict!r}")
    family = FAMILY_NONE
    if verdict == Verdict.ATTACK.value:
        family = episode["group_keys"].get("attack_family") or FAMILY_NONE
    return {"verdict": verdict, "attack_family": family}


def target_text(target: dict[str, str]) -> str:
    """Compact deterministic serialization of the target (sorted keys)."""
    return json.dumps(target, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


# ---------------------------------------------------------------- leakage audit
# §35 blocker terms: strings that must never appear in any model-visible prompt.
LEAK_BLOCKERS = (
    # oracle / world truth vocabulary
    "oracle", "world_truth", "observable_decision", "ground_truth",
    # oracle structural ids
    "violated_invariants", "satisfied_invariants", "missing_evidence",
    "required_evidence", "decision_trace", "evidence_view_id",
    # metadata namespaces. NOTE: 'provenance' is an evidence's own model-visible
    # field name (RENDERER-V1 renders provenance=...), so a bare JSON-key form
    # of it is NOT a blocker - derived_summary values legitimately embed such
    # keys inside their value text.
    "group_keys", "decision_metadata",
    "generator",
    "compiler", "policy_family", "invariant_family", "workflow_family",
    "world_family", "semantic_scenario_signature", "policy_graph_hash",
    "counterfactual", "variant_type", "counterfactual_family_id",
    # json keys of the target
    '"verdict"', '"attack_family"',
)

# ID prefixes that mark oracle/metadata namespaces (from design §3 D7 allowlist).
LEAK_ID_PREFIXES = ("POL-", "INV-", "OPP-", "AXIS-", "CF-", "PF-", "IF-", "WFF-", "WF-")


def audit_prompt_leakage(prompt: str) -> list[str]:
    """Return the list of blocker hits in a rendered prompt (0 = clean).

    Family names, invariant IDs etc. may legitimately appear inside evidence
    VALUES copied from the world; the audit therefore checks structural
    namespace markers (JSON keys, id-prefixed metadata ids, oracle vocabulary),
    which is the frozen §35 blocker caliber.
    """
    hits = []
    for term in LEAK_BLOCKERS:
        if term in prompt:
            hits.append("term:" + term)
    for token in prompt.replace("\n", " ").split():
        for prefix in LEAK_ID_PREFIXES:
            # ids like CF-73fe5c7f2284 appear as tokens or inside id= values
            if token.startswith(prefix) or f"={prefix}" in token:
                hits.append(f"id-prefix:{prefix}")
                break
    return hits


def build_prompt(method: str, episode: dict[str, Any]) -> str:
    """Full chat-rendered prompt (system + user) for the given method view."""
    body = render_view(method, episode)
    return SYSTEM_PROMPT + "\n\n" + body
