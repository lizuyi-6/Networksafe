# 归档文档目录

本目录存放已废弃或被替代的历史文档，仅供参考。

## 目录结构

```
archive/
├── deployment/   # 部署配置历史
│   └── nginx-iterations/  # nginx 配置迭代版本
├── hardware/     # 硬件历史设计文档
├── manuals/      # 旧版用户手册
├── papers/       # 已完成的论文项目文档
├── redteam/      # 红队测试历史报告
│   ├── round1/   # 第一轮测试
│   └── round2/   # 第二轮测试
└── reports/      # 旧版报告
```

## 归档规则

1. **归档条件**：
   - 文档已在原文中标记为"归档"或"历史参考"
   - 文档内容已被其他文档完全覆盖
   - 文档描述的设计已废弃或被新版本替代

2. **归档操作**：
   - 移动文件到对应子目录
   - 保留原文件名（可添加版本后缀）
   - 在原位置无断裂引用

3. **归档日期**：2026-03-16

## 当前活跃文档位置

- 硬件规格：`docs/hardware_shell_spec.md` / `docs/硬件外壳设计规范.md`
- 软著手册：`docs/软件操作说明书.md`
- 安全白皮书：`docs/reports/AetherGuard-Security-Whitepaper.md`
