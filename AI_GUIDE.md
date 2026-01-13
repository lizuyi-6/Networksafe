# 🤖 NewSecurity AI智能修复功能

## 概述

NewSecurity引入了AI驱动的智能修复功能，可以：
- 🔍 **智能诊断** - AI分析问题根本原因
- 💡 **生成修复方案** - 根据具体情况生成个性化修复命令
- 🔄 **自动重试** - 如果修复失败，AI自动分析原因并尝试替代方案
- 📊 **实时监控** - AI实时监控执行过程，检测异常并提供建议
- 🎯 **自适应** - 从失败中学习，不断调整修复策略

---

## 支持的AI提供商

### 1. Ollama（推荐 - 完全免费，本地运行）

**优点：**
- ✅ 完全免费
- ✅ 数据不出本地服务器
- ✅ 无需API密钥
- ✅ 支持多种开源模型

**安装：**
```bash
# Linux
curl -fsSL https://ollama.ai/install.sh | sh

# 启动服务
ollama serve

# 下载模型（可选，会自动下载）
ollama pull llama2
ollama pull mistral
```

**配置：**
```bash
# .env 文件
AI_PROVIDER=ollama
AI_BASE_URL=http://localhost:11434
AI_MODEL=llama2
```

### 2. OpenAI GPT-4（最强大 - 需付费）

**优点：**
- ✅ 最强的分析能力
- ✅ API稳定
- ✅ 丰富的模型选择

**配置：**
```bash
# .env 文件
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here
AI_MODEL=gpt-4
```

**获取API密钥：**
访问 https://platform.openai.com/api-keys

### 3. Anthropic Claude（推荐 - 平衡性能和成本）

**优点：**
- ✅ 优秀的分析能力
- ✅ 更长的上下文窗口
- ✅ 竞争性定价

**配置：**
```bash
# .env 文件
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-your-key-here
AI_MODEL=claude-3-sonnet-20240229
```

**获取API密钥：**
访问 https://console.anthropic.com/

---

## 使用方式

### 方式1：通过API直接调用

#### 1. 智能修复单个问题

```bash
curl -X POST http://localhost/api/scanner/smart-fix \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "recommendation": {
      "category": "security",
      "priority": "high",
      "title": "Firewall is Inactive",
      "description": "UFW firewall is not enabled",
      "action": "sudo ufw enable",
      "autoApplicable": true,
      "risk": "Server exposed to attacks"
    },
    "context": {
      "systemInfo": {
        "platform": "linux",
        "release": "22.04",
        "cpus": 4
      }
    },
    "options": {
      "enableAI": true,
      "maxAttempts": 3,
      "enableRealTimeMonitoring": true
    }
  }'
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "success": true,
    "recommendation": { ... },
    "attempts": [
      {
        "attemptNumber": 1,
        "solution": {
          "command": "sudo ufw enable",
          "explanation": "Enable UFW firewall",
          "riskLevel": "low",
          "estimatedSuccess": 95
        },
        "executionResult": {
          "command": "sudo ufw enable",
          "exitCode": 0,
          "stdout": "Firewall is active and enabled on system startup",
          "stderr": "",
          "duration": 1234,
          "success": true
        },
        "timestamp": 1642134567890
      }
    ],
    "finalSolution": "sudo ufw enable",
    "totalTime": 1234,
    "aiInsights": {
      "originalDiagnosis": {
        "rootCause": "UFW firewall installed but not activated",
        "severity": "high",
        "confidence": 0.95
      },
      "adaptations": [],
      "lessonsLearned": [
        "Solution \"Enable UFW firewall\" successfully fixed the problem"
      ]
    }
  }
}
```

#### 2. 批量智能修复

