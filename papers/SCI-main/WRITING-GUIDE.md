# AetherGuard SCI论文写作指南

## 1. 写作风格

### 学术英语规范
- 使用第三人称（避免"We", "Our"过多使用）
- 被动语态描述方法（"The system is designed to..."）
- 主动语态陈述贡献（"This paper proposes..."）
- 避免口语化表达
- 使用正式学术词汇

### 时态使用
- **一般事实/定义**: 现在时（"Multi-agent systems are..."）
- **本文工作**: 现在时（"We propose...", "Our system achieves..."）
- **前人工作**: 过去时（"Smith et al. proposed..."）
- **实验结果**: 过去时（"The results showed..."）

## 2. LaTeX写作规范

### 数学符号
```latex
% 在导言区定义常用符号
\newcommand{\agentset}{\mathcal{A}}
\newcommand{\threatset}{\mathcal{T}}
\newcommand{\actionset}{\mathcal{X}}
\newcommand{\decision}{\mathcal{D}}

% 使用示例
The agent set is denoted as $\agentset = \{a_1, a_2, ..., a_n\}$.
```

### 定理环境
```latex
\begin{definition}[Multi-Agent System]
\label{def:mas}
A multi-agent system $\mathcal{M}$ is defined as a tuple:
\begin{equation}
\mathcal{M} = (\agentset, \mathcal{S}, \mathcal{O}, \mathcal{P}, \mathcal{R})
\end{equation}
\end{definition}

\begin{theorem}[Security Guarantee]
\label{thm:security}
Under the threat model defined in Section~\ref{subsec:threat-model}, \systemname guarantees...
\end{theorem}

\begin{proof}
The proof follows from...
\end{proof}
```

### 算法伪代码
```latex
\begin{algorithm}
\caption{Multi-Agent Decision Algorithm}
\label{alg:decision}
\begin{algorithmic}[1]
\Require Threat observation $o \in \mathcal{O}$, Agent set $\agentset$
\Ensure Decision $\decision$
\State Initialize debate scores $\mathcal{S} \leftarrow \emptyset$
\For{each agent $a_i \in \agentset$}
    \State $s_i \leftarrow a_i.\text{evaluate}(o)$
    \State $\mathcal{S} \leftarrow \mathcal{S} \cup \{s_i\}$
\EndFor
\State $\decision \leftarrow \text{Arbitrate}(\mathcal{S})$
\State \Return $\decision$
\end{algorithmic}
\end{algorithm}
```

### 图表引用
```latex
% 图表引用使用 \cref（需要 cleveref 包）
As shown in \cref{fig:architecture}, our system consists of...
The results are summarized in \cref{tab:comparison}.

% 图表环境
\begin{figure}[t]
\centering
\includegraphics[width=\linewidth]{figures/architecture.pdf}
\caption{System architecture overview.}
\label{fig:architecture}
\end{figure}

\begin{table}[t]
\caption{Performance comparison.}
\label{tab:comparison}
\centering
\begin{tabular}{lccc}
\toprule
\textbf{Metric} & \textbf{System A} & \textbf{System B} & \textbf{Ours} \\
\midrule
Latency (ms) & 100 & 80 & 50 \\
Accuracy (\%) & 85 & 90 & 95 \\
\bottomrule
\end{tabular}
\end{table}
```

## 3. 各章节写作要点

### Abstract (150-250 words)
结构：
1. **Context** (1-2句): 研究背景和问题
2. **Problem** (1句): 现有方案的局限性
3. **Solution** (2-3句): 本文提出的方法
4. **Results** (1-2句): 关键实验结果
5. **Impact** (1句): 实际意义

### Introduction
结构：
1. **Background** (2-3段): 分布式安全的重要性
2. **Motivation** (1-2段): 为什么需要新方法
3. **Challenges** (1段): 技术挑战
4. **Contributions** (1段+列表): 3-5条具体贡献
5. **Organization** (1段): 论文结构

### Related Work
结构：
1. **Distributed IDS**: 分布式入侵检测系统
2. **Agent-based Security**: 基于Agent的安全架构
3. **AI-driven Security**: AI驱动的安全系统
4. **Multi-Agent Systems**: 多Agent协作机制
5. **Comparison**: 与现有工作的对比表格

