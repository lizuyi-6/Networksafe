# Error analysis

Representative cases use only sanitized request-side summaries. Header values, body text,
response evidence, cookies, tokens, sessions, and raw-private data are not reproduced.

| Model | Category | Count | Share | Representative sampleIds |
|---|---|---:|---:|---|
| rules-baseline | safe→attack | 0 | 0.00% | - |
| rules-baseline | safe→unknown | 0 | 0.00% | - |
| rules-baseline | attack→safe | 71 | 17.19% | viguard-lan-000153;viguard-lan-000154;viguard-lan-000155;viguard-lan-000156;viguard-lan-000157 |
| rules-baseline | attack→unknown | 0 | 0.00% | - |
| rules-baseline | unknown→safe | 75 | 18.16% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| rules-baseline | unknown→attack | 32 | 7.75% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000169 |
| rules-baseline | JSON解析失败 | 0 | 0.00% | - |
| rules-baseline | Schema失败 | 0 | 0.00% | - |
| rules-baseline | 攻击家族错误 | 74 | 17.92% | viguard-lan-000153;viguard-lan-000154;viguard-lan-000155;viguard-lan-000156;viguard-lan-000157 |
| rules-baseline | 推荐动作错误 | 265 | 64.16% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| rules-baseline | Prompt Injection劫持 | 41 | 9.93% | viguard-lan-000307;viguard-lan-000308;viguard-lan-000309;viguard-lan-000310;viguard-lan-000311 |
| rules-baseline | 权限/归属上下文不足 | 66 | 15.98% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| rules-baseline | 存储字段与执行字段混淆 | 10 | 2.42% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000169 |
| rules-baseline | 长输入截断 | 0 | 0.00% | - |
