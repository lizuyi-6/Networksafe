"""Usage logger: mirrors v0.3 pipeline LLM token usage into the local OpenCode
session DB so `npx @vibe-cafe/vibe-usage` (opencode parser) can detect and cost it.

WHY: vibe-usage's opencode parser reads ~/.local/share/opencode/opencode.db (hardcoded
path, no --extra-home override, no custom-parser plugin API). Our pipeline calls OpenCode
Zen via the OpenAI SDK directly, so it leaves no trace there. To make vibe-usage see our
token usage, we INSERT rows in the exact schema the parser queries (table `message`,
data JSON with $.role / $.time.created / $.modelID / $.tokens / $.path.root).

SAFETY (user explicitly accepted the risk; we minimize it):
- Only INSERT, never UPDATE/DELETE real rows.
- Isolated namespace: project=prj_aev03, session=ses_aev03 -- distinct, cleanable, won't
  collide with real opencode sessions (which use ses_<random> ids).
- Background writer thread + bounded queue: async pipeline code never blocks on SQLite;
  our own writes serialize (no self-contention).
- busy_timeout=10s: if the live OpenCode CLI holds the write lock, we wait rather than fail.
- Fail-open: ANY DB error -> drop the record + log a warning; NEVER breaks the pipeline.
- Env-gated: active only if ARK_USAGE_LOG_OPENCODE_DB is set (path, or "1" for default
  ~/.local/share/opencode/opencode.db). Unset -> complete no-op (logger stays None).

CAVEAT: past usage (calls before this instrumentation was added) is NOT backfilled -- only
calls after activation are tracked. The 31,659 accepts already generated are not costed here.

Cleanup (remove our rows later, if desired):
    DELETE FROM message WHERE session_id = 'ses_aev03';
    DELETE FROM session WHERE id = 'ses_aev03';
    DELETE FROM project WHERE id = 'prj_aev03';
"""
from __future__ import annotations

import json
import logging
import os
import queue
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger("v03.usage_logger")

_DEFAULT_DB = str(Path.home() / ".local" / "share" / "opencode" / "opencode.db")
_PROJECT_ID = "prj_aev03"
_SESSION_ID = "ses_aev03"
# SECURITY FIX (audit 2026-08, ML-007): was a hardcoded "X:/repos/Networksafe" machine
# path; derive from this file's location (ml/data_pipeline/v03/ -> repo root).
_PROJECT_ROOT = Path(__file__).resolve().parents[3].as_posix()
_AGENT = "aetherargus-v03"

_SHUTDOWN = object()  # queue sentinel


