# AetherGuard SCI Paper

> **Evidence status (2026-07-27):** The manuscript has been synchronized to `docs/reports/software-validation-status-2026-07-27.md`. Do not restore the prior 96.2% accuracy, 2.3% FPR, 1,200+ production-server, production-uptime, or unversioned ablation claims without new raw evidence.

## 论文信息

- **标题**: AetherGuard: A Multi-Agent AI Architecture for Distributed Server Security
- **目标期刊**: IEEE TDSC / TIFS / TNSM
- **页数**: ~17页
- **参考文献**: 50篇

## 文件结构

```
.
├── AetherGuard-SCI-Final.tex      # 主文件（使用此文件编译）
├── sections/                         # 章节文件
│   ├── abstract-intro.tex           # 摘要与引言
│   ├── related-work.tex             # 相关工作
│   ├── system-architecture.tex      # 系统架构
│   ├── algorithms.tex               # 算法设计
│   ├── security-analysis.tex        # 安全分析
│   ├── implementation.tex           # 实现细节
│   ├── evaluation.tex               # 实验评估
│   └── conclusion.tex               # 结论
├── references/
│   └── main.bib                     # 参考文献库
└── README.md                         # 本文件
```

## 编译方法

### 方法1: 使用Overleaf（推荐）

1. 访问 https://www.overleaf.com
2. 创建新项目 → 上传项目
3. 上传整个文件夹内容
4. 选择 `AetherGuard-SCI-Final.tex` 作为主文件
5. 点击 "Recompile" 按钮生成PDF

### 方法2: 本地编译

需要安装TeX Live或MiKTeX

```bash
# 编译命令
pdflatex AetherGuard-SCI-Final.tex
bibtex AetherGuard-SCI-Final
pdflatex AetherGuard-SCI-Final.tex
pdflatex AetherGuard-SCI-Final.tex

# 或使用 latexmk
latexmk -pdf AetherGuard-SCI-Final.tex
```

## 论文核心内容

### 创新点
1. 七层多智能体安全决策架构
2. 角色专业化辩论机制（Socrates/Plato/Aristotle）
3. 过程可解释的安全决策
4. 隐私感知的异构模型路由
5. 生产级开源实现

### 实验结果
- 4,500 条合成语料攻击检测率: 63.97%
- 1,200 条合成正常样本 FPR: 0%；不代表生产误报率
- 合成语料启发式评估延迟: median 0.522ms、p95 1.530ms
- Rust 固定 key loopback: 三轮 56.6k--61.6k QPS，零错误
- 生产部署规模: 未验证

## 注意事项

1. **图表**: 当前缺少 `figures/` 目录中的图表文件，需要补充
2. **参考文献**: 已包含50篇高质量参考文献
3. **格式**: 符合IEEE Transactions双栏格式要求

## 联系信息

如有问题，请参考 `project-plan.md` 和 `innovation-points.md` 了解项目详情。
