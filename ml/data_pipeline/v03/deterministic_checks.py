"""Deterministic quality checks for v0.3 candidates (pure functions, no LLM).

Run BEFORE LLM blind review. A candidate that fails any deterministic check is rejected
without spending an LLM call on it. Each failure yields a machine-readable reason code that
the orchestrator records in the audit log and uses to drive regeneration.

Checks:
  - structure: candidate has detectionInput/detectionOutput dicts
  - schema: both halves validate against the frozen JSON Schemas (draft 2020-12)
  - immutable_labels: candidate.detectionOutput.{verdict,attackFamily,severity,recommendedAction}
    == spec.{...} (ground-truth mutation detection; mission §30)
  - label_leakage: detectionInput text contains no meta-phrases revealing the label
  - secrets: detectionInput text contains no real provider key formats (incl. our own Ark key)
  - forbidden_targets: no real public hosts/IPs in active request fields (mission §41)
  - evidence_grounding: each evidence.field resolves to a value present in detectionInput
  - confidence_range: candidate.confidence within spec.confidenceRange
"""
from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
import hashlib
import ipaddress
import json
import re
from typing import Any

import jsonschema

# ---------------------------------------------------------------- schema load

_V03_ROOT = Path(__file__).resolve().parent
_SCHEMAS_DIR = _V03_ROOT.parent.parent / "schemas"
_INPUT_SCHEMA_PATH = _SCHEMAS_DIR / "detection-input.schema.json"
_OUTPUT_SCHEMA_PATH = _SCHEMAS_DIR / "detection-output.schema.json"


