# GGUF 导出报告

- 合并模型：`/mnt/x/repos/Networksafe/ml/output/aetherguard-qwen-merged`
- llama.cpp：`/home/break/llama.cpp`
- F16 GGUF：`/mnt/x/repos/Networksafe/ml/output/aetherguard-security-f16.gguf` (8051283232 bytes)
- Q4_K_M GGUF：`/mnt/x/repos/Networksafe/ml/output/aetherguard-security-q4_k_m.gguf` (2497278752 bytes)
- Ollama Modelfile：`ml/deployment/Modelfile`

脚本不会覆盖已存在的 GGUF；存在时验证文件非空后复用。
