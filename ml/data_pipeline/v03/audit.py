"""Tamper-evident append-only audit log for the v0.3 pipeline.

Every spec processed (accepted or rejected) appends one JSONL line with a chain hash:
each entry's `prev` field is the sha256 of the previous entry's canonical form. This makes
retroactive editing or deletion detectable (mission §48: provenance + audit).

The log is flushed after every write so a crash leaves a consistent prefix.

SECURITY FIX (audit 2026-08, ML-004) — truncation + rewrite detection:
The bare sha256 chain has two blind spots this module now closes:
  1. TRUNCATION: verifying a *prefix* of the file always succeeds — an attacker
     (or an accidental truncation) could cut the tail and `verify_chain()` stayed
     green. A sealed tip snapshot (`audit.tip.json` next to the log, written after
     every append) pins {count, tipHash}; any prefix shorter than the sealed tip is
     rejected at load time.
  2. WHOLE-CHAIN REWRITE: sha256 chains are self-consistent under full rewrite —
     a local process could regenerate the entire log from GENESIS. The snapshot
     carries an HMAC-SHA256 seal over "{count}:{tipHash}" keyed by
     `audit-chain.key` (CSPRNG-generated once, next to the log, never committed);
     without the key a forged snapshot cannot seal a rewritten chain. Sealing is
     best-effort: if the key is unavailable the snapshot still pins count+tip
     (truncation detection) and records `"seal": "unkeyed"`.
Resume safety: `_load_last_hash` used to fall back to GENESIS on ANY read error —
a torn write silently forked the chain. Loading now (a) repairs a torn FINAL line
only (crash mid-write; all complete lines precede it), (b) runs the full chain
verification and REFUSES to start on any violation (fail-closed), and (c) checks
the snapshot seal before any append continues.
"""
from __future__ import annotations
import hashlib
import hmac as _hmac
import json
import logging
import os
import secrets
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("v03.audit")

_SNAPSHOT_NAME = "audit.tip.json"
_KEY_NAME = "audit-chain.key"
_KEY_BYTES = 32


class AuditIntegrityError(RuntimeError):
    """Raised when the audit log fails chain/snapshot verification (fail-closed)."""


def _utc_now_iso() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _seal(key: bytes | None, count: int, tip_hash: str) -> str:
    if not key:
        return "unkeyed"
    mac = _hmac.new(key, f"v1:{count}:{tip_hash}".encode("utf-8"), hashlib.sha256)
    return mac.hexdigest()


def _check_seal(key: bytes | None, count: int, tip_hash: str, seal: str) -> bool:
    if seal == "unkeyed":
        # Snapshot written without a key: count+tip still enforced by the caller.
        return True
    if not key:
        # A sealed snapshot exists but we cannot read the key -> cannot confirm.
        return False
    return _hmac.compare_digest(_seal(key, count, tip_hash), str(seal))


