# 红队渗透测试框架

⚠️ **安全警告**: 本框架仅供授权的渗透测试使用。未经授权使用可能违反法律法规。

## 简介

这是一个综合性的渗透测试框架，集成了多种漏洞利用模块和攻击链，用于授权的渗透测试和安全评估。

## 功能特性

### 漏洞利用模块

1. **SQL注入利用模块** (`exploits/sql_injection.py`)
   - 布尔盲注攻击
   - 时间盲注攻击
   - UNION注入
   - 错误注入
   - 数据库指纹检测

2. **认证绕过模块** (`exploits/auth_bypass.py`)
   - JWT密钥伪造
   - 弱密钥暴力破解
   - SQL登录绕过
   - 会话固定攻击

3. **远程代码执行模块** (`exploits/rce_exploit.py`)
   - 命令注入攻击
   - 代码注入攻击
   - 反序列化RCE
   - 模板注入攻击

4. **路径遍历模块** (`exploits/path_traversal.py`)
   - 路径遍历/目录穿越攻击
   - 文件读取攻击
   - 文件上传绕过攻击
   - WebShell上传

### 攻击链

1. **信息泄露到RCE** (`attack_chains/chain_infoleak_to_rce.py`)
   ```
   攻击路径: 敏感文件泄露 -> 凭据发现 -> 未授权访问 -> 命令执行
   ```

2. **SQL注入到数据外泄** (`attack_chains/chain_sqli_to_data_exfil.py`)
   ```
   攻击路径: SQL注入 -> 数据库枚举 -> 敏感数据提取 -> 数据外泄
   ```

3. **认证到管理员权限** (`attack_chains/chain_auth_to_admin.py`)
   ```
   攻击路径: 认证绕过 -> 权限提升 -> 管理员访问
   ```

## 安装

```bash
# 克隆仓库
git clone https://github.com/redteam/framework.git
cd framework

# 安装依赖
pip install -r requirements.txt
```

### 依赖要求

- Python 3.8+
- requests
- urllib3
- colorama (可选，用于彩色输出)

## 使用方法

### 命令行使用

```bash
# 运行SQL注入模块
python main.py -m sqli -t http://target.com/page?id=1 --param id

# 运行认证绕过模块
python main.py -m auth_bypass -t http://target.com/login

# 运行RCE模块
python main.py -m rce -t http://target.com/exec --param cmd

# 运行路径遍历模块
python main.py -m path_traversal -t http://target.com/view?file=report.pdf

# 运行攻击链
python main.py --chain infoleak_to_rce -t http://target.com/file.php --param file

# 生成报告
python main.py --report -o pentest_report.json
```

### Python API使用

```python
from main import RedTeamFramework

# 初始化框架
framework = RedTeamFramework(output_dir='./output', verbose=True)

# 运行模块
result = framework.run_module(
    module_name='sqli',
    target='http://target.com/page?id=1',
    param='id'
)

# 运行攻击链
result = framework.run_attack_chain(
    chain_name='infoleak_to_rce',
    target='http://target.com/file.php',
    param='file'
)

# 生成报告
report_file = framework.generate_report()

# 清理资源
framework.close()
```

## 项目结构

```
redteam/
├── main.py                     # 主入口
├── exploits/                   # 漏洞利用模块
│   ├── __init__.py
│   ├── sql_injection.py       # SQL注入利用
│   ├── auth_bypass.py         # 认证绕过
│   ├── rce_exploit.py         # 远程代码执行
│   └── path_traversal.py      # 路径遍历
├── attack_chains/             # 攻击链
│   ├── __init__.py
│   ├── chain_infoleak_to_rce.py
│   ├── chain_sqli_to_data_exfil.py
│   └── chain_auth_to_admin.py
├── utils/                       # 工具模块
│   ├── __init__.py
│   ├── request_helper.py       # HTTP请求助手
│   ├── payload_generator.py    # Payload生成器
│   └── output_formatter.py     # 输出格式化
└── README.md
```

## 安全注意事项

1. **授权使用**: 本框架仅供授权的渗透测试使用。在使用前必须获得目标系统的书面授权。

2. **法律责任**: 未经授权使用本框架可能违反《网络安全法》、《刑法》等相关法律法规。

3. **测试环境**: 建议在隔离的测试环境中使用本框架，避免影响生产环境。

4. **数据保护**: 渗透测试中收集的数据应妥善保护，避免泄露。

## 许可证

本项目采用 MIT 许可证。详见 LICENSE 文件。

## 贡献

欢迎提交 Issue 和 Pull Request。

## 联系方式

- 项目主页: https://github.com/redteam/framework
- 问题反馈: https://github.com/redteam/framework/issues
- 邮箱: redteam@example.com

---

**免责声明**: 本框架仅供学习和授权的渗透测试使用。开发者不对任何非法使用承担责任。