```bash
curl -X POST http://localhost/api/scanner/batch-fix \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "recommendations": [
      {
        "category": "security",
        "priority": "high",
        "title": "Firewall is Inactive",
        "action": "sudo ufw enable",
        "autoApplicable": true,
        "risk": "Server exposed"
      },
      {
        "category": "performance",
        "priority": "medium",
        "title": "File Descriptor Limit Too Low",
        "action": "ulimit -n 65535",
        "autoApplicable": true,
        "risk": "May hit file limit under load"
      }
    ],
    "options": {
      "maxAttempts": 3,
      "enableRealTimeMonitoring": true
    }
  }'
```

#### 3. 模拟修复（Dry Run）

在不执行命令的情况下，查看AI会如何修复：

```bash
curl -X POST http://localhost/api/scanner/dry-fix \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "recommendation": {
      "category": "security",
      "priority": "high",
      "title": "MySQL Port Exposed",
      "description": "MySQL port 3306 is accessible from external network",
      "action": "Edit MySQL config to bind to localhost",
      "autoApplicable": false,
      "risk": "Database can be attacked"
    }
  }'
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "aiAnalysis": {
      "diagnosis": {
        "rootCause": "MySQL configured to listen on all interfaces (0.0.0.0)",
        "severity": "high",
        "confidence": 0.92
      },
      "solutions": [
        {
          "command": "sudo sed -i 's/bind-address.*/bind-address = 127.0.0.1/' /etc/mysql/mysql.conf.d/mysqld.cnf && sudo systemctl restart mysql",
          "explanation": "Configure MySQL to only listen on localhost",
          "riskLevel": "medium",
          "estimatedSuccess": 88,
          "prerequisites": ["Backup MySQL configuration first"]
        },
        {
          "command": "sudo iptables -A INPUT -p tcp --dport 3306 -s 127.0.0.1 -j ACCEPT && sudo iptables -A INPUT -p tcp --dport 3306 -j DROP",
          "explanation": "Use firewall to restrict MySQL access",
          "riskLevel": "low",
          "estimatedSuccess": 95
        }
      ],
      "warnings": [
        "Restarting MySQL will cause brief downtime",
        "Ensure you have database backup before making config changes"
      ]
    },
    "plannedAttempts": [
      {
        "attemptNumber": 1,
        "solution": { ... },
        "estimatedSuccess": 88
      }
    ],
    "estimatedTime": 30000,
    "risks": [
      "Restarting MySQL will cause brief downtime",
      "Ensure you have database backup before making config changes"
    ]
  }
}
```

#### 4. 仅AI分析

只获取AI的诊断和建议，不执行修复：

```bash
curl -X POST http://localhost/api/scanner/ai-analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "problem": {
      "title": "High CPU Usage",
      "description": "CPU usage consistently above 80%",
      "category": "performance",
      "priority": "medium"
    },
    "context": {
      "systemInfo": {
        "cpus": 4,
        "totalMemory": "16GB"
      },
      "logs": [
        "Process 'python' using 120% CPU",
        "Process 'node' using 85% CPU"
      ]
    }
  }'
```

---

## 工作流程

### 智能修复流程

```
1. 扫描发现问题
   ↓
2. 收集上下文信息
   - 系统信息
   - 相关日志
   - 配置文件
   ↓
3. AI分析
   - 诊断根本原因
   - 评估严重程度
   - 生成多个修复方案
   ↓
4. 执行修复（带实时监控）
   - AI监控执行过程
   - 检测异常输出
   - 提供实时建议
   ↓
5. 如果失败
   - AI分析失败原因
   - 生成替代方案
   - 自动重试
   ↓
6. 记录学习成果
   - 哪些方案有效
   - 哪些方案无效
   - 用于未来改进
```

### 实时监控流程

```
命令执行中...
   ↓
每10秒AI分析输出
   ↓
检测到可疑输出？
   → YES → 发送警告
            → 建议中止？
   ↓
检测到错误？
   → YES → AI诊断错误
            → 建议替代方案
   ↓
命令完成？
   → YES → 如果失败，AI分析原因
```

