# AetherArgus v0.2 训练前数据验证报告

- 数据集版本: v02  seed: 20260728  生成方式: 本分支实际重建
- manifest SHA-256: `c7b442b117d1a78866f3a9e3d56461fdf1c434eac51a158765bfefd5243c9a48`
- independent-seal SHA-256: `99481dff204f83308ad21f8452fd2d82cb4fa3c1a86c80ff3542ba4b424a1ba9`

## 文件与哈希

| split | records | bytes | sha256 匹配 manifest |
|---|---|---|---|
| train | 14314 | 51939028 | True |
| validation | 1752 | 6292081 | True |
| test_closed | 1236 | 4214042 | True |
| test_independent | 1750 | 6501084 | True |

## 类别分布

- attack: 9458
- normal: 5273
- hard_negative: 2971
- unknown: 1350

## 攻击家族分布

- benign: 8244
- other: 2988
- command_injection: 1014
- sqli: 999
- protocol_attack: 790
- deserialization: 714
- xss: 709
- path_traversal: 563
- authentication: 554
- ssrf: 520
- file_upload: 498
- api_abuse: 491
- automation: 490
- business_logic: 478

## 来源(provenance)分布

- public_open_source_derived: 5309
- deterministic_synthetic_v02: 13354
- tracked_synthetic_security_corpus_v02_conversion: 389

## 编码分布

- plain: 10875
- unicode: 6439
- url_encoded: 1382
- double_url_encoded: 356

## evaluationSuite 分布

- public_training_prompt_injection: 2200
- development: 11993
- public_training_waf_regression: 1935
- public_training_openapi_normal: 1174
- prompt_injection_test: 137
- authorized_attack_test: 1125
- long_input_test: 50
- independent_synthetic_normal: 200
- independent_hard_negative: 88
- independent_unknown: 150

## 校验结论

- **schemaAndEnums**: PASS (roles==[system,user,assistant]; user/assistant strict JSON; 7 keys; closed enums)
- **hardConstraints**: PASS (safe!=block, malicious!=allow, unknown conf<=0.5)
- **crossSplitLeakage**: PASS (0 shared groupId/normalizedHash/templateFingerprint)
- **publicSourcesOnlyTrainVal**: PASS (public_open_source_derived only in train 4779 + validation 530)
- **independentSealMatch**: PASS (recordsSha256 4d2ccde0... matches seal)
- **evidenceEncodingNote**: 14028 evidence values verified; 1470 (train 1081) reference URL-encoded fragments present in input with quote-escaping difference; attribution confirmed, not a defect

## 诚实边界

- 全部为合成或公开来源派生；人工审核样本数 0；真实正常流量 0；真实授权攻击捕获 0。
- 公开来源 attribution: OWASP CRS regression requests / S-Labs prompt-injection training split / Stripe OpenAPI contract。
