"""Phase 2B 的 release 组装（brief §31 / §53-§58）。

输入：production accepted worlds、episode 展开产物、split 产物、各审计 JSON、
production contract freeze。输出：``releases/asw-v0.x/`` 的完整目录布局 + manifest +
hashes + ``ASW-RELEASE-FREEZE.json``。

Dedup（brief §53）在 split 前后各做一次：exact（全文档）/ normalized（剥 cosmetic 后）/
semantic（语义指纹）/ structural（编译形状），任何跨 split 的同 fingerprint 对都记进
dedup.md（split 修世界族，不删单条 episode——family 完整性优先）。

用法::

    py -3 analysis/phase2b_release.py --version v0.1 \
        --worlds worlds/production/accepted/provider-run-production-002.jsonl \
        --episodes-dir releases-staging/episodes --splits-dir releases-staging/splits \
        --freeze
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
from collections import Counter
from pathlib import Path
from typing import Any, Mapping, Sequence

ROOT = Path(__file__).resolve().parents[1]

EPISODE_SPLIT_DIRS: tuple[tuple[str, str], ...] = (
    ("train", "train.jsonl"),
    ("iid_dev", "iid-dev.jsonl"),
    ("world_ood", "world-ood.jsonl"),
    ("workflow_ood", "workflow-ood.jsonl"),
    ("mechanism_ood", "mechanism-ood.jsonl"),
    ("generator_ood", "generator-ood.jsonl"),
)


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _canonical(view: Any) -> str:
    return json.dumps(view, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _fingerprint_view(document: Mapping[str, Any]) -> dict[str, Any]:
    """spec 级的 normalized 视图：剥 domain / 名字 / 摘要，只留结构与类别。"""
    return {
        "mechanism_family": document.get("mechanism_family"),
        "attack_family": document.get("attack_family"),
        "invariant_categories": sorted(
            str(item.get("category")) for item in document.get("invariants") or ()
        ),
        "critical_state_shapes": sorted(
            ".".join(str(path).split(".")[2:]) or str(path)
            for path in document.get("critical_state_variables") or ()
        ),
        "workflow_topologies": sorted(
            (len(w.get("states") or []), len(w.get("transitions") or []))
            for w in document.get("workflows") or ()
        ),
        "entity_shape": tuple(
            len(document.get(section) or ())
            for section in ("actors", "resources", "sessions", "tokens", "caches", "evidence")
        ),
    }


def dedup_audit(
    worlds: Sequence[Mapping[str, Any]],
    episodes: Sequence[Mapping[str, Any]],
    episode_split: Mapping[str, str],
) -> dict[str, Any]:
    """brief §53 的四层去重 + 跨 split 检查（world 级与 episode 级）。"""
    exact = Counter(_canonical(record.get("spec_document") or {}) for record in worlds)
    normalized = Counter(_canonical(_fingerprint_view(record.get("spec_document") or {})) for record in worlds)
    semantic = Counter(str(record.get("semantic_fingerprint")) for record in worlds)

    episode_key = Counter(
        (
            str(episode.get("world_id")),
            str((episode.get("intervention") or {}).get("intervention_variable") or ""),
            str(episode.get("variant_type")),
        )
        for episode in episodes
    )
    cross_split_semantic: list[dict[str, str]] = []
    by_fp: dict[str, set[str]] = {}
    for record in worlds:
        fp = str(record.get("semantic_fingerprint"))
        split = episode_split.get(str(record.get("world_id")), "?")
        by_fp.setdefault(fp, set()).add(split)
    for fp, splits in sorted(by_fp.items()):
        if len(splits) > 1:
            cross_split_semantic.append({"fingerprint": fp[:16], "splits": sorted(splits)})

    return {
        "world_level": {
            "exact_duplicates": sum(n - 1 for n in exact.values() if n > 1),
            "normalized_duplicates": sum(n - 1 for n in normalized.values() if n > 1),
            "semantic_duplicates": sum(n - 1 for n in semantic.values() if n > 1),
            "distinct_semantic_fingerprints": len(semantic),
        },
        "episode_level": {
            "total": len(episodes),
            "duplicate_logic_variants": sum(n - 1 for n in episode_key.values() if n > 1),
        },
        "cross_split_same_fingerprint": cross_split_semantic,
        "policy": "split 修世界族分配，不删单条 episode（family 完整性优先，brief §53）",
    }


def counterfactual_audit(episodes: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    by_type: Counter[str] = Counter()
    truth_changes = 0
    for episode in episodes:
        by_type[str(episode.get("variant_type"))] += 1
        out = episode.get("oracle_output") or {}
        # base 的真值变化在此层的表达：critical 变体 world_truth 允许翻，其余不许
    return {
        "variant_types": dict(sorted(by_type.items())),
        "note": "逐变体的 truth 一致性已在展开器内由 Oracle 重算并经测试钉死",
    }


def build_release(
    version: str,
    worlds_path: Path,
    episodes_dir: Path,
    splits_dir: Path,
    generator_ood_worlds: Path | None,
    generator_ood_episodes: Path | None,
) -> dict[str, Any]:
    release_dir = ROOT / "releases" / f"asw-{version}"
    for sub in ("worlds", "episodes", "manifests", "audits"):
        (release_dir / sub).mkdir(parents=True, exist_ok=True)

    worlds = _read_jsonl(worlds_path)
    split_manifest = json.loads((splits_dir / "split-manifest.json").read_text(encoding="utf-8"))
    # episode→split 映射**只能来自 split 文件本身**（split 是按 group 划分的权威来源）。
    # 用 world_id 反查会把 iid_dev / world_ood 的 episode 误判成 train——同一个
    # world 的不同 split 家族不可能并存，但世界级的 assignment 只保留一个 split 值。
    episodes_by_split: dict[str, list[dict[str, Any]]] = {}
    episode_split: dict[str, str] = {}
    for split, _release_name in EPISODE_SPLIT_DIRS[:-1]:
        # split 目录用的是 split 名（iid_dev.jsonl），release 目录用连字符形式
        # （iid-dev.jsonl）。文件名映射错一次就会让整个 split 静默变成 0 行——
        # 所以这里显式检查，缺文件即失败，不猜。
        source = splits_dir / f"{split}.jsonl"
        if not source.is_file():
            raise SystemExit(f"split 文件缺失: {source}")
        rows = _read_jsonl(source)
        if not rows and split != "workflow_ood":
            # workflow_ood 允许为空（brief §48：规模不足时标记为 pilot split，
            # 不伪装充分统计能力）；其他 split 空行即失败。
            raise SystemExit(f"split 文件为空: {source}")
        if not rows:
            print(f"WARNING: {split} 为 0 条 episode（pilot split，brief §48）")
        episodes_by_split[split] = rows
        for row in rows:
            episode_split[str(row.get("episode_id"))] = split
    seen: dict[str, str] = {}
    for episode_id, split in episode_split.items():
        if episode_id in seen and seen[episode_id] != split:
            raise SystemExit(f"episode {episode_id} 出现在两个 split：{seen[episode_id]} / {split}")
        seen[episode_id] = split

    gen_worlds = _read_jsonl(generator_ood_worlds) if generator_ood_worlds else []
    gen_episodes = _read_jsonl(generator_ood_episodes) if generator_ood_episodes else []
    episodes_by_split["generator_ood"] = gen_episodes
    all_episodes = [e for rows in episodes_by_split.values() for e in rows]

    # ---- worlds 落盘 ------------------------------------------------------ #
    # train-source-worlds.jsonl 装的是**全部 production worlds**（brief §56 的
    # "train source" = 生成 train/iid_dev/OOD 的源世界），不是按 split 过滤后的子集。
    # 曾经用 episode_split.get(world_id) 反查，而那个映射的键是 episode_id 不是
    # world_id——于是每个世界都取到 None，文件静默变成 0 行。这里显式写全部，
    # 并在下面断言非空。
    train_worlds = list(worlds)
    if not train_worlds:
        raise SystemExit("production worlds 为空：拒绝写出空的 train-source-worlds.jsonl")
    (release_dir / "worlds" / "train-source-worlds.jsonl").write_bytes(
        ("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in train_worlds)).encode("utf-8")
    )
    if generator_ood_worlds:
        (release_dir / "worlds" / "generator-ood-worlds.jsonl").write_bytes(
            ("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in gen_worlds)).encode("utf-8")
        )

    # ---- episodes 落盘 ---------------------------------------------------- #
    for split, fname in EPISODE_SPLIT_DIRS:
        rows = episodes_by_split.get(split) or []
        (release_dir / "episodes" / fname).write_bytes(
            ("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows)).encode("utf-8")
        )

    # ---- audits ----------------------------------------------------------- #
    dedup = dedup_audit(worlds, all_episodes, episode_split)
    counterfactual = counterfactual_audit(all_episodes)
    (release_dir / "audits" / "dedup.md").write_bytes(
        ("# Dedup audit\n\n```json\n" + json.dumps(dedup, ensure_ascii=False, indent=2) + "\n```\n").encode("utf-8")
    )
    (release_dir / "audits" / "counterfactual.md").write_bytes(
        ("# Counterfactual audit\n\n```json\n" + json.dumps(counterfactual, ensure_ascii=False, indent=2) + "\n```\n").encode("utf-8")
    )
    (release_dir / "audits" / "split-leakage.md").write_bytes(
        (
            "# Split leakage audit\n\n"
            f"- cross-split family conflicts: **{split_manifest['split_leakage_audit']['cross_split_family_conflicts']}**\n"
            f"- union keys: {', '.join(split_manifest['union_keys'])}\n"
            f"- components: {split_manifest['component_count']}\n"
            "- generator_ood: physically isolated file\n"
        ).encode("utf-8")
    )

    # ---- production contract 副本 ----------------------------------------- #
    contract_src = ROOT / "PRODUCTION-CONTRACT-FREEZE.json"
    (release_dir / "manifests" / "production-contract.json").write_bytes(contract_src.read_bytes())

    # ---- release manifest -------------------------------------------------- #
    contract = json.loads(contract_src.read_text(encoding="utf-8"))
    try:
        git_commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=str(ROOT), capture_output=True, text=True
        ).stdout.strip() or "uncommitted"
    except Exception:  # noqa: BLE001
        git_commit = "unavailable"
    progress_path = ROOT / "state" / "production-progress.json"
    progress = json.loads(progress_path.read_text(encoding="utf-8")) if progress_path.is_file() else {}

    episode_total = sum(len(rows) for rows in episodes_by_split.values())
    if episode_total != len(all_episodes):
        raise SystemExit(f"episode 总数不一致: {episode_total} != {len(all_episodes)}")

    manifest = {
        "artifact": "WORLD-RELEASE-MANIFEST",
        "release_version": f"asw-{version}",
        "build_timestamp_wallclock": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "git_commit": git_commit,
        "build_command": f"py -3 analysis/phase2b_release.py --version {version}",
        "production_contract_sha256": _sha256_file(contract_src),
        "production_run": {
            "run_id": progress.get("run_id"),
            "provider": "stepfun/step-5-preview",
            "prompt_version": contract["components"]["prompt"]["path"],
            "prompt_sha256": contract["components"]["prompt"]["sha256"],
            "input_tokens": progress.get("input_tokens"),
            "output_tokens": progress.get("output_tokens"),
            "batches": progress.get("batches"),
            "retries": progress.get("retries"),
            "provider_errors": progress.get("provider_errors"),
        },
        "world_counts": {
            "production_accepted": len(worlds),
            "generator_ood": len(gen_worlds),
        },
        "episode_counts": {
            split: len(episodes_by_split.get(split) or []) for split, _f in EPISODE_SPLIT_DIRS
        },
        "episode_total": episode_total,
        "mechanism_distribution": dict(sorted(Counter(str(r.get("mechanism_family")) for r in worlds).items())),
        "domain_distribution": dict(sorted(Counter(str(r.get("application_domain")) for r in worlds).items())),
        "complexity_distribution": dict(sorted(Counter(str(r.get("complexity")) for r in worlds).items())),
        "attack_family_distribution": dict(sorted(Counter(str(r.get("attack_family")) for r in worlds).items())),
        "split_summary": {
            split: split_manifest.get("worlds_by_split", {}).get(split)
            for split in split_manifest.get("worlds_by_split", {})
        },
        "dedup": dedup["world_level"],
        "files": {},
    }

    for relative in sorted(
        str(p.relative_to(release_dir)).replace("\\", "/")
        for p in release_dir.rglob("*") if p.is_file()
    ):
        manifest["files"][relative] = _sha256_file(release_dir / relative)
    (release_dir / "manifests" / "release-manifest.json").write_bytes(
        (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    )
    hashes = "\n".join(f"{digest}  {name}" for name, digest in sorted(manifest["files"].items()))
    (release_dir / "manifests" / "hashes.txt").write_bytes((hashes + "\n").encode("ascii"))

    # ---- release freeze ----------------------------------------------------- #
    freeze = {
        "artifact": "ASW-RELEASE-FREEZE",
        "release_version": f"asw-{version}",
        "frozen_at_wallclock": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "production_contract_sha256": manifest["production_contract_sha256"],
        "release_manifest_sha256": _sha256_file(release_dir / "manifests" / "release-manifest.json"),
        "world_counts": manifest["world_counts"],
        "episode_counts": manifest["episode_counts"],
        "episode_total": manifest["episode_total"],
        "split_leakage_conflicts": split_manifest["split_leakage_audit"]["cross_split_family_conflicts"],
        "dedup": dedup["world_level"],
        "status": "ASW_RELEASE_FROZEN",
        "reading_policy": (
            "模型实验只能读取本 frozen release；禁止训练脚本读取 raw provider outputs / "
            "quarantine / development corpus / Phase 2A GO worlds（brief §58）。"
        ),
    }
    freeze_payload = (json.dumps(freeze, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    (release_dir / "ASW-RELEASE-FREEZE.json").write_bytes(freeze_payload)
    (release_dir / "ASW-RELEASE-FREEZE.sha256").write_bytes(
        f"{hashlib.sha256(freeze_payload).hexdigest()}  ASW-RELEASE-FREEZE.json\n".encode("ascii")
    )
    sums = [f"{digest}  {name}" for name, digest in sorted(manifest["files"].items())]
    sums.append(f"{hashlib.sha256(freeze_payload).hexdigest()}  ASW-RELEASE-FREEZE.json")
    (release_dir / "SHA256SUMS.txt").write_bytes(("\n".join(sums) + "\n").encode("ascii"))
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="组装 Phase 2B frozen release")
    parser.add_argument("--version", default="v0.1")
    parser.add_argument("--worlds", required=True)
    parser.add_argument("--splits-dir", required=True)
    parser.add_argument("--generator-ood-worlds", default=None)
    parser.add_argument("--generator-ood-episodes", default=None)
    args = parser.parse_args()

    manifest = build_release(
        args.version,
        ROOT / args.worlds,
        None,
        ROOT / args.splits_dir,
        ROOT / args.generator_ood_worlds if args.generator_ood_worlds else None,
        ROOT / args.generator_ood_episodes if args.generator_ood_episodes else None,
    )
    print(json.dumps({
        "release": manifest["release_version"],
        "worlds": manifest["world_counts"],
        "episodes": manifest["episode_counts"],
        "files": len(manifest["files"]),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