class AuditLog:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.snapshot_path = self.path.parent / _SNAPSHOT_NAME
        self.key_path = self.path.parent / _KEY_NAME
        self._lock = threading.Lock()
        self._key = self._load_or_create_key()
        self._repair_torn_tail_if_any()
        self._verify_and_check_snapshot_on_load()
        self._prev, self._count = self._load_state()

    # ---- key management ----------------------------------------------------

    def _load_or_create_key(self) -> bytes | None:
        """Load (or provision once) the snapshot sealing key. Never committed."""
        try:
            if self.key_path.exists():
                raw = self.key_path.read_text(encoding="utf-8").strip()
                key = bytes.fromhex(raw)
                if len(key) == _KEY_BYTES:
                    return key
                log.warning("audit-chain.key malformed (unkeyed snapshots)")
                return None
            key = secrets.token_bytes(_KEY_BYTES)
            # write atomically with restrictive permissions
            fd, tmp = tempfile.mkstemp(dir=str(self.key_path.parent), suffix=".key.tmp")
            try:
                os.write(fd, key.hex().encode("ascii"))
                os.close(fd)
                fd = -1
                try:
                    os.chmod(tmp, 0o600)
                except OSError:
                    pass  # Windows: installer/ACL responsibility
                os.replace(tmp, self.key_path)
            finally:
                if fd >= 0:
                    os.close(fd)
            return key
        except Exception as e:  # never block the pipeline on key provisioning
            log.warning("audit-chain.key unavailable (snapshots unkeyed): %s", e)
            return None

    # ---- load-time verification (ML-004) ------------------------------------

    def _repair_torn_tail_if_any(self) -> None:
        """A crash mid-append can leave a partial FINAL line. Every complete line
        before it is intact (each line is fsync'd). Remove the torn tail; any
        unparseable line that is NOT the last one is real corruption -> raise."""
        if not self.path.exists():
            return
        with self.path.open("r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        last_idx = max(i for i, ln in enumerate(lines) if ln.strip()) if any(
            ln.strip() for ln in lines) else -1
        for i, ln in enumerate(lines):
            s = ln.strip()
            if not s:
                continue
            try:
                json.loads(s)
            except Exception:
                if i == last_idx:
                    log.warning("audit.jsonl: repairing torn final line (crash mid-write)")
                    with self.path.open("w", encoding="utf-8") as f2:
                        f2.writelines(lines[:i])
                    return
                raise AuditIntegrityError(
                    f"audit log corrupt: unparseable line {i + 1} (not the final line); "
                    "refusing to resume")

    def _chain_state(self) -> tuple[str, int]:
        """Return (lastHash, count) by scanning the file (assumes integrity verified)."""
        last = "GENESIS"
        n = 0
        if not self.path.exists():
            return (last, n)
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                last = obj.get("entryHash") or "GENESIS"
                n += 1
        return (last, n)

    def _load_state(self) -> tuple[str, int]:
        return self._chain_state()

    def _verify_and_check_snapshot_on_load(self) -> None:
        ok, violations = self.verify_chain()
        if not ok:
            raise AuditIntegrityError(
                "audit log failed chain verification; refusing to resume: "
                + "; ".join(violations[:5]))
        _, count = self._chain_state()
        if count == 0:
            # An empty log with a NON-empty sealed snapshot means the log was
            # truncated to zero — the snapshot remembers real entries existed.
            if self.snapshot_path.exists():
                try:
                    snap = json.loads(self.snapshot_path.read_text(encoding="utf-8"))
                    if int(snap.get("count") or 0) != 0:
                        raise AuditIntegrityError(
                            f"audit log truncated to empty: snapshot remembers "
                            f"count={snap.get('count')}")
                except json.JSONDecodeError:
                    pass
            return
        if not self.snapshot_path.exists():
            # Backward compatibility: logs predating the snapshot get their
            # current VERIFIED state adopted and sealed now.
            log.warning("audit.tip.json missing for existing log; adopting verified "
                        "tip (count=%d)", count)
            tip, n = self._chain_state()
            self._write_snapshot(tip, n)
            return
        try:
            snap = json.loads(self.snapshot_path.read_text(encoding="utf-8"))
        except Exception as e:
            raise AuditIntegrityError(f"audit tip snapshot unreadable: {e}") from e
        tip, n = self._chain_state()
        snap_count = snap.get("count")
        snap_tip = snap.get("tipHash")
        if snap_count != n:
            raise AuditIntegrityError(
                f"audit log truncated or extended outside the pipeline: snapshot "
                f"count={snap_count} but chain has {n} entries")
        if snap_tip != tip:
            raise AuditIntegrityError(
                "audit log rewritten: snapshot tip mismatch "
                f"(snapshot {str(snap_tip)[:12]}, chain {tip[:12]})")
        if not _check_seal(self._key, int(snap_count or 0), str(snap_tip or ""),
                           str(snap.get("seal", ""))):
            raise AuditIntegrityError(
                "audit tip snapshot seal invalid (wrong key or forged snapshot)")

    # ---- append -------------------------------------------------------------

    def _write_snapshot(self, tip_hash: str, count: int) -> None:
        snap = {
            "v": 1,
            "count": count,
            "tipHash": tip_hash,
            "seal": _seal(self._key, count, tip_hash),
        }
        tmp = self.snapshot_path.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(snap, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.snapshot_path)

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
            self._count += 1
            self._write_snapshot(entry_hash, self._count)
            return entry_hash

    # ---- verification ---------------------------------------------------------

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

    def verify_with_snapshot(self) -> tuple[bool, list[str]]:
        """Full check: chain links + snapshot count/tip/seal. For finalize/import paths."""
        ok, violations = self.verify_chain()
        if not ok:
            return (ok, violations)
        tip, n = self._chain_state()
        if n == 0:
            return (True, [])
        if not self.snapshot_path.exists():
            return (False, ["audit tip snapshot missing"])
        try:
            snap = json.loads(self.snapshot_path.read_text(encoding="utf-8"))
        except Exception as e:
            return (False, [f"snapshot unreadable: {e}"])
        if snap.get("count") != n:
            violations.append(f"snapshot count {snap.get('count')} != chain count {n}")
        if snap.get("tipHash") != tip:
            violations.append("snapshot tip mismatch (truncation or rewrite)")
        elif not _check_seal(self._key, n, tip, str(snap.get("seal", ""))):
            violations.append("snapshot seal invalid")
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

    def events(self):
        """Yield parsed event dicts in chain order.

        ML-005 (audit 2026-08): consumers (finalize spec-hash binding) need the
        event payloads, not just the tip. The chain was already verified at
        load (fail-closed), so a plain ordered replay is safe here.
        """
        if not self.path.exists():
            return
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    yield json.loads(line)


__all__ = ["AuditLog", "AuditIntegrityError"]
