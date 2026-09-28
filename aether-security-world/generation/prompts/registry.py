"""Prompt version management for the Step-5-pre world seed generator.

Design §11.1: "输出必须是严格 JSON array（或 JSONL，在 prompt_version 里钉死），每个元素是一个
WorldSpec" — the *output frame* is pinned by the prompt version, not chosen by the caller.
That is what makes a recorded generation replayable: given a `prompt_version` the parser
knows whether it must decode a JSON array or JSONL, and given `prompt_hash` it knows
exactly which prompt text produced the bytes.

A prompt file (``generation/prompts/v<version>.md``) is::

    # prompt_version: 0.1
    # output_format: json_array
    # schema_contract: world-spec.schema.json
    # default_batch_size: 8
    # max_output_tokens: 8192

    <prompt body — the text actually sent to the model>

Header rules (strict, on purpose):

* the header is the leading run of ``# key: value`` lines; the first line that is not
  such a comment ends it;
* ``prompt_version`` and ``output_format`` are required, unknown keys are an error
  (a silently ignored header key is how a prompt and its parser drift apart);
* the file stem must equal ``v<prompt_version>``, and the requested version must equal
  the declared one — a mismatch is a hard error, never a fallback;
* ``prompt_hash`` is sha256 of the **body** (the bytes after the header), because the
  body is what is sent to the model. It is computed here, never read from the file, so
  the hash cannot disagree with the text it claims to describe.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent
#: ``aether-security-world/`` — the project root that owns ``configs/`` and ``schemas/``.
PROJECT_ROOT = Path(__file__).resolve().parents[2]

#: Output frame declared by prompt v0.1. Design §11.1 allows "严格 JSON array（或 JSONL，
#: 在 prompt_version 里钉死）"; v0.1 pins the strict JSON array.
DEFAULT_PROMPT_VERSION = "0.1"

OUTPUT_FORMATS = ("json_array", "jsonl")

_HEADER_LINE = re.compile(r"^#\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$")
_REQUIRED_HEADER_KEYS = ("prompt_version", "output_format")
_KNOWN_HEADER_KEYS = _REQUIRED_HEADER_KEYS + ("schema_contract", "default_batch_size", "max_output_tokens")


class PromptFormatError(ValueError):
    """A prompt file is malformed (bad header, unknown key, version/filename mismatch)."""


class UnknownPromptVersion(ValueError):
    """No registered prompt carries this version, so its output contract is unknown."""


@dataclass(frozen=True)
class PromptSpec:
    """One registered generator prompt: what to send, and what to expect back."""

    version: str
    path: Path
    output_format: str
    text: str
    prompt_hash: str
    schema_contract: str
    default_batch_size: int
    max_output_tokens: int

    def to_document(self) -> dict:
        return {
            "prompt_version": self.version,
            "prompt_hash": self.prompt_hash,
            "output_format": self.output_format,
            "schema_contract": self.schema_contract,
            "default_batch_size": self.default_batch_size,
            "max_output_tokens": self.max_output_tokens,
        }


def _parse_prompt_file(path: Path) -> PromptSpec:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:  # unreadable prompt is a hard error, never an empty prompt
        raise PromptFormatError(f"cannot read prompt file {path}: {exc}") from exc

    lines = raw.splitlines()
    header: dict[str, str] = {}
    body_start = 0
    for index, line in enumerate(lines):
        match = _HEADER_LINE.match(line)
        if match is None:
            body_start = index
            break
        key, value = match.group(1), match.group(2)
        if key in header:
            raise PromptFormatError(f"{path.name}: duplicate header key '{key}'")
        header[key] = value
    else:  # pragma: no cover - a header-only file has no prompt body at all
        body_start = len(lines)

    unknown = sorted(set(header) - set(_KNOWN_HEADER_KEYS))
    if unknown:
        raise PromptFormatError(f"{path.name}: unknown header key(s) {unknown}; known: {sorted(_KNOWN_HEADER_KEYS)}")
    missing = [key for key in _REQUIRED_HEADER_KEYS if not header.get(key)]
    if missing:
        raise PromptFormatError(f"{path.name}: missing required header key(s) {missing}")

    version = header["prompt_version"]
    if path.stem != f"v{version}":
        raise PromptFormatError(
            f"{path.name}: filename stem must be 'v{version}' to match the declared prompt_version"
        )
    output_format = header["output_format"]
    if output_format not in OUTPUT_FORMATS:
        raise PromptFormatError(
            f"{path.name}: output_format '{output_format}' is not one of {list(OUTPUT_FORMATS)}"
        )

    body = "\n".join(lines[body_start:])
    return PromptSpec(
        version=version,
        path=path,
        output_format=output_format,
        text=body,
        prompt_hash=hashlib.sha256(body.encode("utf-8")).hexdigest(),
        schema_contract=header.get("schema_contract", "world-spec.schema.json"),
        default_batch_size=int(header.get("default_batch_size", "8")),
        max_output_tokens=int(header.get("max_output_tokens", "8192")),
    )


def _version_key(version: str) -> tuple[int, ...]:
    """数值版本键：``"0.10"`` 必须排在 ``"0.2"`` 之后（字典序会把它排到前面）。"""
    try:
        return tuple(int(part) for part in version.split("."))
    except ValueError:
        return (0,)


def available_versions(prompts_dir: Path | None = None) -> tuple[str, ...]:
    """Prompt versions that have a registered file, ascending (numeric, not lexicographic)."""
    directory = Path(prompts_dir) if prompts_dir is not None else PROMPTS_DIR
    versions = []
    for path in sorted(directory.glob("v*.md")):
        versions.append(_parse_prompt_file(path).version)
    return tuple(sorted(versions, key=_version_key))


def load_prompt(version: str = DEFAULT_PROMPT_VERSION, *, prompts_dir: Path | None = None) -> PromptSpec:
    """Load one registered prompt. An unregistered version is an error, never a default."""
    directory = Path(prompts_dir) if prompts_dir is not None else PROMPTS_DIR
    path = directory / f"v{version}.md"
    if not path.is_file():
        raise UnknownPromptVersion(
            f"no prompt file for version '{version}' in {directory} "
            f"(registered: {list(available_versions(directory))})"
        )
    spec = _parse_prompt_file(path)
    if spec.version != version:
        raise PromptFormatError(f"{path.name}: declares prompt_version '{spec.version}', requested '{version}'")
    return spec


def output_format_for(version: str, *, prompts_dir: Path | None = None) -> str:
    """The output frame pinned by a prompt version ('json_array' or 'jsonl')."""
    return load_prompt(version, prompts_dir=prompts_dir).output_format


def resolve_prompt_hash(version: str, *, prompts_dir: Path | None = None) -> str:
    """sha256 of the prompt body, for cross-checking a recorded generation."""
    return load_prompt(version, prompts_dir=prompts_dir).prompt_hash


def decoding_defaults(version: str = DEFAULT_PROMPT_VERSION, *, prompts_dir: Path | None = None) -> dict:
    """The decoding parameters the Phase 1 config pins for this prompt version.

    Read from ``configs/default.json``'s ``generation`` block so a live call and its
    replay fixture cannot disagree about temperature/top_p. Missing config keys are
    simply absent — nothing is invented.
    """
    defaults: dict[str, object] = {}
    config_path = PROJECT_ROOT / "configs" / "default.json"
    if config_path.is_file():
        generation = json.loads(config_path.read_text(encoding="utf-8")).get("generation", {})
        defaults = {
            key: generation[key]
            for key in ("temperature", "top_p", "max_output_tokens_per_call")
            if key in generation
        }
    spec = load_prompt(version, prompts_dir=prompts_dir)
    defaults.setdefault("max_output_tokens", spec.max_output_tokens)
    return dict(defaults)


__all__ = [
    "DEFAULT_PROMPT_VERSION",
    "OUTPUT_FORMATS",
    "PROMPTS_DIR",
    "PromptFormatError",
    "PromptSpec",
    "UnknownPromptVersion",
    "available_versions",
    "decoding_defaults",
    "load_prompt",
    "output_format_for",
    "resolve_prompt_hash",
]
