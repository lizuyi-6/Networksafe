"""Programmatic GenerationSpec planner (mission §20-21).

Ground truth is OWNED BY THE PROGRAM, not the LLM. This module expands the quota matrix
(quotas.cells()) into individual GenerationSpec objects with round-robin context axes for
maximum diversity. The LLM generator only REALIZES the request; it never decides labels.

Deterministic & reproducible: same cells + same seed => same specs (same specHash set).
No randomness source is used - every axis is a pure function of (cell, index), so a re-run
produces byte-identical specs. Contrastive pairs share a pairId and differ in exactly one axis.
"""
from __future__ import annotations
from dataclasses import replace
from typing import Iterator
import hashlib

from . import generation_spec as gs
from . import quotas as Q
from . import config as _config

# ---- per-verdict programmatic label maps (THE GROUND TRUTH) ----

_ACTION_BY_VERDICT: dict[str, list[str]] = {
    "malicious": ["block", "block", "block", "block", "challenge"],
    "suspicious": ["challenge", "challenge", "monitor", "monitor"],
    "safe": ["allow", "allow", "allow", "monitor"],
    "unknown": ["monitor", "monitor", "challenge"],
}

_CONF_RANGE_BY_VERDICT: dict[str, tuple[float, float]] = {
    "malicious": (0.80, 0.99),
    "suspicious": (0.50, 0.82),
    "safe": (0.60, 0.95),
    "unknown": (0.20, 0.50),
}

_SEVERITY_BY_FAMILY: dict[str, list[str]] = {
    "sqli": ["high", "high", "critical"],
    "xss": ["high", "high", "medium"],
    "command_injection": ["critical", "high", "critical"],
    "path_traversal": ["high", "high"],
    "ssrf": ["high", "high", "critical"],
    "authentication": ["high", "high", "critical"],
    "automation": ["medium", "high"],
    "api_abuse": ["medium", "high"],
    "deserialization": ["critical", "high"],
    "file_upload": ["high", "critical"],
    "protocol_attack": ["high", "critical"],
    "business_logic": ["medium", "high"],
    "other": ["medium", "high"],
    "benign": ["low", "low", "low"],
}

# ---- context-axis rotation pools (round-robin for full coverage) ----

_METHODS_BY_FAMILY: dict[str, list[str]] = {
    "sqli": ["GET", "POST", "PUT"], "xss": ["GET", "POST"],
    "command_injection": ["POST", "PUT"], "path_traversal": ["GET", "POST"],
    "ssrf": ["POST", "GET"], "authentication": ["POST", "PUT"],
    "automation": ["GET", "POST"], "api_abuse": ["GET", "POST"],
    "deserialization": ["POST", "PUT"], "file_upload": ["POST", "PUT"],
    "protocol_attack": ["POST", "GET"], "business_logic": ["POST", "PUT", "PATCH"],
    "other": ["GET", "POST"], "benign": ["GET", "POST", "HEAD", "OPTIONS"],
}
_CARRIERS = ("query", "body", "json", "form", "header", "path", "multipart")
_CONTENT_TYPES = {
    "query": "", "body": "text/plain", "json": "application/json",
    "form": "application/x-www-form-urlencoded", "header": "",
    "path": "", "multipart": "multipart/form-data",
}
_ASSET_TYPES = ("database", "file_system", "auth_service", "api_gateway", "cache",
                "queue", "object_storage", "compute", "config_store", "none")
# Allowlisted request targets only (mission §41; det_check enforces). Injected verbatim into
# each spec so the generator never picks a forbidden public IP (119.x/120.x/...). Mix of
# RFC5737 doc ranges, RFC1918 private, loopback, link-local metadata, and reserved domains.
_TARGET_HOSTS = (
    "example.com", "example.org", "example.net", "example.invalid", "test.local", "localhost",
    "127.0.0.1", "10.0.0.5", "10.1.2.3", "172.16.0.10", "192.168.1.50",
    "192.0.2.10", "192.0.2.55", "198.51.100.20", "203.0.113.5", "169.254.169.254",
)
_ACCOUNT_PRIV = ("anonymous", "standard", "privileged", "admin", "service", "internal")
_UNKNOWN_AMBIGUITY = ("truncated_body", "partial_headers", "unknown_endpoint",
                      "conflicting_signals", "ambiguous_method_semantics")
_CONFUSABLE_FAMILY = {
    "sqli": "command_injection", "command_injection": "sqli",
    "xss": "sqli", "path_traversal": "ssrf", "ssrf": "path_traversal",
    "authentication": "api_abuse", "api_abuse": "authentication",
    "automation": "api_abuse", "deserialization": "file_upload",
    "file_upload": "deserialization", "protocol_attack": "ssrf",
    "business_logic": "api_abuse", "other": "sqli", "benign": "benign",
}