### System Architecture
结构：
1. **Overview**: 系统整体描述
2. **Control Plane**: 控制平面设计
3. **Agent Layer**: Agent层设计
4. **Communication**: 通信机制
5. **AI Architecture**: 7层AI架构（核心创新）

### Algorithm Design
结构：
1. **Formal Definitions**: 形式化定义
2. **Main Algorithm**: 核心算法
3. **Sub-algorithms**: 子算法
4. **Complexity Analysis**: 复杂度分析

### Security Analysis
结构：
1. **Threat Model**: 威胁模型
2. **Attacker Model**: 攻击者模型
3. **Security Properties**: 安全属性
4. **Formal Proofs**: 形式化证明

### Evaluation
结构：
1. **Setup**: 实验设置
2. **Metrics**: 评估指标
3. **Performance Results**: 性能结果
4. **Comparison**: 对比实验
5. **Ablation Study**: 消融实验

## 4. 常用学术表达

### 表达贡献
- "This paper proposes..."
- "We introduce..."
- "Our main contributions are:"
- "To address this challenge, we..."
- "Unlike existing approaches, our system..."

### 引用他人工作
- "Smith et al. [1] proposed..."
- "Recent work by Jones et al. [2] demonstrated..."
- "Several approaches have been developed [3, 4, 5]"
- "Building upon the work of [6], we..."

### 比较对比
- "Compared to [1], our approach..."
- "While [2] focuses on..., we address..."
- "In contrast to existing methods..."
- "Unlike [3], which requires..., our system..."

### 实验描述
- "We evaluate \systemname using..."
- "The experiments were conducted on..."
- "As shown in Table 1, our system achieves..."
- "The results demonstrate that..."

## 5. 参考文献格式

使用IEEE格式，在 `references.bib` 中添加：

```bibtex
@article{smith2025,
  author  = {John Smith and Jane Doe},
  title   = {Title of the Paper},
  journal = {IEEE Transactions on ...},
  year    = {2025},
  volume  = {XX},
  number  = {X},
  pages   = {XXX--XXX}
}

@inproceedings{conf2025,
  author    = {Author Name},
  title     = {Conference Paper Title},
  booktitle = {Proc. of IEEE Conference},
  year      = {2025},
  pages     = {XXX--XXX}
}
```

## 6. 质量检查清单

### 内容检查
- [ ] 创新性是否明确
- [ ] 技术贡献是否清晰
- [ ] 实验是否充分
- [ ] 对比是否公平
- [ ] 引用是否完整

### 格式检查
- [ ] LaTeX编译无错误
- [ ] 图表清晰可读
- [ ] 公式编号正确
- [ ] 引用格式统一
- [ ] 页数符合要求

### 语言检查
- [ ] 无语法错误
- [ ] 无拼写错误
- [ ] 学术用语规范
- [ ] 时态使用正确
- [ ] 句子结构清晰

## 7. 文件命名规范

```
papers/SCI-main/
├── AetherGuard-SCI.tex      # 主文件
├── paper-structure.md        # 结构大纲
├── PROJECT-STATUS.md         # 进度追踪
├── WRITING-GUIDE.md          # 本文件
├── references.bib            # 参考文献
├── sections/                 # 章节文件
│   ├── abstract-intro.tex
│   ├── related-work.tex
│   ├── architecture.tex
│   ├── algorithms.tex
│   ├── security.tex
│   ├── implementation.tex
│   ├── evaluation.tex
│   └── conclusion.tex
├── figures/                  # 图表文件
│   ├── architecture.pdf
│   ├── agent-layers.pdf
│   └── performance-*.pdf
└── supplementary/            # 补充材料
    ├── appendix-proofs.tex
    └── additional-results.tex
```

## 8. 协作流程

1. **写作前**: 阅读本指南和结构大纲
2. **写作中**: 定期保存，使用版本控制
3. **完成后**: 更新PROJECT-STATUS.md
4. **提交前**: 通过paper-reviewer审校

---

**注意**: 本指南会随项目进展更新，请定期查看最新版本。
