# Split leakage audit

- cross-split family conflicts: **0**
- union keys: world_family_id, counterfactual_family_id, workflow_family_id, policy_family_id, invariant_family_id
- components: 502
- worlds by split: {"iid_dev": 50, "mechanism_ood": 3, "train": 399, "world_ood": 50}
- missing train mechanisms: []
- 主 split 不是随机 row split：分配单位是并查集 component