# ---- generator guidance (requiredSemanticProperties + forbiddenShortcuts) ----

_REQUIRED_PROPS_BY_FAMILY: dict[str, list[str]] = {
    "sqli": ["decisive SQL metacharacter/keyword in a parameter bound for a DB sink",
             "execution context, not a passive log"],
    "xss": ["script/HTML payload in a field reflected/stored for HTML rendering",
            "reaches an HTML sink"],
    "command_injection": ["shell metacharacters in a field reaching a command-execution sink",
                          "active execution"],
    "path_traversal": ["../ or absolute-path traversal toward filesystem read",
                       "reaches a file-access sink"],
    "ssrf": ["URL/host toward an internal/metadata target the server will fetch",
             "active fetch, not a documentation reference"],
    "authentication": ["credential replay/forgery/bypass toward an auth decision",
                       "auth-critical endpoint"],
    "automation": ["abnormal rate/volume pattern indicating non-human automation",
                   "rate-sensitive endpoint"],
    "api_abuse": ["abusive use within authorized auth but violating intent/quota",
                  "quota/resource-sensitive"],
    "deserialization": ["serialized payload toward an unsafe deserializer",
                        "active deserialization sink"],
    "file_upload": ["uploaded content that will be stored/served unsafely",
                    "upload endpoint"],
    "protocol_attack": ["protocol-level smuggling/request-splitting/header injection",
                        "raw protocol handling"],
    "business_logic": ["abuse of valid-in-isolation steps to violate a business invariant",
                       "multi-step workflow"],
    "other": ["clearly malicious but not fitting a named family", "real execution risk"],
    "benign": ["normal expected traffic OR attack literal in passive evidentiary context",
               "no active execution"],
}

_FORBIDDEN_BY_GENTYPE: dict[str, list[str]] = {
    "standard_attack": ["must NOT include meta-phrases revealing the verdict",
                        "must NOT use real third-party targets"],
    "hard_negative": ["safety MUST come from passive context, NOT from a 'this is safe' label",
                      "must NOT place payload in an active execution sink",
                      "must NOT add label-leakage text"],
    "contrastive_member": ["must differ from pair member in the contrastive axis ONLY; "
                           "all other context axes identical",
                           "must NOT leak the pair structure into the request text"],
    "prompt_injection_carrier": ["injection presence MUST be decorrelated from verdict "
                                 "(injection does not imply malicious)",
                                 "must NOT add a verdict-revealing label"],
    "unknown_insufficient": ["must be genuinely information-poor (truncated/partial/ambiguous), "
                            "not a dumping ground",
                            "must NOT contain enough signal to confidently classify"],
    "long_context": ["length must come from business-realistic content (logs/events/diffs), "
                     "not padding",
                     "decisive signal must remain locatable"],
    "family_boundary_pair": ["the two members must be confusable on family; realize the "
                             "family distinction via the actual sink semantics"],
}


def _pick(pool, i: int):
    return pool[i % len(pool)]