def _load_schema(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


_INPUT_SCHEMA = _load_schema(_INPUT_SCHEMA_PATH)
_OUTPUT_SCHEMA = _load_schema(_OUTPUT_SCHEMA_PATH)
_input_validator = jsonschema.Draft202012Validator(_INPUT_SCHEMA)
_output_validator = jsonschema.Draft202012Validator(_OUTPUT_SCHEMA)

IMMUTABLE_FIELDS = ("verdict", "attackFamily", "severity", "recommendedAction")

# ---------------------------------------------------------------- leakage

# Phrases that reveal the SAMPLE'S LABEL to a reader. Lowercased substring match.
# Deliberately NOT including payload phrases like "ignore previous instructions" - those are
# legitimate injection payloads / advisory content, not label meta-commentary.
_LABEL_LEAKAGE_PATTERNS = (
    "this is malicious", "this is a malicious", "this is an attack",
    "this is safe", "this is a safe", "this is benign",
    "this request is malicious", "this request is safe",
    "attack sample", "attack example for training", "malicious sample",
    "benign sample", "benign example",
    "training sample", "training example", "dataset sample", "dataset example",
    "expected verdict", "expected label", "ground truth", "ground-truth",
    "should be blocked", "should block this", "expected to be blocked",
    "expected block", "label is", "verdict is", "verdict should be",
    "this demonstrates a sqli", "this demonstrates an xss",
    "this is a sql injection", "this is an xss attack",
    "sample is safe", "sample is malicious",
)


def _text_of_input(detection_input: dict) -> str:
    """Flatten the request into a single lowercase string for substring scanning."""
    parts: list[str] = []
    for k in ("method", "path", "body"):
        v = detection_input.get(k)
        if isinstance(v, str):
            parts.append(v)
    q = detection_input.get("query")
    if isinstance(q, dict):
        # query is an object: scan its values (leakage/secrets hide in param values too)
        for vv in q.values():
            if isinstance(vv, (str, int, float, bool)):
                parts.append(str(vv))
    elif isinstance(q, str):
        parts.append(q)
    headers = detection_input.get("headers") or {}
    if isinstance(headers, dict):
        for v in headers.values():
            if isinstance(v, str):
                parts.append(v)
    return " ".join(parts).lower()


def _check_label_leakage(detection_input: dict) -> str | None:
    text = _text_of_input(detection_input)
    for pat in _LABEL_LEAKAGE_PATTERNS:
        if pat in text:
            return pat
    return None


# ---------------------------------------------------------------- secrets

# (name, regex). All real provider key formats we must never let into training data.
_SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("aws_secret", re.compile(r"\baws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{40}\b", re.I)),
    ("github_pat", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("gitlab_pat", re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}\b")),
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("stripe_live", re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b")),
    ("openai_key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9]{40,}\b")),
    ("google_api", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("anthropic_key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{50,}\b")),
    ("ark_key", re.compile(r"\bark-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-fA-Za-z]+\b")),
    ("private_key_block", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("google_oauth", re.compile(r"\bya29\.[A-Za-z0-9_-]{20,}\b", re.I)),
]


def _check_secrets(detection_input: dict) -> tuple[str, str] | None:
    text = _text_of_input(detection_input)
    for name, rx in _SECRET_PATTERNS:
        m = rx.search(text)
        if m:
            return (name, m.group(0)[:24] + "...")
    return None


# ---------------------------------------------------------------- forbidden targets

_SAFE_HOSTS = {
    "example.com", "example.org", "example.net", "example.invalid",
    "test.local", "localhost", "api.example.com", "internal.example.com",
    "admin.example.com", "sub.example.com",
}
_SAFE_HOST_SUFFIXES = (
    ".example.com", ".example.org", ".example.net", ".example.invalid", ".example",
    ".test.local", ".local", ".internal", ".test", ".cluster.local",
    ".svc.cluster.local", ".svc",
)

_SAFE_IPV4_NETS = [
    ipaddress.ip_network(n) for n in (
        "127.0.0.0/8",       # loopback
        "10.0.0.0/8",         # RFC1918
        "172.16.0.0/12",      # RFC1918
        "192.168.0.0/16",     # RFC1918
        "169.254.0.0/16",     # link-local (incl. metadata endpoint sims)
        "100.64.0.0/10",      # CGN
        "0.0.0.0/8",          # local
        "192.0.2.0/24",       # RFC5737 TEST-NET-1 (documentation)
        "198.51.100.0/24",    # RFC5737 TEST-NET-2
        "203.0.113.0/24",     # RFC5737 TEST-NET-3
    )
]

# Real third-party targets that must NEVER appear, even bare (no URL scheme) in query/body/headers.
# Word-boundary anchored so "github.com" does not match inside a synthetic name like "mygithub.com".
# Per mission §41: real third-party targets are forbidden in any context, including hard negatives.
_REAL_TARGET_DOMAINS = (
    "github.com", "gitlab.com", "gitlab.io", "githubusercontent.com",
    "google.com", "gmail.com", "youtube.com", "googleapis.com",
    "amazonaws.com", "amazon.com", "stripe.com", "paypal.com",
    "microsoft.com", "office365.com", "live.com", "azure.com",
    "apple.com", "icloud.com", "facebook.com", "meta.com",
    "instagram.com", "twitter.com", "linkedin.com",
    "cloudflare.com", "okta.com", "auth0.com", "onelogin.com",
    "npmjs.com", "pypi.org", "docker.com", "docker.io",
    "openai.com", "anthropic.com", "bigmodel.cn", "volces.com",
    "aliyun.com", "tencent.com", "163.com",
)
_REAL_TARGET_RE = re.compile(
    r"(?<![A-Za-z0-9.-])(?:"
    + "|".join(d.replace(".", r"\.") for d in _REAL_TARGET_DOMAINS)
    + r")(?![A-Za-z0-9-])",
    re.IGNORECASE,
)

# URL host extractor (scheme required): captures the authority host only.
# Deliberately NOT a general dot-hostname regex - that would false-positive on
# "User-Agent: curl/8.0", "Content-Type: application/json", "text/plain", etc.
_URL_HOST_RE = re.compile(
    r"https?://([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::\d+)?(?:/|\s|\"|$)"
)
_IPV4_RE = re.compile(
    r"(?<!\d)((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})(?!\d)"
)


def _is_safe_host(host: str) -> bool:
    h = host.lower().rstrip(".")
    if h in _SAFE_HOSTS:
        return True
    for suf in _SAFE_HOST_SUFFIXES:
        if h.endswith(suf):
            return True
    return False


def _is_safe_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv4Address):
        return any(addr in net for net in _SAFE_IPV4_NETS)
    if isinstance(addr, ipaddress.IPv6Address):
        return addr.is_loopback or addr.is_private or addr.is_link_local or addr.is_unspecified
    return False


def _extract_url_hosts(text: str) -> list[str]:
    return [m.group(1).lower().rstrip(".") for m in _URL_HOST_RE.finditer(text)]


def _extract_ipv4s(text: str) -> list[str]:
    return [m.group(1) for m in _IPV4_RE.finditer(text)]


def _check_forbidden_targets(detection_input: dict) -> str | None:
    """Detect real third-party targets / unsafe hosts / unsafe IPs in the request.

    Strategy (precision over recall - LLM reviewer backstops bare-domain gaps):
      1. deny-listed real domains anywhere (word-boundary), even bare in query/body;
      2. Host-header authority + scheme-URL hosts + bare IPv4: each must be a safe host/IP.
    MIME-type and version-string false positives are avoided by not using a general
    dot-hostname regex on header values.
    """
    headers = detection_input.get("headers") or {}
    blobs: list[str] = []
    for k in ("path", "query", "body"):
        v = detection_input.get(k)
        if isinstance(v, str):
            blobs.append(v)
        elif isinstance(v, dict):
            # query is an object: scan its values too (IPs/domains hide in param values)
            for vv in v.values():
                if isinstance(vv, (str, int, float, bool)):
                    blobs.append(str(vv))
    if isinstance(headers, dict):
        for v in headers.values():
            if isinstance(v, str):
                blobs.append(v)
    joined = " ".join(blobs)

    # 1. deny-listed real domain anywhere
    m = _REAL_TARGET_RE.search(joined)
    if m:
        return m.group(0)

    # 2. authority / URL hosts / bare IPv4 must be safe
    candidates: list[str] = []
    host = headers.get("Host") if isinstance(headers, dict) else None
    if isinstance(host, str) and host:
        candidates.append(host.lower().split(":")[0].rstrip("."))
    candidates.extend(_extract_url_hosts(joined))
    candidates.extend(_extract_ipv4s(joined))

    seen: set[str] = set()
    for t in candidates:
        if not t or t in seen:
            continue
        seen.add(t)
        if re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", t):
            if not _is_safe_ip(t):
                return t
        else:
            if not _is_safe_host(t):
                return t
    return None


# ---------------------------------------------------------------- evidence grounding

_FIELD_TOKEN_RE = re.compile(r"([^.\[\]]+)|\[(\d+)\]")


def _resolve_field(detection_input: dict, field_ref: str) -> Any:
    cur: Any = detection_input
    for m in _FIELD_TOKEN_RE.finditer(field_ref):
        name, idx = m.group(1), m.group(2)
        if idx is not None:
            if not isinstance(cur, list):
                return None
            i = int(idx)
            cur = cur[i] if 0 <= i < len(cur) else None
        else:
            if not isinstance(cur, dict):
                return None
            cur = cur.get(name)
        if cur is None:
            return None
    return cur


def _check_evidence_grounding(detection_output: dict, detection_input: dict) -> str | None:
    evidence = detection_output.get("evidence")
    if not isinstance(evidence, list):
        return None  # schema catches missing/wrong-type
    for entry in evidence:
        if not isinstance(entry, dict):
            continue
        f = entry.get("field")
        if not isinstance(f, str) or not f:
            return "<missing field>"
        resolved = _resolve_field(detection_input, f)
        if resolved is None:
            return f
    return None


# ---------------------------------------------------------------- result + entry

@dataclass
class CheckResult:
    ok: bool
    reasons: list[str] = field(default_factory=list)

    @classmethod
    def pass_(cls) -> "CheckResult":
        return cls(ok=True)

    @classmethod
    def fail(cls, *reasons: str) -> "CheckResult":
        return cls(ok=False, reasons=list(reasons))


def check(spec: dict, candidate: dict) -> CheckResult:
    """Run all deterministic checks. Returns CheckResult with aggregated reason codes."""
    reasons: list[str] = []

    # 1. structure
    if not isinstance(candidate, dict):
        return CheckResult.fail("structure:not_object")
    di = candidate.get("detectionInput")
    do = candidate.get("detectionOutput")
    if not isinstance(di, dict):
        reasons.append("structure:no_detectionInput")
    if not isinstance(do, dict):
        reasons.append("structure:no_detectionOutput")
    if reasons:
        return CheckResult.fail(*reasons)

    # 2. schema
    for err in sorted(_input_validator.iter_errors(di), key=str):
        reasons.append(f"schema_input:{_short(err)}")
        break
    for err in sorted(_output_validator.iter_errors(do), key=str):
        reasons.append(f"schema_output:{_short(err)}")
        break

    # 3. immutable labels (ground-truth mutation)
    for f in IMMUTABLE_FIELDS:
        sv = spec.get(f)
        cv = do.get(f)
        if sv != cv:
            reasons.append(f"immutable_label_mismatch:{f}(spec={sv!r},cand={cv!r})")

    # 4. label leakage
    leak = _check_label_leakage(di)
    if leak:
        reasons.append(f"label_leakage:{leak[:40]}")

    # 5. secrets
    sec = _check_secrets(di)
    if sec:
        reasons.append(f"secret:{sec[0]}:{sec[1]}")

    # 6. forbidden targets
    tgt = _check_forbidden_targets(di)
    if tgt:
        reasons.append(f"forbidden_target:{tgt}")

    # 7. evidence grounding
    ung = _check_evidence_grounding(do, di)
    if ung:
        reasons.append(f"evidence_ungrounded:{ung}")

    # 8. confidence range
    cr = spec.get("confidenceRange")
    conf = do.get("confidence")
    if isinstance(cr, (list, tuple)) and len(cr) == 2 and isinstance(conf, (int, float)):
        lo, hi = cr
        if not (lo <= conf <= hi):
            reasons.append(f"confidence_out_of_range:{conf}not_in[{lo},{hi}]")

    if reasons:
        return CheckResult.fail(*reasons)
    return CheckResult.pass_()


def _short(err: jsonschema.ValidationError) -> str:
    loc = "/".join(str(p) for p in err.absolute_path) or "<root>"
    msg = (err.message or "")[:80]
    return f"{loc}:{msg}"


# ---------------------------------------------------------------- exact-dup hash

def canonical_input_hash(detection_input: dict) -> str:
    """Stable hash of the realized request for exact-duplicate detection.

    Sorts keys so semantically identical requests with different key order hash the same.
    """
    return hashlib.sha256(
        json.dumps(detection_input, sort_keys=True, ensure_ascii=False,
                   separators=(",", ":")).encode("utf-8")
    ).hexdigest()


__all__ = [
    "CheckResult",
    "check",
    "canonical_input_hash",
    "IMMUTABLE_FIELDS",
]
