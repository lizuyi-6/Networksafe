"""Dedup for v0.3: exact-hash during generation + MinHash LSH near-dup.

Exact: canonical_input_hash(detectionInput) in a set -> catches byte-identical requests
regardless of key order (deterministic_checks.canonical_input_hash already sorts keys).

Near-dup: datasketch MinHash + MinHashLSH over word-3-shingles of the flattened request text.
Threshold ~0.8 Jaccard catches semantically near-identical requests (reworded / param-varied /
same-payload-different-field-order). Mission §36: 0 near-duplicates in the final TRAIN set.
"""
from __future__ import annotations
import re
from datasketch import MinHash, MinHashLSH

from .deterministic_checks import canonical_input_hash

_WORD_RE = re.compile(r"[a-z0-9]+")
_SHINGLE_K = 3
_DEFAULT_NUM_PERM = 256
# 0.7 true Jaccard: catches LLM repetition (>0.8) reliably and the borderline value-variation
# case (~0.7). Below 0.7 = distinct samples sharing family structure (expected, kept).
# MinHash underestimates near the threshold; num_perm=256 keeps the estimate within ~0.05 of
# true Jaccard so the 0.7 bar catches true->0.75 near-dups.
_DEFAULT_THRESHOLD = 0.7


def _flatten_input(detection_input: dict) -> str:
    parts: list[str] = []
    for k in ("method", "path", "body"):
        v = detection_input.get(k)
        if isinstance(v, str):
            parts.append(v)
    # query is an object: canonicalize via sorted json so key order doesn't affect shingling
    import json
    q = detection_input.get("query")
    if isinstance(q, dict):
        parts.append(json.dumps(q, sort_keys=True, ensure_ascii=False, separators=(",", ":")))
    elif isinstance(q, str):
        parts.append(q)
    headers = detection_input.get("headers") or {}
    if isinstance(headers, dict):
        parts.extend(str(v) for v in headers.values())
    # include rule-signal descriptions so same-payload-different-signal is distinguishable
    rs = detection_input.get("ruleSignals") or []
    if isinstance(rs, list):
        for s in rs:
            if isinstance(s, dict):
                parts.append(str(s.get("description", "")) + str(s.get("ruleId", "")))
    return " ".join(p for p in parts if p).lower()


def _shingles(text: str, k: int = _SHINGLE_K) -> set[str]:
    toks = _WORD_RE.findall(text)
    if len(toks) < k:
        return set(toks) or {text}
    return {" ".join(toks[i:i + k]) for i in range(len(toks) - k + 1)}


def make_minhash(text: str, num_perm: int = _DEFAULT_NUM_PERM) -> MinHash:
    m = MinHash(num_perm=num_perm)
    for s in _shingles(text):
        m.update(s.encode("utf-8"))
    return m


class ExactDeduper:
    """In-memory exact-duplicate filter (canonical sorted-key hash)."""

    def __init__(self):
        self._seen: set[str] = set()

    def check_and_add(self, detection_input: dict) -> bool:
        """Return True if NEW (added); False if an exact duplicate already exists."""
        h = canonical_input_hash(detection_input)
        if h in self._seen:
            return False
        self._seen.add(h)
        return True

    def __len__(self) -> int:
        return len(self._seen)


class NearDeduper:
    """MinHash+LSH near-duplicate filter. Query-before-insert to reject near-dups.

    PAIR-AWARE: contrastive pair members are intentionally similar (they differ in exactly one
    axis, e.g. verdict or context, sharing the same payload). A near-dup between two samples
    sharing the same pairId is the DESIGNED contrast, not a duplicate -> exempted.

    The orchestrator calls add() per ACCEPTED sample; add() returns False if a near-dup already
    exists (the sample is then rejected with reason 'near_duplicate').
    """

    def __init__(self, threshold: float = _DEFAULT_THRESHOLD, num_perm: int = _DEFAULT_NUM_PERM):
        self.threshold = threshold
        self.num_perm = num_perm
        self.lsh = MinHashLSH(threshold=threshold, num_perm=num_perm)
        self._minhashes: dict[str, MinHash] = {}
        self._texts: dict[str, str] = {}
        self._pair_ids: dict[str, str] = {}

    def add(self, sample_id: str, detection_input: dict, pair_id: str = "") -> bool:
        """Return True if NEW (inserted); False if a near-dup already exists.

        pair_id: if this sample is a contrastive member, the shared pairId. Near-dup against
        the OTHER member of the same pair is exempt (intended contrast).
        """
        text = _flatten_input(detection_input)
        mh = make_minhash(text, self.num_perm)
        candidates = self.lsh.query(mh)
        for cid in candidates:
            if cid == sample_id:
                continue
            # exempt contrastive pair members (same pairId = intended contrast, not a dup)
            if pair_id and self._pair_ids.get(cid) == pair_id:
                continue
            other = self._minhashes.get(cid)
            if other is not None and mh.jaccard(other) >= self.threshold:
                return False  # near-dup of an existing accepted sample
        self.lsh.insert(sample_id, mh)
        self._minhashes[sample_id] = mh
        self._texts[sample_id] = text
        self._pair_ids[sample_id] = pair_id
        return True

    def near_dup_of(self, sample_id: str) -> str | None:
        """If sample_id is a near-dup, return the id of the closest existing match; else None."""
        text = self._texts.get(sample_id)
        if text is None:
            return None
        mh = self._minhashes[sample_id]
        cands = [c for c in self.lsh.query(mh) if c != sample_id]
        pair_id = self._pair_ids.get(sample_id, "")
        best, best_j = None, 0.0
        for cid in cands:
            if pair_id and self._pair_ids.get(cid) == pair_id:
                continue
            other = self._minhashes.get(cid)
            if other is not None:
                j = mh.jaccard(other)
                if j > best_j:
                    best_j, best = j, cid
        return best

    def __len__(self) -> int:
        return len(self._minhashes)


def near_dedup_pass(records: list[dict], threshold: float = _DEFAULT_THRESHOLD,
                    num_perm: int = _DEFAULT_NUM_PERM) -> tuple[list[dict], list[dict]]:
    """Post-processing near-dup sweep over already-accepted records.

    Returns (kept, removed). Pair-aware: contrastive pair members (same pairId) are exempt.
    """
    kept: list[dict] = []
    removed: list[dict] = []
    nd = NearDeduper(threshold=threshold, num_perm=num_perm)
    for rec in records:
        di = (rec.get("candidate") or {}).get("detectionInput") or rec.get("detectionInput")
        if not isinstance(di, dict):
            kept.append(rec)
            continue
        sid = rec.get("sampleId") or (rec.get("spec", {}) or {}).get("sampleId") or f"r{len(kept)+len(removed)}"
        pid = rec.get("pairId") or (rec.get("spec", {}) or {}).get("pairId") or ""
        if nd.add(sid, di, pair_id=pid):
            kept.append(rec)
        else:
            removed.append(rec)
    return kept, removed


__all__ = ["ExactDeduper", "NearDeduper", "near_dedup_pass", "make_minhash"]
