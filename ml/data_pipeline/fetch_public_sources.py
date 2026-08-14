#!/usr/bin/env python3
"""Fetch checksum-pinned, license-approved public source artifacts into an ignored cache."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import urllib.request
from pathlib import Path
from typing import Any

import yaml

from common import common_parser, emit_log, load_config, repository_root, resolve_path, write_json


USER_AGENT = "AetherArgus-public-data-pipeline/0.2"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_registry(root: Path, config: dict[str, Any]) -> dict[str, Any]:
    registry_path = resolve_path(root, config["public_sources"]["registry"])
    with registry_path.open("r", encoding="utf-8") as handle:
        registry = yaml.safe_load(handle)
    if not isinstance(registry, dict) or not isinstance(registry.get("sources"), list):
        raise ValueError(f"invalid public source registry: {registry_path}")
    return registry


def ensure_within(base: Path, candidate: Path) -> Path:
    """SECURITY FIX (audit 2026-08, ML-008): containment check per AGENTS.md §1.

    The registry is version-controlled and trusted, but the cachePath is data we
    join into a filesystem path — hold it to the same defensive bar as any other
    path join: the resolved target (symlink-aware) must stay inside the resolved
    cache root, with the base compared as `base + sep` so a sibling like
    ``cache-evil`` cannot prefix-match its way out.
    """
    resolved_base = base.resolve()
    resolved_target = candidate.resolve()
    base_prefix = resolved_base.as_posix().rstrip("/") + "/"
    target_posix = resolved_target.as_posix()
    if not target_posix.startswith(base_prefix):
        raise ValueError(
            f"artifact cachePath escapes the cache root: {candidate} -> {resolved_target} "
            f"not within {resolved_base}"
        )
    return resolved_target


def validate_cached_artifact(path: Path, artifact: dict[str, Any]) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(path)
    actual_size = path.stat().st_size
    actual_sha = sha256_file(path)
    expected_size = int(artifact["bytes"])
    expected_sha = str(artifact["sha256"])
    if actual_size != expected_size:
        raise ValueError(f"size mismatch for {path}: expected {expected_size}, got {actual_size}")
    if actual_sha != expected_sha:
        raise ValueError(f"SHA-256 mismatch for {path}: expected {expected_sha}, got {actual_sha}")
    return {"bytes": actual_size, "sha256": actual_sha}


def download_artifact(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    temporary_path: Path | None = None
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                prefix=f".{destination.name}.",
                suffix=".partial",
                dir=destination.parent,
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    temporary.write(block)
        if destination.exists():
            raise FileExistsError(f"refusing to overwrite cached source: {destination}")
        os.replace(temporary_path, destination)
        temporary_path = None
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def fetch_sources(
    root: Path,
    config: dict[str, Any],
    *,
    selected_ids: set[str] | None,
    dry_run: bool,
    resume: bool,
) -> dict[str, Any]:
    registry = load_registry(root, config)
    cache_root = resolve_path(root, config["public_sources"]["cache_dir"])
    accepted = [source for source in registry["sources"] if source.get("status") == "accepted"]
    if selected_ids is not None:
        known_ids = {str(source["id"]) for source in accepted}
        unknown = selected_ids - known_ids
        if unknown:
            raise ValueError(f"unknown or unapproved source ids: {sorted(unknown)}")
        accepted = [source for source in accepted if str(source["id"]) in selected_ids]

    results = []
    for source in accepted:
        source_id = str(source["id"])
        artifact = source["artifact"]
        # ML-008: containment check BEFORE any path is used for I/O.
        target = ensure_within(cache_root, cache_root / str(artifact["cachePath"]))
        if dry_run:
            results.append(
                {
                    "sourceId": source_id,
                    "status": "planned",
                    "target": target.as_posix(),
                    "url": artifact["url"],
                    "expectedSha256": artifact["sha256"],
                }
            )
            emit_log("public_source_fetch_planned", sourceId=source_id, target=target.as_posix())
            continue
        if target.exists():
            if not resume:
                raise FileExistsError(
                    f"cached artifact exists; pass --resume to verify and reuse it: {target}"
                )
            verified = validate_cached_artifact(target, artifact)
            status = "reused"
        else:
            emit_log("public_source_download_started", sourceId=source_id, url=artifact["url"])
            download_artifact(str(artifact["url"]), target)
            verified = validate_cached_artifact(target, artifact)
            status = "downloaded"
        result = {
            "sourceId": source_id,
            "status": "verified",
            "path": target.relative_to(root).as_posix(),
            "revision": source["revision"],
            "license": source["license"],
            **verified,
        }
        results.append(result)
        emit_log("public_source_fetch_complete", cacheAction=status, **result)

    manifest = {
        "schemaVersion": 1,
        "registryVersion": registry["registryVersion"],
        "registryReviewedAt": registry["reviewedAt"],
        "acceptedSourceCount": len(results),
        "artifacts": results,
    }
    write_json(
        cache_root / "fetch-manifest.json",
        manifest,
        dry_run=dry_run,
        resume=resume,
    )
    return manifest


def main() -> int:
    parser = common_parser(__doc__ or "Fetch public sources")
    parser.add_argument(
        "--source",
        action="append",
        dest="sources",
        help="Fetch one approved source id; repeat to select more than one.",
    )
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    config = load_config(arguments.config, root)
    fetch_sources(
        root,
        config,
        selected_ids=set(arguments.sources) if arguments.sources else None,
        dry_run=arguments.dry_run,
        resume=arguments.resume,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
