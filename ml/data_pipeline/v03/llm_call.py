"""Shared LLM helpers: prompt loading + lenient JSON parsing.

Prompts are loaded once and cached. JSON parsing tolerates markdown fences and surrounding
prose (LLMs occasionally wrap output despite instructions) but always returns a complete
top-level object or None.
"""
from __future__ import annotations
import json
from . import config

_PROMPT_CACHE: dict[str, str] = {}


def load_prompt(name: str) -> str:
    """Load and cache a prompt .md file from config.PROMPTS_DIR."""
    if name not in _PROMPT_CACHE:
        path = config.PROMPTS_DIR / name
        _PROMPT_CACHE[name] = path.read_text(encoding="utf-8")
    return _PROMPT_CACHE[name]


def parse_json_lenient(text: str) -> dict | None:
    """Parse a JSON object from LLM output, tolerating fences/prose. Returns dict or None."""
    if not text:
        return None
    text = text.strip()
    # strip markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    # direct parse
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except Exception:
        pass
    # brace-match the outermost object
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start:i + 1]
                    try:
                        obj = json.loads(candidate)
                        return obj if isinstance(obj, dict) else None
                    except Exception:
                        return None
    return None


__all__ = ["load_prompt", "parse_json_lenient"]
