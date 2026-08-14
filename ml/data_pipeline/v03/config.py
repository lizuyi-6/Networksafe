"""v0.3 pipeline configuration: paths, sharding, concurrency, resumability.

No secrets here. API keys are read from env at provider-load time (provider.py), never stored.
"""
from __future__ import annotations
from pathlib import Path

# ml/data_pipeline/v03/ -> repo root
_V03_ROOT = Path(__file__).resolve().parent
REPO_ROOT = _V03_ROOT.parents[2]
ML_ROOT = REPO_ROOT / "ml"
SCHEMAS_DIR = ML_ROOT / "schemas"
PROMPTS_DIR = ML_ROOT / "data_pipeline" / "prompts" / "v03"

# Prompt version (single source of truth; recorded in audit + manifest for provenance).
# 0.3.2: targetHost verbatim injection + SSRF payload-IP guidance.
PROMPT_VERSION = "0.3.2"

# Output release directory (TRAIN only - mission §7). Large JSONL is git-ignored, not committed.
RELEASES_DIR = ML_ROOT / "data" / "releases" / "v03"
ACCEPTED_DIR = RELEASES_DIR / "accepted"
REJECTED_DIR = RELEASES_DIR / "rejected"
STATE_DIR = RELEASES_DIR / ".state"
AUDIT_LOG_PATH = RELEASES_DIR / "audit.jsonl"
MANIFEST_PATH = RELEASES_DIR / "manifest.json"
REPORT_PATH = RELEASES_DIR / "v03-generation-report.md"
QUOTA_PROGRESS_PATH = STATE_DIR / "quota-progress.json"

# Scale targets (mission §8)
DEFAULT_TARGET = 300_000
MIN_TARGET = 200_000
STRETCH_TARGET = 500_000

# Sharding: 5k-10k accepted samples per shard (mission §7)
SHARD_MIN = 5_000
SHARD_MAX = 10_000

# Concurrency caps for the async pipeline. Ark glm-5.2 reasoning calls are ~3-8s each; these
# caps keep token-budget and rate-limit pressure reasonable. Tunable via env. For the full
# 300k run, raise GENERATOR_CONCURRENCY / ARK_MAX_INFLIGHT to scale throughput (bounded by the
# Ark key's RPM limit - if 429s appear, lower these).
import os as _os
GENERATOR_CONCURRENCY = int(_os.environ.get("ARK_GENERATOR_CONCURRENCY", "12"))
REVIEWER_CONCURRENCY = int(_os.environ.get("ARK_REVIEWER_CONCURRENCY", "24"))   # 2 per candidate
ADJUDICATOR_CONCURRENCY = int(_os.environ.get("ARK_ADJUDICATOR_CONCURRENCY", "12"))
MAX_INFLIGHT = int(_os.environ.get("ARK_MAX_INFLIGHT", "32"))

REVIEWERS_PER_CANDIDATE = 2  # mission §28: two blind reviewers

# Provider roles (maps to ARK_MODEL_<ROLE> env override; provider.py resolves the rest)
ROLE_GENERATOR = "generator"
ROLE_REVIEWER = "reviewer"
ROLE_ADJUDICATOR = "adjudicator"

# Generation-spec context-axis rotation pools (used by spec_planner for diversity)
# Kept here so the planner and the quota validator agree on the universe.
CORE_ATTACK_FAMILIES = (
    "sqli", "xss", "command_injection", "path_traversal", "ssrf",
    "authentication", "automation", "api_abuse", "deserialization",
    "file_upload", "protocol_attack", "business_logic",
)
# "benign" is the family for safe verdicts; "other" is capped at <=5% of malicious.
ALL_ATTACK_FAMILIES = ("benign",) + CORE_ATTACK_FAMILIES + ("other",)

# Dataset version stamp (frozen for v0.3)
DATASET_VERSION = "v03"