---

## 高级配置

### 调整AI行为

```javascript
// 高优先级问题，使用更强的模型
if (recommendation.priority === 'critical') {
  options = {
    aiProvider: {
      name: 'openai',
      model: 'gpt-4'
    },
    maxAttempts: 5,
    enableRealTimeMonitoring: true
  };
}

// 低优先级问题，使用更快的模型
if (recommendation.priority === 'low') {
  options = {
    aiProvider: {
      name: 'ollama',
      model: 'llama2'
    },
    maxAttempts: 2,
    enableRealTimeMonitoring: false
  };
}
```

### 自定义执行上下文

```javascript
const context = {
  systemInfo: {
    platform: 'linux',
    release: '22.04',
    cpus: 8,
    totalMemory: '32GB'
  },
  logs: [
    'Recent error logs...',
    'Warnings from services...'
  ],
  configFiles: {
    '/etc/nginx/nginx.conf': 'nginx configuration content',
    '/etc/mysql/my.cnf': 'mysql configuration content'
  },
  // 添加上一次尝试的信息
  previousAttempts: [
    {
      solution: 'first command tried',
      output: 'output from first attempt',
      error: 'error from first attempt'
    }
  ]
};
```

---

## 示例场景

### 场景1：修复Nginx配置问题

**问题：** "Nginx configuration test failed"

**AI分析：**
```json
{
  "diagnosis": {
    "rootCause": "Syntax error in nginx.conf at line 45",
    "severity": "high",
    "confidence": 0.91
  },
  "solutions": [
    {
      "command": "nginx -t 2>&1 | grep -A 5 'error'",
      "explanation": "Get detailed error information",
      "riskLevel": "low",
      "estimatedSuccess": 100
    },
    {
      "command": "sed -n '40,50p' /etc/nginx/nginx.conf",
      "explanation": "Show lines around the error",
      "riskLevel": "low",
      "estimatedSuccess": 100
    },
    {
      "command": "sudo nginx -s reload",
      "explanation": "After fixing, reload nginx",
      "riskLevel": "medium",
      "estimatedSuccess": 75,
      "prerequisites": ["Fix syntax error first"]
    }
  ]
}
```

### 场景2：修复磁盘空间不足

**问题：** "Disk space almost full (85%)"

**AI分析：**
```json
{
  "diagnosis": {
    "rootCause": "Large log files in /var/log",
    "severity": "critical",
    "confidence": 0.87
  },
  "solutions": [
    {
      "command": "du -sh /var/log/* | sort -rh | head -10",
      "explanation": "Find largest log files",
      "riskLevel": "low",
      "estimatedSuccess": 100
    },
    {
      "command": "sudo journalctl --vacuum-time=7d",
      "explanation": "Clean old journal logs",
      "riskLevel": "low",
      "estimatedSuccess": 90
    },
    {
      "command": "sudo logrotate -f /etc/logrotate.conf",
      "explanation": "Force log rotation",
      "riskLevel": "low",
      "estimatedSuccess": 85
    },
    {
      "command": "sudo apt clean && sudo apt autoclean",
      "explanation": "Clean apt cache",
      "riskLevel": "low",
      "estimatedSuccess": 70
    }
  ],
  "warnings": [
    "Always backup important logs before cleaning",
    "Check if logs are needed for compliance"
  ]
}
```

### 场景3：修复MySQL连接问题

**问题：** "Too many connections error"

**执行过程：**

**尝试1失败：**
```bash
$ sudo systemctl restart mysql
Job failed. See journal logs for details.
```

**AI实时分析：**
```json
{
  "diagnosis": "MySQL failed to restart due to corrupted table",
  "alternativeSolution": "sudo mysqld --skip-grant-tables --skip-networking &",
  "explanation": "Start MySQL in recovery mode to repair tables"
}
```