class SpecPlanner:
    """Expand quota cells into GenerationSpec objects.

    Usage:
        planner = SpecPlanner()
        for spec in planner:
            ...  # spec is a validated GenerationSpec with specHash
    """

    def __init__(self, cells=None):
        self._cells = cells if cells is not None else Q.cells()
        self._counter = 0

    def __iter__(self) -> Iterator[gs.GenerationSpec]:
        for cell in self._cells:
            yield from self._expand_cell(cell)

    def planned_count(self) -> int:
        return sum(c["count"] for c in self._cells)

    def specs_for_cell(self, verdict: str, family: str, gtype: str, inj_present: bool,
                       count: int, start_i: int = 0) -> Iterator[gs.GenerationSpec]:
        """Yield `count` FRESH specs for one cell, with context-axis index advancing from
        `start_i` (so deficit waves produce new axis combinations, not replays of wave 0).

        For contrastive cells, `count` is rounded down to even and yields count/2 complete pairs
        (both members share a pairId) - so contrastive pair completeness is preserved across
        deficit waves. SampleIds are globally unique (single incrementing _counter).
        """
        cell = {"verdict": verdict, "attackFamily": family, "generationType": gtype,
                "promptInjectionPresent": inj_present, "count": count}
        if gtype == Q.GT_CONTRASTIVE:
            if count < 2:
                return
            count = count - (count % 2)  # even
            pairs = count // 2
            axes = ("verdict", "attackFamily", "difficulty", "context")
            for p in range(pairs):
                pair_id = self._next_id(f"pair-{verdict[:2]}{family[:2]}")
                axis = _pick(axes, (start_i // 2) + p)
                base_i = start_i + p * 2
                spec_a = self._make_spec(verdict, family, "contrastive_member",
                                         inj_present, base_i, cell, pair_id=pair_id)
                spec_b = self._make_contrastive_partner(spec_a, axis, base_i + 1)
                yield spec_a
                yield spec_b
        else:
            for j in range(count):
                yield self._make_spec(verdict, family, gtype, inj_present, start_i + j, cell)

    # ---- internals ----

    def _next_id(self, tag: str) -> str:
        self._counter += 1
        return f"{_config.DATASET_VERSION}-{tag}-{self._counter:08d}"

    def _expand_cell(self, cell: dict) -> Iterator[gs.GenerationSpec]:
        gtype = cell["generationType"]
        if gtype == Q.GT_CONTRASTIVE:
            yield from self._expand_contrastive(cell)
            return
        verdict = cell["verdict"]
        family = cell["attackFamily"]
        inj = cell["promptInjectionPresent"]
        count = cell["count"]
        for i in range(count):
            yield self._make_spec(verdict, family, gtype, inj, i, cell)

    def _expand_contrastive(self, cell: dict) -> Iterator[gs.GenerationSpec]:
        verdict = cell["verdict"]
        family = cell["attackFamily"]
        count = cell["count"]
        if count % 2 != 0:
            raise ValueError(f"contrastive cell count must be even, got {count}")
        pairs = count // 2
        axes = ("verdict", "attackFamily", "difficulty", "context")
        for p in range(pairs):
            pair_id = self._next_id(f"pair-{verdict[:2]}{family[:2]}")
            axis = _pick(axes, p)
            base_i = p * 2
            spec_a = self._make_spec(verdict, family, "contrastive_member",
                                     cell["promptInjectionPresent"], base_i, cell,
                                     pair_id=pair_id)
            spec_b = self._make_contrastive_partner(spec_a, axis, base_i + 1)
            yield spec_a
            yield spec_b

    def _make_spec(self, verdict, family, gtype, inj_present, i, cell,
                   pair_id: str = "") -> gs.GenerationSpec:
        sid = self._next_id(f"{verdict[:2]}{family[:2]}{gtype[:2]}")
        methods = _METHODS_BY_FAMILY.get(family, ["GET", "POST"])
        method = _pick(methods, i)
        carrier = _pick(_CARRIERS, i)
        encoding = _pick(gs.ENCODINGS, i)
        signal_pos = _pick(gs.SIGNAL_POSITIONS, i)
        length_class = _pick(gs.LENGTH_CLASSES, i)
        rsm = _pick(gs.RULE_SIGNAL_MODES, i)
        difficulty = _pick(gs.DIFFICULTIES, i)
        language = _pick(gs.LANGUAGES, i)
        endpoint_sens = _pick(gs.ENDPOINT_SENSITIVITIES, i)
        asset = _pick(_ASSET_TYPES, i)
        priv = _pick(_ACCOUNT_PRIV, i)
        target_host = _pick(_TARGET_HOSTS, i)
        authenticated = priv != "anonymous"

        action = _pick(_ACTION_BY_VERDICT[verdict], i)
        sev = self._severity_for(verdict, family, i)
        conf_range = _CONF_RANGE_BY_VERDICT[verdict]

        behavior = f"{family}_{verdict}_{difficulty}"
        ambiguity = ""
        if gtype == Q.GT_HARD_NEG:
            ctx = _pick(gs.HARD_NEGATIVE_CONTEXTS, i)
            behavior = f"hard_neg_{ctx}"
            ambiguity = ctx
        elif gtype == Q.GT_UNKNOWN:
            ambiguity = _pick(_UNKNOWN_AMBIGUITY, i)

        inj_goal = inj_carrier = inj_pos = ""
        if inj_present:
            inj_goal = _pick(gs.INJECTION_GOALS, i)
            inj_carrier = _pick(gs.INJECTION_CARRIERS, i)
            inj_pos = _pick(gs.SIGNAL_POSITIONS, i)

        req = list(_REQUIRED_PROPS_BY_FAMILY.get(family, []))
        forb = list(_FORBIDDEN_BY_GENTYPE.get(gtype, []))
        gseed = hashlib.sha256(
            f"{sid}:{verdict}:{family}:{gtype}:{i}".encode("utf-8")
        ).hexdigest()[:16]
        len_tokens = _length_tokens(length_class)
        rss = 0.9 if rsm == "strong_correct" else (0.55 if rsm.startswith("weak") else 0.35)

        return gs.GenerationSpec(
            sampleId=sid,
            pairId=pair_id,
            generationType=gtype,
            verdict=verdict,
            attackFamily=family,
            severity=sev,
            recommendedAction=action,
            confidenceRange=conf_range,
            endpointSemantic=_endpoint_semantic(family, asset, i),
            method=method,
            carrier=carrier,
            contentType=_CONTENT_TYPES.get(carrier, ""),
            targetHost=target_host,
            authenticated=authenticated,
            accountPrivilege=priv,
            internalService=(priv == "service" or priv == "internal"),
            endpointSensitivity=endpoint_sens,
            openApiMatched=(i % 5 != 0),
            assetType=asset,
            encoding=encoding,
            language=language,
            promptInjectionPresent=inj_present,
            promptInjectionGoal=inj_goal,
            promptInjectionCarrier=inj_carrier,
            promptInjectionPosition=inj_pos,
            targetLengthClass=length_class,
            targetLengthTokens=len_tokens,
            signalPosition=signal_pos,
            ruleSignalMode=rsm,
            ruleSignalStrength=rss,
            behaviorProfile=behavior,
            difficulty=difficulty,
            ambiguityTarget=ambiguity,
            requiredSemanticProperties=req,
            forbiddenShortcuts=forb,
            generatorSeed=gseed,
            provenance=gs.Provenance(
                datasetVersion=_config.DATASET_VERSION,
                synthetic=True,
                generationType=gtype,
                encoding=encoding,
            ),
        )

    def _make_contrastive_partner(self, spec_a: gs.GenerationSpec,
                                  axis: str, i: int) -> gs.GenerationSpec:
        """Build B = copy of A differing in exactly `axis`. replace() re-runs __post_init__
        so specHash is recomputed over the new (correct) immutable core, including pairId."""
        if axis == "verdict":
            alt = {"safe": "malicious", "malicious": "safe",
                   "suspicious": "unknown", "unknown": "suspicious"}
            new_v = alt.get(spec_a.verdict, "safe")
            new_sev = ("low" if new_v == "safe"
                       else _pick(_SEVERITY_BY_FAMILY.get(spec_a.attackFamily, ["high"]), i))
            b = replace(spec_a, sampleId=self._next_id("pair"),
                        verdict=new_v,
                        recommendedAction=_ACTION_BY_VERDICT[new_v][0],
                        severity=new_sev,
                        confidenceRange=_CONF_RANGE_BY_VERDICT[new_v])
        elif axis == "attackFamily":
            new_f = _CONFUSABLE_FAMILY.get(spec_a.attackFamily, "other")
            new_sev = _pick(_SEVERITY_BY_FAMILY.get(new_f, ["high"]), i)
            b = replace(spec_a, sampleId=self._next_id("pair"),
                        attackFamily=new_f,
                        severity=new_sev,
                        requiredSemanticProperties=list(_REQUIRED_PROPS_BY_FAMILY.get(new_f, [])))
        elif axis == "difficulty":
            new_d = "adversarial" if spec_a.difficulty != "adversarial" else "hard"
            b = replace(spec_a, sampleId=self._next_id("pair"), difficulty=new_d)
        else:  # context
            new_sens = "low" if spec_a.endpointSensitivity != "low" else "high"
            b = replace(spec_a, sampleId=self._next_id("pair"),
                        endpointSensitivity=new_sens,
                        authenticated=not spec_a.authenticated)
        # re-seed B so the generator realizes a distinct-but-aligned request:
        # B's seed is derived over its OWN (sampleId, verdict, attackFamily,
        # difficulty) — a different formula from A's (sid, verdict, family,
        # gtype, i) on purpose, so a pair never shares a generator seed.
        # generatorSeed IS part of the immutable hash core (asdict includes
        # it), so the recompute below keeps specHash over the seed in effect.
        b.generatorSeed = hashlib.sha256(
            f"{b.sampleId}:{b.verdict}:{b.attackFamily}:{b.difficulty}".encode("utf-8")
        ).hexdigest()[:16]
        b.specHash = b.compute_hash()
        return b

    @staticmethod
    def _severity_for(verdict: str, family: str, i: int) -> str:
        if verdict == "safe":
            return "low"
        if verdict == "unknown":
            return _pick(("low", "medium"), i)
        if verdict == "suspicious":
            return _pick(("medium", "high"), i)
        # malicious
        return _pick(_SEVERITY_BY_FAMILY.get(family, ["high"]), i)


def _endpoint_semantic(family: str, asset: str, i: int) -> str:
    base = family if family != "benign" else "health"
    variant = _pick(("/search", "/items", "/process", "/query", "/submit", ""), i)
    return f"/api/v1/{base}/{asset}{variant}"


def _length_tokens(lc: str) -> int:
    return {"<512": 350, "512-1024": 700, "1024-2048": 1400,
            "2048-3072": 2500, "3072-4096": 3500}.get(lc, 700)


__all__ = ["SpecPlanner"]
