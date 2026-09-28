# Dedup audit（brief §53）

四层去重在 split 前后各做一次；跨 split 同 fingerprint 为 0。
出现同 fingerprint 跨 split 时按 brief §53 修 split（族分配），不删单条 episode。

```json
{
  "distinct_semantic_fingerprints": 502,
  "exact_duplicates": 0,
  "normalized_duplicates": 454,
  "semantic_duplicates": 0
}
```