**尝试2成功：**
```bash
$ sudo mysqlcheck --repair --all-databases
Repairing tables...
database.table1    OK
database.table2    OK
...
$ sudo systemctl restart mysql
✓ Success
```

---

## WebSocket实时事件

前端可以监听实时执行事件：

```javascript
const socket = io('http://localhost');

socket.on('execution-event', (event) => {
  switch(event.type) {
    case 'start':
      console.log('Command started:', event.data.command);
      break;
    case 'stdout':
      console.log('Output:', event.data.output);
      break;
    case 'stderr':
      console.error('Error:', event.data.error);
      break;
    case 'ai-analysis':
      if (event.data.type === 'warning') {
        showWarning(event.data.message, event.data.suggestions);
      }
      break;
    case 'complete':
      console.log('Execution complete:', event.data);
      break;
    case 'timeout':
      console.error('Execution timed out');
      break;
  }
});
```

---

## 最佳实践

### 1. 从低优先级问题开始

先让AI处理低风险问题，建立信任后再处理关键问题。

### 2. 始终先使用Dry Run

在生产环境使用前，先用dry-run查看AI的修复方案。

### 3. 保留回退方案

AI的建议很好，但总要保留手动修复的选项。

### 4. 监控AI决策

定期审查AI的修复历史，确保决策合理。

### 5. 提供足够的上下文

给AI越多信息（日志、配置、系统状态），诊断越准确。

---

## 故障排除

### AI连接失败

**问题：** "AI provider unavailable"

**解决方案：**
```bash
# 检查Ollama是否运行
curl http://localhost:11434/api/tags

# 重启Ollama
systemctl restart ollama

# 检查API密钥
echo $OPENAI_API_KEY
```

### AI分析质量差

**解决方案：**
- 切换到更强的模型（GPT-4）
- 提供更多上下文信息
- 启用previousAttempts让AI学习

### 执行超时

**解决方案：**
```bash
# 增加超时时间
FIX_EXECUTION_TIMEOUT=120000
```

---

## 性能考虑

| AI提供商 | 响应时间 | 成本 | 隐私 | 推荐场景 |
|----------|---------|------|------|----------|
| Ollama   | 慢 (~5-10s) | 免费 | ✅ 本地 | 开发/测试 |
| Claude   | 中 (~2-5s) | $$ | ❌ 云端 | 生产环境 |
| GPT-4    | 快 (~1-3s) | $$$ | ❌ 云端 | 关键问题 |

---

## 未来路线图

- [ ] 支持更多AI提供商（Azure OpenAI、Google Gemini）
- [ ] 多模态分析（截图、配置文件图片）
- [ ] 预测性维护（AI预测可能的问题）
- [ ] 自动化A/B测试（尝试多种修复方案并选择最佳）
- [ ] 知识库（记录成功的修复模式）
- [ ] 协作模式（AI + 人工共同决策）

---

## 贡献

欢迎改进AI提示词和诊断逻辑！

查看：`backend/src/scanner/ai-engine.ts`

---

**文档版本：** 1.0.0
**最后更新：** 2026-01-13

---

## 🇨🇳 智谱AI（推荐给中国用户）

### 为什么选择智谱AI？

- ✅ **中文优化** - 专为中文设计，理解更准确
- ✅ **性价比高** - 价格远低于GPT-4
- ✅ **国内服务** - 低延迟，高可用
- ✅ **合规友好** - 符合国内数据要求

**快速开始：**

```bash
# 配置环境变量
AI_PROVIDER=zhipu
ZHIPU_API_KEY=your-api-key-here
AI_MODEL=glm-4

# 获取API密钥：https://open.bigmodel.cn/
```

**完整指南：** [ZHIPU_AI_GUIDE.md](ZHIPU_AI_GUIDE.md)

**模型选择：**
- `glm-4` - 最新最强（推荐）
- `glm-4-flash` - 快速响应
- `glm-4-air` - 轻量级
- `glm-4-plus` - 增强版

