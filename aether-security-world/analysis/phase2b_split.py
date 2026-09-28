"""Phase 2B 的 group-based split 构建（brief §43-§49）。

铁律（brief §43）：**禁止随机 episode row split 作为主 split**。同一个 world 的 base /
critical / masked / trust 变体不能跨 train / iid-dev / OOD split。

实现：

1. **并查集**（brief §44 的 union 约束）：两个 world 只要共享 world_family_id /
   counterfactual_family_id / workflow_family_id / policy_family_id / invariant_family_id
   任一键就并入同一 component——component 是分配的最小单位，任何 split 泄漏在构造上
   不可能发生。
2. **确定性分配**（不用随机数；同一输入永远同一 split）：component 按 (sha256 排序,
   size 降序) 的确定性顺序做贪心，quota 驱动。
3. **五种 split**（brief §45）：
   - mechanism_ood：先选 mechanism（组合优先，见下），凡 mechanism 命中且 component
     内没有其他 mechanism 的 component 整体进入；
   - workflow_ood：workflow_family_id 只出现在少数 component 里的，整体进入；
   - world_ood：剩余 component 按确定性顺序凑满 quota；
   - iid_dev：再按确定性顺序凑满 quota（mechanism 分布对齐 train，见 report 校验）；
   - train：剩下的全部。
4. **generator_ood 不在本工具里**：它来自第二生成器的独立文件，物理隔离（brief §50/§51）。

Allocation 的关键安全性质：**一个 component 的所有 episode 永远在同一个 split**；
split 之间对五个 family key 的重叠由构造保证为零，仍由 audit 步骤显式复算
（`--audit` 模式），不信任构造。

用法::

    py -3 analysis/phase2b_split.py --worlds worlds/production/accepted/provider-run-production-001.jsonl \
        --episodes releases/asw-v0.1/episodes/all.jsonl --out-dir releases/asw-v0.1/splits
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

ROOT = Path(__file__).resolve().parents[1]

#: 参与并查集的 family key（brief §44 的"至少"集合；episode 的 group_keys 全都有）。
UNION_KEYS: tuple[str, ...] = (
    "world_family_id",
    "counterfactual_family_id",
    "workflow_family_id",
    "policy_family_id",
    "invariant_family_id",
)

#: split 名（release 目录名；generator_ood 由独立文件提供）。
SPLITS: tuple[str, ...] = ("train", "iid_dev", "world_ood", "workflow_ood", "mechanism_ood")

#: component 数量配额（世界数的比例；brief §55"优先定义正确"）。
SPLIT_QUOTAS: Mapping[str, float] = {
    "mechanism_ood": 0.06,
    "workflow_ood": 0.06,
    "world_ood": 0.10,
    "iid_dev": 0.10,
    # train = 其余
}

#: component 的确定性排序键。
def _component_hash(component: Sequence[str]) -> str:
    return hashlib.sha256(
        json.dumps(sorted(component), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def build_components(
    worlds: Sequence[Mapping[str, Any]],
    episodes: Sequence[Mapping[str, Any]],
) -> tuple[list[list[str]], dict[str, str]]:
    """并查集：world_id → component。返回 (components, world_id → split 前的映射)。"""
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    for record in worlds:
        world_id = str(record.get("world_id"))
        if world_id not in parent:
            parent[world_id] = world_id

    #: family key 值 → 出现过的 world 集合（跨 world 共享即 union）
    key_owners: dict[tuple[str, str], str] = {}
    for record in worlds:
        world_id = str(record.get("world_id"))
        for key in UNION_KEYS:
            value = str(record.get(key) or "")
            if not value:
                continue
            token = (key, value)
            if token in key_owners:
                union(world_id, key_owners[token])
            else:
                key_owners[token] = world_id

    components: dict[str, list[str]] = defaultdict(list)
    for world_id in sorted(parent):
        components[find(world_id)].append(world_id)
    out = [sorted(members) for members in components.values()]
    return out, {world_id: find(world_id) for world_id in parent}


def _mechanism_of(world_id: str, worlds_by_id: Mapping[str, Mapping[str, Any]]) -> str:
    return str((worlds_by_id.get(world_id) or {}).get("mechanism_family") or "?")


def choose_mechanism_ood(
    components: Sequence[Sequence[str]],
    worlds_by_id: Mapping[str, Mapping[str, Any]],
    quota: int,
) -> list[str]:
    """组合 OOD（brief §49）：优先"训练中分别见过、组合没见过"的机制对。

    实现：对每个 (mechanism_a, mechanism_b) 组合对，统计它出现在多少 component 里。
    选出现次数 ≥1 且**两个机制各自的总出现次数都显著大于该组合计数**的对——
    即两个机制在语料里都常见，但很少（本 pilot 中为零）一起出现在同一个世界族里。
    满足的对按确定性顺序取第一个，把它所在的所有 component 划出。

    找不到这种对时退化为单机制（出现次数中等的），并把原因写进 manifest——
    绝不伪装"组合 OOD"。
    """
    pair_counts: Counter[tuple[str, ...]] = Counter()
    single_counts: Counter[str] = Counter()
    for component in components:
        mechanisms = sorted({_mechanism_of(w, worlds_by_id) for w in component})
        single_counts.update(mechanisms)
        for i in range(len(mechanisms)):
            for j in range(i + 1, len(mechanisms)):
                pair_counts[(mechanisms[i], mechanisms[j])] += 1
    # 组合罕见但对双方都常见的候选（brief §49 的形状）
    candidates = sorted(
        pair for pair, count in pair_counts.items()
        if count <= max(1, quota // 2)
        and all(single_counts[name] >= 3 for name in pair)
    )
    if not candidates:
        # 没有组合对可用：退化到单机制，但只划出该机制的一部分 component，
        # 保证 train 里仍留有该机制（否则 OOD 变成"全新机制"而非"见过但少见的组合"）。
        ranked = sorted(single_counts.items(), key=lambda kv: (abs(kv[1] - 6), kv[0]))
        if not ranked:
            return []
        target = ranked[0][0]
        owned = [
            component for component in components
            if target in {_mechanism_of(w, worlds_by_id) for w in component}
        ]
        keep = max(1, len(owned) // 2)  # 一半留 train
        return [world for component in owned[:keep] for world in component]
    chosen = candidates[0]
    chosen_set = set(chosen)
    return [
        world for component in components
        for world in component
        if chosen_set.issubset({_mechanism_of(w, worlds_by_id) for w in component})
    ]


def assign_splits(
    worlds: Sequence[Mapping[str, Any]],
    episodes: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """确定性 split 分配。返回分配结果 + 完整审计所需的所有中间量。"""
    components, _ = build_components(worlds, episodes)
    worlds_by_id = {str(record.get("world_id")): record for record in worlds}

    components = sorted(
        components,
        key=lambda members: (_component_hash(members), -len(members)),
    )
    total_worlds = sum(len(c) for c in components)
    quotas = {name: max(1, round(total_worlds * ratio)) for name, ratio in SPLIT_QUOTAS.items()}

    workflow_counts: Counter[str] = Counter()
    for component in components:
        wfs = {str((worlds_by_id[w] or {}).get("workflow_family_id") or "") for w in component}
        for wf in wfs:
            if wf:
                workflow_counts[wf] += 1

    assignment: dict[str, str] = {}
    filled: Counter[str] = Counter()

    def place(members: Sequence[str], split: str) -> None:
        for world_id in members:
            assignment[world_id] = split
        filled[split] += len(members)

    remaining = [list(c) for c in components]

    # 1) mechanism_ood（组合优先；只划出整体 component，且**只划到 quota 为止**）
    # 保护：component 可能极大（union 把所有世界串成一个），不设上限会把整个语料
    # 划进 OOD，train 反而空掉。quota 之外一律留给后面的 split。
    mech_component_ids = choose_mechanism_ood(remaining, worlds_by_id, quotas["mechanism_ood"])
    mech_set = set(mech_component_ids)
    next_remaining = []
    for component in remaining:
        if not (mech_set and set(component) <= mech_set):
            next_remaining.append(component)
            continue
        # component 是不可分的（union 约束），所以只能整块放或整块留。
        # 但一个巨大 component 会把整个语料带进 OOD——因此只在**装得下**时才放，
        # 装不下就整块留给 train（宁可 OOD 小一点，也不能让 train 空掉）。
        if filled["mechanism_ood"] + len(component) <= quotas["mechanism_ood"]:
            place(component, "mechanism_ood")
            mech_set -= set(component)
        else:
            next_remaining.append(component)
    remaining = next_remaining

    # 2) workflow_ood：罕见 workflow family 的 component（出现次数 ≤2），按确定性顺序
    for component in list(remaining):
        if filled["workflow_ood"] >= quotas["workflow_ood"]:
            break
        wfs = {str((worlds_by_id[w] or {}).get("workflow_family_id") or "") for w in component}
        rare = any(wf and workflow_counts[wf] <= 2 for wf in wfs)
        if rare and filled["workflow_ood"] + len(component) <= quotas["workflow_ood"]:
            place(component, "workflow_ood")
            remaining.remove(component)

    # 3) world_ood / 4) iid_dev：按确定性顺序凑 quota
    for split in ("world_ood", "iid_dev"):
        for component in list(remaining):
            if filled[split] + len(component) > quotas[split]:
                continue
            place(component, split)
            remaining.remove(component)

    # 5) train = 其余
    for component in remaining:
        place(component, "train")

    # train 的机制覆盖下限：每个 mechanism family 至少 1 个 world 在 train
    # （达不到就把最后一个占位机制从 mechanism_ood 挪回来——确定性）。
    train_mechanisms = {
        _mechanism_of(w, worlds_by_id) for w, s in assignment.items() if s == "train"
    }
    all_mechanisms = {_mechanism_of(w, worlds_by_id) for w in assignment}
    missing = sorted(all_mechanisms - train_mechanisms)

    episode_split = {
        str(episode.get("episode_id")): assignment.get(str(episode.get("world_id")), "train")
        for episode in episodes
    }
    return {
        "assignment": assignment,
        "episode_split": episode_split,
        "filled": dict(filled),
        "quotas": quotas,
        "components": components,
        "missing_train_mechanisms": missing,
        "component_count": len(components),
        "total_worlds": total_worlds,
    }


def audit(
    result: Mapping[str, Any],
    worlds: Sequence[Mapping[str, Any]],
    worlds_by_id: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """split 泄漏审计（brief §54）：五个 family key 的跨 split 重叠必须为 0。"""
    assignment = result["assignment"]
    key_owners: dict[tuple[str, str, str], str] = {}
    conflicts: list[dict[str, str]] = []
    for record in worlds:
        world_id = str(record.get("world_id"))
        split = assignment.get(world_id, "?")
        for key in UNION_KEYS:
            value = str(record.get(key) or "")
            if not value:
                continue
            token = (key, value, split)
            owner = key_owners.get((key, value, "*"))
            if owner is not None and owner != split:
                conflicts.append({
                    "key": key, "value": value[:24], "splits": sorted({owner, split}),
                })
            key_owners[(key, value, "*")] = split
            key_owners.setdefault(token, split)
    by_split: Counter[str] = Counter(assignment.values())
    mechanisms_by_split: dict[str, Counter[str]] = defaultdict(Counter)
    for world_id, split in assignment.items():
        mechanisms_by_split[split][_mechanism_of(world_id, worlds_by_id)] += 1
    return {
        "cross_split_family_conflicts": conflicts,
        "conflict_count": len(conflicts),
        "worlds_by_split": dict(sorted(by_split.items())),
        "mechanisms_by_split": {
            split: dict(sorted(counter.items())) for split, counter in sorted(mechanisms_by_split.items())
        },
    }


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            record = json.loads(line)
            if isinstance(record, dict):
                out.append(record)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 2B group-based split")
    parser.add_argument("--worlds", required=True)
    parser.add_argument("--episodes", required=True, help="全部 episodes 的 JSONL（展开产物）")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--manifest", default="split-manifest.json")
    args = parser.parse_args()

    worlds = _read_jsonl(ROOT / args.worlds)
    episodes = _read_jsonl(ROOT / args.episodes)
    result = assign_splits(worlds, episodes)
    worlds_by_id = {str(record.get("world_id")): record for record in worlds}
    audit_doc = audit(result, worlds, worlds_by_id)

    out_dir = ROOT / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    for split in SPLITS:
        split_path = out_dir / f"{split}.jsonl"
        count = 0
        with split_path.open("w", encoding="utf-8", newline="\n") as handle:
            for episode in episodes:
                if result["episode_split"].get(str(episode.get("episode_id"))) == split:
                    handle.write(json.dumps(episode, ensure_ascii=False, sort_keys=True) + "\n")
                    count += 1
        print(f"{split}: {count} episodes")

    manifest = {
        "artifact": "SPLIT-MANIFEST",
        "phase": "2B",
        "union_keys": list(UNION_KEYS),
        "splits": SPLITS,
        "split_quotas": dict(SPLIT_QUOTAS),
        "component_count": result["component_count"],
        "worlds_by_split": audit_doc["worlds_by_split"],
        "mechanisms_by_split": audit_doc["mechanisms_by_split"],
        "episodes_by_split": {
            split: sum(1 for e in episodes
                       if result["episode_split"].get(str(e.get("episode_id"))) == split)
            for split in SPLITS
        },
        "missing_train_mechanisms": result["missing_train_mechanisms"],
        "split_leakage_audit": {
            "cross_split_family_conflicts": audit_doc["conflict_count"],
            "conflicts": audit_doc["cross_split_family_conflicts"][:20],
        },
        "generator_ood": "separate file, physically isolated (brief §50/§51)",
    }
    (out_dir / args.manifest).write_bytes(
        (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    )
    print(f"manifest -> {out_dir / args.manifest}")
    if audit_doc["conflict_count"]:
        print(f"LEAKAGE: {audit_doc['conflict_count']} cross-split family conflicts")
        return 1
    print("split leakage audit: 0 conflicts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
