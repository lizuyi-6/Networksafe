# Error analysis

Representative cases use only sanitized request-side summaries. Header values, body text,
response evidence, cookies, tokens, sessions, and raw-private data are not reproduced.

| Model | Category | Count | Share | Representative sampleIds |
|---|---|---:|---:|---|
| rules-baseline | safe→attack | 3 | 0.73% | viguard-lan-000231;viguard-lan-000232;viguard-lan-000233 |
| rules-baseline | safe→unknown | 4 | 0.97% | viguard-lan-000255;viguard-lan-000256;viguard-lan-000257;viguard-lan-000297 |
| rules-baseline | attack→safe | 85 | 20.58% | viguard-lan-000153;viguard-lan-000154;viguard-lan-000155;viguard-lan-000157;viguard-lan-000158 |
| rules-baseline | attack→unknown | 1 | 0.24% | viguard-lan-000197 |
| rules-baseline | unknown→safe | 79 | 19.13% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| rules-baseline | unknown→attack | 26 | 6.30% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000170 |
| rules-baseline | JSON解析失败 | 0 | 0.00% | - |
| rules-baseline | Schema失败 | 0 | 0.00% | - |
| rules-baseline | 攻击家族错误 | 89 | 21.55% | viguard-lan-000153;viguard-lan-000154;viguard-lan-000155;viguard-lan-000157;viguard-lan-000158 |
| rules-baseline | 推荐动作错误 | 261 | 63.20% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| rules-baseline | Prompt Injection劫持 | 56 | 13.56% | viguard-lan-000307;viguard-lan-000308;viguard-lan-000309;viguard-lan-000310;viguard-lan-000311 |
| rules-baseline | 权限/归属上下文不足 | 64 | 15.50% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| rules-baseline | 存储字段与执行字段混淆 | 6 | 1.45% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000170 |
| rules-baseline | 长输入截断 | 0 | 0.00% | - |
| char-ngram-logreg | safe→attack | 209 | 50.61% | viguard-lan-000001;viguard-lan-000002;viguard-lan-000003;viguard-lan-000004;viguard-lan-000005 |
| char-ngram-logreg | safe→unknown | 0 | 0.00% | - |
| char-ngram-logreg | attack→safe | 0 | 0.00% | - |
| char-ngram-logreg | attack→unknown | 0 | 0.00% | - |
| char-ngram-logreg | unknown→safe | 2 | 0.48% | viguard-lan-000258;viguard-lan-000265 |
| char-ngram-logreg | unknown→attack | 105 | 25.42% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| char-ngram-logreg | JSON解析失败 | 0 | 0.00% | - |
| char-ngram-logreg | Schema失败 | 0 | 0.00% | - |
| char-ngram-logreg | 攻击家族错误 | 97 | 23.49% | viguard-lan-000153;viguard-lan-000154;viguard-lan-000155;viguard-lan-000156;viguard-lan-000157 |
| char-ngram-logreg | 推荐动作错误 | 318 | 77.00% | viguard-lan-000001;viguard-lan-000002;viguard-lan-000003;viguard-lan-000004;viguard-lan-000005 |
| char-ngram-logreg | Prompt Injection劫持 | 0 | 0.00% | - |
| char-ngram-logreg | 权限/归属上下文不足 | 66 | 15.98% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| char-ngram-logreg | 存储字段与执行字段混淆 | 19 | 4.60% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000169 |
| char-ngram-logreg | 长输入截断 | 0 | 0.00% | - |
| qwen3-4b-zero-shot | safe→attack | 67 | 16.22% | viguard-lan-000025;viguard-lan-000026;viguard-lan-000027;viguard-lan-000028;viguard-lan-000067 |
| qwen3-4b-zero-shot | safe→unknown | 1 | 0.24% | viguard-lan-000302 |
| qwen3-4b-zero-shot | attack→safe | 26 | 6.30% | viguard-lan-000197;viguard-lan-000215;viguard-lan-000216;viguard-lan-000307;viguard-lan-000313 |
| qwen3-4b-zero-shot | attack→unknown | 2 | 0.48% | viguard-lan-000309;viguard-lan-000310 |
| qwen3-4b-zero-shot | unknown→safe | 56 | 13.56% | viguard-lan-000120;viguard-lan-000122;viguard-lan-000123;viguard-lan-000124;viguard-lan-000127 |
| qwen3-4b-zero-shot | unknown→attack | 45 | 10.90% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| qwen3-4b-zero-shot | JSON解析失败 | 0 | 0.00% | - |
| qwen3-4b-zero-shot | Schema失败 | 0 | 0.00% | - |
| qwen3-4b-zero-shot | 攻击家族错误 | 39 | 9.44% | viguard-lan-000197;viguard-lan-000199;viguard-lan-000215;viguard-lan-000216;viguard-lan-000307 |
| qwen3-4b-zero-shot | 推荐动作错误 | 220 | 53.27% | viguard-lan-000025;viguard-lan-000026;viguard-lan-000027;viguard-lan-000028;viguard-lan-000067 |
| qwen3-4b-zero-shot | Prompt Injection劫持 | 23 | 5.57% | viguard-lan-000307;viguard-lan-000313;viguard-lan-000315;viguard-lan-000316;viguard-lan-000322 |
| qwen3-4b-zero-shot | 权限/归属上下文不足 | 65 | 15.74% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| qwen3-4b-zero-shot | 存储字段与执行字段混淆 | 19 | 4.60% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000169 |
| qwen3-4b-zero-shot | 长输入截断 | 0 | 0.00% | - |
| qwen3-4b-few-shot | safe→attack | 56 | 13.56% | viguard-lan-000001;viguard-lan-000002;viguard-lan-000025;viguard-lan-000028;viguard-lan-000152 |
| qwen3-4b-few-shot | safe→unknown | 7 | 1.69% | viguard-lan-000034;viguard-lan-000133;viguard-lan-000201;viguard-lan-000285;viguard-lan-000363 |
| qwen3-4b-few-shot | attack→safe | 31 | 7.51% | viguard-lan-000215;viguard-lan-000216;viguard-lan-000313;viguard-lan-000314;viguard-lan-000317 |
| qwen3-4b-few-shot | attack→unknown | 7 | 1.69% | viguard-lan-000312;viguard-lan-000316;viguard-lan-000324;viguard-lan-000336;viguard-lan-000358 |
| qwen3-4b-few-shot | unknown→safe | 64 | 15.50% | viguard-lan-000116;viguard-lan-000123;viguard-lan-000124;viguard-lan-000125;viguard-lan-000127 |
| qwen3-4b-few-shot | unknown→attack | 36 | 8.72% | viguard-lan-000115;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119;viguard-lan-000121 |
| qwen3-4b-few-shot | JSON解析失败 | 1 | 0.24% | viguard-lan-000163 |
| qwen3-4b-few-shot | Schema失败 | 1 | 0.24% | viguard-lan-000163 |
| qwen3-4b-few-shot | 攻击家族错误 | 39 | 9.44% | viguard-lan-000180;viguard-lan-000199;viguard-lan-000215;viguard-lan-000216;viguard-lan-000312 |
| qwen3-4b-few-shot | 推荐动作错误 | 225 | 54.48% | viguard-lan-000001;viguard-lan-000002;viguard-lan-000025;viguard-lan-000028;viguard-lan-000034 |
| qwen3-4b-few-shot | Prompt Injection劫持 | 29 | 7.02% | viguard-lan-000313;viguard-lan-000314;viguard-lan-000317;viguard-lan-000319;viguard-lan-000320 |
| qwen3-4b-few-shot | 权限/归属上下文不足 | 65 | 15.74% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| qwen3-4b-few-shot | 存储字段与执行字段混淆 | 18 | 4.36% | viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000169;viguard-lan-000170 |
| qwen3-4b-few-shot | 长输入截断 | 0 | 0.00% | - |
| aetherargus-v02-hf-lora | safe→attack | 43 | 10.41% | viguard-lan-000221;viguard-lan-000225;viguard-lan-000226;viguard-lan-000227;viguard-lan-000228 |
| aetherargus-v02-hf-lora | safe→unknown | 0 | 0.00% | - |
| aetherargus-v02-hf-lora | attack→safe | 9 | 2.18% | viguard-lan-000197;viguard-lan-000215;viguard-lan-000216;viguard-lan-000322;viguard-lan-000335 |
| aetherargus-v02-hf-lora | attack→unknown | 0 | 0.00% | - |
| aetherargus-v02-hf-lora | unknown→safe | 72 | 17.43% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| aetherargus-v02-hf-lora | unknown→attack | 35 | 8.47% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000169 |
| aetherargus-v02-hf-lora | JSON解析失败 | 0 | 0.00% | - |
| aetherargus-v02-hf-lora | Schema失败 | 0 | 0.00% | - |
| aetherargus-v02-hf-lora | 攻击家族错误 | 17 | 4.12% | viguard-lan-000196;viguard-lan-000197;viguard-lan-000198;viguard-lan-000199;viguard-lan-000215 |
| aetherargus-v02-hf-lora | 推荐动作错误 | 189 | 45.76% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| aetherargus-v02-hf-lora | Prompt Injection劫持 | 6 | 1.45% | viguard-lan-000322;viguard-lan-000335;viguard-lan-000336;viguard-lan-000347;viguard-lan-000354 |
| aetherargus-v02-hf-lora | 权限/归属上下文不足 | 66 | 15.98% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| aetherargus-v02-hf-lora | 存储字段与执行字段混淆 | 19 | 4.60% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000169 |
| aetherargus-v02-hf-lora | 长输入截断 | 0 | 0.00% | - |
| aetherargus-v02-merged-bf16 | safe→attack | 43 | 10.41% | viguard-lan-000221;viguard-lan-000225;viguard-lan-000226;viguard-lan-000227;viguard-lan-000228 |
| aetherargus-v02-merged-bf16 | safe→unknown | 0 | 0.00% | - |
| aetherargus-v02-merged-bf16 | attack→safe | 9 | 2.18% | viguard-lan-000197;viguard-lan-000215;viguard-lan-000216;viguard-lan-000322;viguard-lan-000335 |
| aetherargus-v02-merged-bf16 | attack→unknown | 0 | 0.00% | - |
| aetherargus-v02-merged-bf16 | unknown→safe | 73 | 17.68% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| aetherargus-v02-merged-bf16 | unknown→attack | 34 | 8.23% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000169 |
| aetherargus-v02-merged-bf16 | JSON解析失败 | 0 | 0.00% | - |
| aetherargus-v02-merged-bf16 | Schema失败 | 0 | 0.00% | - |
| aetherargus-v02-merged-bf16 | 攻击家族错误 | 17 | 4.12% | viguard-lan-000196;viguard-lan-000197;viguard-lan-000198;viguard-lan-000199;viguard-lan-000215 |
| aetherargus-v02-merged-bf16 | 推荐动作错误 | 189 | 45.76% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| aetherargus-v02-merged-bf16 | Prompt Injection劫持 | 6 | 1.45% | viguard-lan-000322;viguard-lan-000335;viguard-lan-000336;viguard-lan-000347;viguard-lan-000354 |
| aetherargus-v02-merged-bf16 | 权限/归属上下文不足 | 66 | 15.98% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| aetherargus-v02-merged-bf16 | 存储字段与执行字段混淆 | 19 | 4.60% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000169 |
| aetherargus-v02-merged-bf16 | 长输入截断 | 0 | 0.00% | - |
| aetherargus-v02-gguf-q4-k-m | safe→attack | 47 | 11.38% | viguard-lan-000028;viguard-lan-000221;viguard-lan-000222;viguard-lan-000224;viguard-lan-000225 |
| aetherargus-v02-gguf-q4-k-m | safe→unknown | 2 | 0.48% | viguard-lan-000246;viguard-lan-000248 |
| aetherargus-v02-gguf-q4-k-m | attack→safe | 9 | 2.18% | viguard-lan-000215;viguard-lan-000216;viguard-lan-000322;viguard-lan-000329;viguard-lan-000334 |
| aetherargus-v02-gguf-q4-k-m | attack→unknown | 0 | 0.00% | - |
| aetherargus-v02-gguf-q4-k-m | unknown→safe | 69 | 16.71% | viguard-lan-000116;viguard-lan-000117;viguard-lan-000119;viguard-lan-000120;viguard-lan-000121 |
| aetherargus-v02-gguf-q4-k-m | unknown→attack | 38 | 9.20% | viguard-lan-000115;viguard-lan-000118;viguard-lan-000163;viguard-lan-000164;viguard-lan-000165 |
| aetherargus-v02-gguf-q4-k-m | JSON解析失败 | 2 | 0.48% | viguard-lan-000246;viguard-lan-000248 |
| aetherargus-v02-gguf-q4-k-m | Schema失败 | 2 | 0.48% | viguard-lan-000246;viguard-lan-000248 |
| aetherargus-v02-gguf-q4-k-m | 攻击家族错误 | 18 | 4.36% | viguard-lan-000166;viguard-lan-000196;viguard-lan-000198;viguard-lan-000199;viguard-lan-000215 |
| aetherargus-v02-gguf-q4-k-m | 推荐动作错误 | 190 | 46.00% | viguard-lan-000028;viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118 |
| aetherargus-v02-gguf-q4-k-m | Prompt Injection劫持 | 7 | 1.69% | viguard-lan-000322;viguard-lan-000329;viguard-lan-000334;viguard-lan-000335;viguard-lan-000339 |
| aetherargus-v02-gguf-q4-k-m | 权限/归属上下文不足 | 66 | 15.98% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| aetherargus-v02-gguf-q4-k-m | 存储字段与执行字段混淆 | 19 | 4.60% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000169 |
| aetherargus-v02-gguf-q4-k-m | 长输入截断 | 0 | 0.00% | - |
| aetherargus-v02-ollama-f16 | safe→attack | 43 | 10.41% | viguard-lan-000221;viguard-lan-000225;viguard-lan-000226;viguard-lan-000227;viguard-lan-000228 |
| aetherargus-v02-ollama-f16 | safe→unknown | 0 | 0.00% | - |
| aetherargus-v02-ollama-f16 | attack→safe | 9 | 2.18% | viguard-lan-000197;viguard-lan-000215;viguard-lan-000216;viguard-lan-000322;viguard-lan-000335 |
| aetherargus-v02-ollama-f16 | attack→unknown | 0 | 0.00% | - |
| aetherargus-v02-ollama-f16 | unknown→safe | 73 | 17.68% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| aetherargus-v02-ollama-f16 | unknown→attack | 34 | 8.23% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000169 |
| aetherargus-v02-ollama-f16 | JSON解析失败 | 0 | 0.00% | - |
| aetherargus-v02-ollama-f16 | Schema失败 | 0 | 0.00% | - |
| aetherargus-v02-ollama-f16 | 攻击家族错误 | 17 | 4.12% | viguard-lan-000196;viguard-lan-000197;viguard-lan-000198;viguard-lan-000199;viguard-lan-000215 |
| aetherargus-v02-ollama-f16 | 推荐动作错误 | 189 | 45.76% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| aetherargus-v02-ollama-f16 | Prompt Injection劫持 | 6 | 1.45% | viguard-lan-000322;viguard-lan-000335;viguard-lan-000336;viguard-lan-000347;viguard-lan-000354 |
| aetherargus-v02-ollama-f16 | 权限/归属上下文不足 | 66 | 15.98% | viguard-lan-000115;viguard-lan-000116;viguard-lan-000117;viguard-lan-000118;viguard-lan-000119 |
| aetherargus-v02-ollama-f16 | 存储字段与执行字段混淆 | 19 | 4.60% | viguard-lan-000163;viguard-lan-000164;viguard-lan-000165;viguard-lan-000168;viguard-lan-000169 |
| aetherargus-v02-ollama-f16 | 长输入截断 | 0 | 0.00% | - |
