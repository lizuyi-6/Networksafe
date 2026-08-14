"""Tamper-evident append-only audit log for the v0.3 pipeline.

Every spec processed (accepted or rejected) appends one JSONL line with a chain hash:
each entry's `prev` field is the sha256 of the previous entry's canonical form. This makes
retroactive editing or deletion detectable (mission §48: provenance + audit).

The log is flushed after every write so a crash leaves a consistent prefix.
"""
from __future__ import annotations
import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class AuditLog:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._prev = self._load_last_hash()

    def _load_last_hash(self) -> str:
        """Resume the chain from the last existing entry, or start fresh."""
        if not self.path.exists():
            return "GENESIS"
        last = "GENESIS"
        try:
            with self.path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    obj = json.loads(line)
                    last = obj.get("entryHash") or "GENESIS"
        except Exception:
            return "GENESIS"
        return last

    def append(self, **fields: Any) -> str:
        """Append one audit entry. Returns the entry hash. Thread-safe, fsync'd."""
        with self._lock:
            entry: dict[str, Any] = {
                "ts": _utc_now_iso(),
                "prev": self._prev,
                **fields,
            }
            # canonical form for hashing (sorted keys, no whitespace)
            canonical = json.dumps(entry, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
            entry_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
            entry["entryHash"] = entry_hash
            line = json.dumps(entry, ensure_ascii=False)
            with self.path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
                f.flush()
                os.fsync(f.fileno())
            self._prev = entry_hash
            return entry_hash

    def verify_chain(self) -> tuple[bool, list[str]]:
        """Re-read the file and verify every prev->entryHash link. Returns (ok, violations)."""
        if not self.path.exists():
            return (True, [])
        prev = "GENESIS"
        violations: list[str] = []
        n = 0
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                n += 1
                try:
                    obj = json.loads(line)
                except Exception as e:
                    violations.append(f"line {n}: unparseable: {e}")
                    continue
                stored_prev = obj.get("prev")
                stored_hash = obj.get("entryHash")
                if stored_prev != prev:
                    violations.append(f"line {n}: prev mismatch (expected {prev[:12]}, got {str(stored_prev)[:12]})")
                # recompute hash over the entry minus entryHash
                recompute = {k: v for k, v in obj.items() if k != "entryHash"}
                canon = json.dumps(recompute, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
                recomputed = hashlib.sha256(canon.encode("utf-8")).hexdigest()
                if recomputed != stored_hash:
                    violations.append(f"line {n}: hash mismatch (stored {str(stored_hash)[:12]}, recomputed {recomputed[:12]})")
                prev = stored_hash or prev
        return (len(violations) == 0, violations)

    def count(self) -> int:
        if not self.path.exists():
            return 0
        n = 0
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    n += 1
        return n


__all__ = ["AuditLog"]
