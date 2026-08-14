"""Adjudicator: decides ACCEPT / REJECT / MANUAL_REVIEW. Cannot mutate labels (mission §30).

Sees the spec (ground truth), the realized candidate, and both blind reviews. If the
candidate's immutable labels diverge from the spec, that is an automatic REJECT
(ground_truth_mutation) - this is also enforced deterministically upstream, so the LLM
adjudicator is the second layer.
"""
from __future__ import annotations
import json
from typing import Any

from . import config
from .provider import LLMProvider, load_provider_config
from .llm_call import load_prompt, parse_json_lenient
from .deterministic_checks import IMMUTABLE_FIELDS

_PROMPT_NAME = "adjudicator.md"


class Adjudicator:
    def __init__(self, provider: LLMProvider | None = None):
        self.provider = provider or LLMProvider(load_provider_config(config.ROLE_ADJUDICATOR))
        self._prompt = load_prompt(_PROMPT_NAME)

    async def adjudicate(
        self,
        spec_dict: dict[str, Any],
        candidate: dict[str, Any],
        review_a: dict[str, Any],
        review_b: dict[str, Any],
    ) -> dict[str, Any]:
        """Return {decision, reason, rejectionReason}. decision in ACCEPT/REJECT/MANUAL_REVIEW."""
        # Deterministic ground-truth mutation check FIRST (no LLM call needed if labels drifted).
        do = (candidate or {}).get("detectionOutput") or {}
        for f in IMMUTABLE_FIELDS:
            if do.get(f) != spec_dict.get(f):
                return {
                    "decision": "REJECT",
                    "reason": f"immutable label {f} diverged from spec",
                    "rejectionReason": "ground_truth_mutation",
                    "llm_called": False,
                }

        # Deterministic ACCEPT fast-path: if BOTH blind reviewers independently agree with the
        # spec's ground truth on every immutable label (verdict + attackFamily + severity +
        # recommendedAction), that is strong independent consensus - two stateless reviewers saw
        # only the detectionInput and both arrived at the program's labels. The LLM adjudicator
        # adds value only when reviewers disagree; skipping it here saves ~75% of adjudicator
        # LLM calls without weakening the gate (label_leakage/ground_truth_mutation are already
        # caught deterministically upstream; a fake hard negative or low-realism sample would make
        # reviewers DISAGREE with the spec, so it falls through to the LLM path).
        def _rev_agrees(r: dict) -> bool:
            if not isinstance(r, dict) or r.get("error"):
                return False
            return all(r.get(f) == spec_dict.get(f) for f in IMMUTABLE_FIELDS)
        if _rev_agrees(review_a) and _rev_agrees(review_b):
            return {
                "decision": "ACCEPT",
                "reason": "both reviewers agree with ground truth (deterministic fast-path)",
                "rejectionReason": None,
                "llm_called": False,
            }

        # Strip transient underscore-prefixed fields from reviews before showing the LLM.
        def _strip(d: dict) -> dict:
            return {k: v for k, v in d.items() if not k.startswith("_")} if isinstance(d, dict) else {}

        payload = {
            "spec": spec_dict,
            "candidate": candidate,
            "reviewerA": _strip(review_a),
            "reviewerB": _strip(review_b),
        }
        user = json.dumps(payload, ensure_ascii=False)
        try:
            result = await self.provider.chat(
                system=self._prompt, user=user,
                max_tokens=512, temperature=0.0, response_format_json=True,
            )
        except Exception as e:
            # On provider failure, fail safe: MANUAL_REVIEW (do not auto-accept)
            return {
                "decision": "MANUAL_REVIEW",
                "reason": f"provider_error:{type(e).__name__}:{str(e)[:120]}",
                "rejectionReason": None,
                "llm_called": False,
            }
        out = parse_json_lenient(result.content)
        if out is None:
            return {
                "decision": "MANUAL_REVIEW",
                "reason": "unparseable_adjudicator_output",
                "rejectionReason": None,
                "llm_called": False,
            }
        dec = str(out.get("decision", "")).upper()
        if dec not in ("ACCEPT", "REJECT", "MANUAL_REVIEW"):
            dec = "MANUAL_REVIEW"
        out["decision"] = dec
        out.setdefault("reason", "")
        out.setdefault("rejectionReason", None)
        out["llm_called"] = True
        return out


__all__ = ["Adjudicator"]
