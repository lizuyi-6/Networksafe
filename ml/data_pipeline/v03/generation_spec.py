"""v0.3 immutable Generation Spec (mission §9-10, §27).

The PROGRAM owns the ground truth, NOT the LLM. The spec planner builds a GenerationSpec that
fixes verdict/attackFamily/severity/recommendedAction (immutable). The LLM request-realizer only
realizes a realistic `detectionInput` matching the spec, and MUST copy the immutable labels
verbatim into `detectionOutput`. Any divergence -> deterministic reject (mission §10, §30).

Enum values are authoritative copies of ml/schemas/detection-{input,output}.schema.json so that
realized records pass JSON-schema validation. If those schemas change, update the tuples here.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Any

# ---- Enums mirrored from detection-input/output.schema.json (single source of truth = schemas) ----

VERDICTS = ("safe", "suspicious", "malicious", "unknown")
ATTACK_FAMILIES = (
    "benign", "sqli", "xss", "command_injection", "path_traversal", "ssrf",
    "authentication", "automation", "api_abuse", "deserialization",
    "file_upload", "protocol_attack", "business_logic", "other",
)
SEVERITIES = ("low", "medium", "high", "critical")
RECOMMENDED_ACTIONS = ("allow", "monitor", "challenge", "block")
METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE", "EVENT")
ENDPOINT_SENSITIVITIES = ("low", "medium", "high", "critical")

# ---- v0.3 curriculum enums (cross-cutting axes the spec planner samples over) ----

GENERATION_TYPES = (
    "standard_attack",          # active malicious realization of a family payload
    "hard_negative",            # attack literal present but passive/safe context
    "contrastive_member",       # one variant of a contrastive group (pairId links members)
    "prompt_injection_carrier", # carries injection-like text (verdict INDEPENDENT of presence)
    "unknown_insufficient",     # genuinely insufficient info (not a dumping ground)
    "long_context",             # business-realistic long input (audit logs / event batches / diffs)
    "family_boundary_pair",     # member of a confusable-family contrastive pair
)
SIGNAL_POSITIONS = ("front", "quarter", "middle", "three_quarter", "tail")
LENGTH_CLASSES = ("<512", "512-1024", "1024-2048", "2048-3072", "3072-4096")
ENCODINGS = (
    "plain", "url_encoded", "double_url_encoded", "unicode", "mixed",
    "nested_json", "escaped_json", "query_carrier", "header_carrier",
    "body_carrier", "multipart_metadata",
)
LANGUAGES = ("zh", "en", "zh_en_mixed")
INJECTION_GOALS = (
    "force_safe", "force_allow", "force_block", "force_malicious",
    "change_attack_family", "change_severity", "lower_confidence",
    "remove_evidence", "output_non_json", "ignore_system_prompt",
    "reveal_system_prompt", "invent_evidence",
)
INJECTION_CARRIERS = (
    "query", "headers", "body", "nested_json", "markdown", "comments",
    "logs", "support_ticket", "security_report", "uploaded_metadata",
    "webhook", "api_forwarded", "repo_content", "agent_message", "event_payload",
)
RULE_SIGNAL_MODES = (
    "strong_correct", "weak_correct", "noisy", "false_positive", "conflicting",
    "missing", "multi_family", "strong_but_benign", "weak_but_malicious",
)
HARD_NEGATIVE_CONTEXTS = (
    "read_only_logs", "waf_rules", "source_code", "unit_test_fixtures",
    "support_tickets", "vuln_advisories", "forensics_evidence", "documentation",
    "archived_requests", "authorized_internal_probe", "scanner_results",
)
DIFFICULTIES = ("easy", "medium", "hard", "adversarial")

# Fields the generator MUST copy verbatim into detectionOutput (mission §10 immutable set).
IMMUTABLE_FIELDS = ("verdict", "attackFamily", "severity", "recommendedAction")


@dataclass
class Provenance:
    datasetVersion: str = "v03"
    synthetic: bool = True
    generatorModel: str = ""
    generatorPromptVersion: str = ""
    generationType: str = ""
    sourceDataset: str = "synthetic_v03"
    scenario: str = ""
    encoding: str = "plain"
    reviewModels: list[str] = field(default_factory=list)
    reviewStatus: str = "pending"        # process state, NOT ground truth
    adjudicationStatus: str = "pending"  # process state, NOT ground truth

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class GenerationSpec:
    # identity
    sampleId: str
    pairId: str = ""
    generationType: str = "standard_attack"
    # IMMUTABLE ground truth (program-owned; generator must copy verbatim into detectionOutput)
    verdict: str = "malicious"
    attackFamily: str = "sqli"
    severity: str = "high"
    recommendedAction: str = "block"
    confidenceRange: tuple[float, float] = (0.8, 0.95)
    # request shape hints (realized by generator; must respect these)
    endpointSemantic: str = ""
    method: str = "GET"
    carrier: str = "query"
    contentType: str = ""
    # concrete allowlisted host the generator MUST use verbatim for the request target
    # (Host header / URL host). Eliminates generator-picked forbidden IPs (119.x/120.x/...).
    # NOT an immutable label - a realization hint like method/carrier.
    targetHost: str = ""
    # source-context curriculum (maps to detection-input.sourceContext)
    authenticated: bool = False
    accountPrivilege: str = ""
    internalService: bool = False
    endpointSensitivity: str = "medium"
    openApiMatched: bool = True
    assetType: str = ""
    # encoding / language curriculum
    encoding: str = "plain"
    language: str = "en"
    # prompt-injection curriculum (cross-cutting; presence != malicious - mission §15/§52)
    promptInjectionPresent: bool = False
    promptInjectionGoal: str = ""
    promptInjectionCarrier: str = ""
    promptInjectionPosition: str = ""
    # length + signal-position curriculum
    targetLengthClass: str = "512-1024"
    targetLengthTokens: int = 700
    signalPosition: str = "middle"
    # rule-signal curriculum (mission §25 - rules must NOT always be perfect)
    ruleSignalMode: str = "strong_correct"
    ruleSignalStrength: float = 0.8
    # behavioral / difficulty
    behaviorProfile: str = ""
    difficulty: str = "medium"
    ambiguityTarget: str = ""
    # constraints the generator must honor
    requiredSemanticProperties: list[str] = field(default_factory=list)
    forbiddenShortcuts: list[str] = field(default_factory=list)
    # deterministic per-sample seed handed to the generator. A-specs derive it
    # from (sampleId, verdict, attackFamily, generationType, i); pair B-specs
    # RE-derive over (sampleId, verdict, attackFamily, difficulty) after
    # pair-linking so B realizes a distinct-but-aligned request. Both formulas
    # are fixed and seedless (reproducibility > secrecy). Part of the immutable
    # hash core, so specHash always covers the seed actually used.
    generatorSeed: str = ""
    provenance: Provenance = field(default_factory=Provenance)
    # computed (NOT part of immutable hash)
    specHash: str = ""

    def __post_init__(self) -> None:
        self.validate()
        self.specHash = self.compute_hash()

    # ---- validation: every enum field must be in its allowed set ----
    def validate(self) -> None:
        errors: list[str] = []
        checks = [
            ("verdict", self.verdict, VERDICTS),
            ("attackFamily", self.attackFamily, ATTACK_FAMILIES),
            ("severity", self.severity, SEVERITIES),
            ("recommendedAction", self.recommendedAction, RECOMMENDED_ACTIONS),
            ("method", self.method, METHODS),
            ("endpointSensitivity", self.endpointSensitivity, ENDPOINT_SENSITIVITIES),
            ("generationType", self.generationType, GENERATION_TYPES),
            ("targetLengthClass", self.targetLengthClass, LENGTH_CLASSES),
            ("signalPosition", self.signalPosition, SIGNAL_POSITIONS),
            ("encoding", self.encoding, ENCODINGS),
            ("language", self.language, LANGUAGES),
            ("ruleSignalMode", self.ruleSignalMode, RULE_SIGNAL_MODES),
            ("difficulty", self.difficulty, DIFFICULTIES),
        ]
        for name, val, allowed in checks:
            if val not in allowed:
                errors.append(f"{name}={val!r} not in {allowed}")
        if self.promptInjectionPresent:
            if self.promptInjectionGoal and self.promptInjectionGoal not in INJECTION_GOALS:
                errors.append(f"promptInjectionGoal={self.promptInjectionGoal!r} not in {INJECTION_GOALS}")
            if self.promptInjectionCarrier and self.promptInjectionCarrier not in INJECTION_CARRIERS:
                errors.append(f"promptInjectionCarrier={self.promptInjectionCarrier!r} not in {INJECTION_CARRIERS}")
            if self.promptInjectionPosition and self.promptInjectionPosition not in SIGNAL_POSITIONS:
                errors.append(f"promptInjectionPosition={self.promptInjectionPosition!r} not in {SIGNAL_POSITIONS}")
        # sanity: safe verdict should use benign family (warn only - allow hard-negative edges)
        # (not a hard error; the spec planner decides family for hard-negative-with-literal cases)
        if errors:
            raise ValueError("GenerationSpec invalid:\n  " + "\n  ".join(errors))

    # ---- deterministic hash over the IMMUTABLE core (excludes process-state provenance fields) ----
    def _immutable_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("specHash", None)
        prov = d.get("provenance", {})
        for k in ("reviewStatus", "adjudicationStatus", "reviewModels"):
            prov.pop(k, None)
        d["provenance"] = prov
        return d

    def compute_hash(self) -> str:
        raw = json.dumps(self._immutable_dict(), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["specHash"] = self.specHash or self.compute_hash()
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "GenerationSpec":
        prov = d.get("provenance") or {}
        prov_obj = Provenance(**prov)
        rest = {k: v for k, v in d.items() if k != "provenance" and k != "specHash"}
        # confidenceRange comes back as list from JSON
        if "confidenceRange" in rest and isinstance(rest["confidenceRange"], list):
            rest["confidenceRange"] = tuple(rest["confidenceRange"])
        return cls(provenance=prov_obj, **rest)

    def immutable_labels(self) -> dict[str, str]:
        """The 4 labels the generator MUST copy verbatim into detectionOutput."""
        return {f: getattr(self, f) for f in IMMUTABLE_FIELDS}

    def matches_immutable_labels(self, detection_output: dict[str, Any]) -> bool:
        """True iff detectionOutput carries exactly this spec's immutable labels (mission §10/§32)."""
        return all(detection_output.get(f) == getattr(self, f) for f in IMMUTABLE_FIELDS)