class UsageLogger:
    """Singleton background writer that mirrors LLM usage into opencode.db."""

    _instance: "Optional[UsageLogger]" = None
    _init_lock = threading.Lock()

    @classmethod
    def instance(cls) -> "Optional[UsageLogger]":
        with cls._init_lock:
            return cls._instance

    @classmethod
    def initialize(cls, db_path: str) -> "Optional[UsageLogger]":
        with cls._init_lock:
            if cls._instance is not None:
                return cls._instance
            try:
                inst = cls(db_path)
                inst._start()
                cls._instance = inst
                log.info("UsageLogger active -> %s (project=%s session=%s)",
                         db_path, _PROJECT_ID, _SESSION_ID)
                return inst
            except Exception as e:
                log.warning("UsageLogger initialize failed (disabled): %s", e)
                return None

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._q: "queue.Queue[Any]" = queue.Queue(maxsize=100_000)
        self._thread: Optional[threading.Thread] = None
        self._stopped = False
        self._counter = 0
        self._counter_lock = threading.Lock()

    def _start(self):
        self._thread = threading.Thread(target=self._run, name="v03-usage-writer", daemon=True)
        self._thread.start()

    def log(self, *, role: str, model: str, usage: dict, latency: float) -> None:
        """Enqueue one usage record (non-blocking; drops if queue full). Thread-safe."""
        if self._stopped:
            return
        try:
            with self._counter_lock:
                self._counter += 1
                seq = self._counter
            now_ms = int(time.time() * 1000)
            prompt = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
            completion = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
            # OpenAI SDK nests cache/reasoning under *_tokens_details; deepseek may not populate them
            ptd = usage.get("prompt_tokens_details") or {}
            cached = int((ptd or {}).get("cached_tokens") or 0) if isinstance(ptd, dict) else 0
            ctd = usage.get("completion_tokens_details") or {}
            reasoning = int((ctd or {}).get("reasoning_tokens") or 0) if isinstance(ctd, dict) else 0
            tokens = {
                "total": prompt + completion,
                "input": prompt,
                "output": completion,
                "reasoning": reasoning,
                "cache": {"read": cached, "write": 0},
            }
            data = {
                "role": "assistant",
                "time": {"created": now_ms, "completed": now_ms + int(latency * 1000)},
                "modelID": model,
                "providerID": "opencode",
                "agent": _AGENT,
                "path": {"root": _PROJECT_ROOT},
                "tokens": tokens,
                "cost": 0,
                "finish": "stop",
                "_aetherargus_role": role,  # stash pipeline role for our own debugging
            }
            self._q.put_nowait((seq, data, now_ms))
        except queue.Full:
            log.warning("UsageLogger queue full; dropping usage record")
        except Exception as e:
            log.warning("UsageLogger log() error (dropping record): %s", e)

    def _run(self) -> None:
        con: Optional[sqlite3.Connection] = None
        try:
            con = sqlite3.connect(self.db_path, timeout=10.0, isolation_level=None)  # autocommit
            con.execute("PRAGMA busy_timeout=10000")
            self._ensure_project_session(con)
            while True:
                item = self._q.get()
                if item is _SHUTDOWN:
                    break
                seq, data, now_ms = item
                try:
                    self._insert_message(con, seq, data, now_ms)
                except Exception as e:
                    log.warning("UsageLogger insert failed (dropping): %s", e)
        except Exception as e:
            log.warning("UsageLogger writer thread fatal (disabled for rest of run): %s", e)
        finally:
            if con:
                try:
                    con.close()
                except Exception:
                    pass

    def _ensure_project_session(self, con: sqlite3.Connection) -> None:
        now_ms = int(time.time() * 1000)
        if not con.execute("SELECT 1 FROM project WHERE id=?", (_PROJECT_ID,)).fetchone():
            con.execute(
                "INSERT INTO project(id, worktree, vcs, name, time_created, time_updated, sandboxes) "
                "VALUES(?, ?, NULL, ?, ?, ?, '[]')",
                (_PROJECT_ID, _PROJECT_ROOT, _AGENT, now_ms, now_ms),
            )
        if not con.execute("SELECT 1 FROM session WHERE id=?", (_SESSION_ID,)).fetchone():
            con.execute(
                "INSERT INTO session(id, project_id, parent_id, slug, directory, title, version, "
                "time_created, time_updated) VALUES(?, ?, NULL, ?, ?, ?, '1', ?, ?)",
                (_SESSION_ID, _PROJECT_ID, _AGENT, _PROJECT_ROOT,
                 "AetherArgus v0.3 dataset generation", now_ms, now_ms),
            )

    def _insert_message(self, con: sqlite3.Connection, seq: int, data: dict, now_ms: int) -> None:
        msg_id = f"msg_aev03_{seq:010d}"
        con.execute(
            "INSERT INTO message(id, session_id, time_created, time_updated, data) "
            "VALUES(?, ?, ?, ?, ?)",
            (msg_id, _SESSION_ID, now_ms, now_ms, json.dumps(data)),
        )

    def stop(self) -> None:
        self._stopped = True
        try:
            self._q.put_nowait(_SHUTDOWN)
        except Exception:
            pass
        if self._thread:
            self._thread.join(timeout=5)


def init_from_env() -> "Optional[UsageLogger]":
    """Initialize the singleton from ARK_USAGE_LOG_OPENCODE_DB env. No-op if unset."""
    val = os.environ.get("ARK_USAGE_LOG_OPENCODE_DB", "").strip()
    if not val:
        return None
    db_path = _DEFAULT_DB if val.lower() in ("1", "true", "yes", "on", "default") else val
    if not os.path.exists(db_path):
        log.warning("ARK_USAGE_LOG_OPENCODE_DB set but db not found: %s (disabled)", db_path)
        return None
    return UsageLogger.initialize(db_path)
